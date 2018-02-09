/* eslint-env node */
/* eslint-disable no-console*/
const path = require('path');
const chalk = require('chalk');
const shelljs = require('shelljs');

/**
 * Represents a node in a PackageGraph.
 * @constructor
 * @param {!<Package>} pkg - A Package object to build the node from.
 */
class PackageGraphNode {
  constructor(pkg) {
    this.package = pkg;
    this.dependencies = [];
  }
}

/**
 * Represents a node in a PackageGraph.
 * @constructor
 * @param {!Array.<Package>} packages An array of Packages to build the graph out of.
 */
class PackageGraph {
  constructor(packages) {
    this.nodes = [];
    this.nodesByName = {};

    for (let p = 0; p < packages.length; p += 1) {
      const pkg = packages[p];
      const node = new PackageGraphNode(pkg);
      this.nodes.push(node);
      this.nodesByName[pkg.name] = node;
    }

    for (let n = 0; n < this.nodes.length; n += 1) {
      const node = this.nodes[n];
      const dependencies = node.package.allDependencies || {};
      const depNames = Object.keys(dependencies);

      for (let d = 0; d < depNames.length; d += 1) {
        const depName = depNames[d];
        const packageNode = this.nodesByName[depName];

        if (packageNode) {
          node.dependencies.push(depName);
        }
      }
    }
  }

  get(packageName) {
    return this.nodesByName[packageName];
  }
}

class Package {
  constructor(packageName, packageList) {
    // eslint-disable-next-line import/no-dynamic-require
    const packageJson = require(path.join(
      process.cwd(),
      'packages',
      packageName,
      'package.json'
    ));
    this.name = packageName;
    this.files = packageJson.files;
    this.scripts = packageJson.scripts;
    // dependents are populated after we get all of the packages.
    this.dependents = [];
    this.allDependencies = {
      ...packageJson.devDependencies,
      ...packageJson.dependencies,
    };
    this.fusionDependencies = Object.keys(this.allDependencies)
      .filter(key => packageList.includes(key))
      .reduce((obj, key) => {
        obj[key] = this.allDependencies[key];
        return obj;
      }, {});
    this.nonFusionDependencies = Object.keys(this.allDependencies)
      .filter(key => !packageList.includes(key))
      .reduce((obj, key) => {
        obj[key] = this.allDependencies[key];
        return obj;
      }, {});
  }
}

function getPackages(packageList) {
  const packages = packageList.map(
    packageName => new Package(packageName, packageList)
  );

  // Gather dependents information.
  const dependents = {};
  packages.forEach(pkg => {
    Object.keys(pkg.fusionDependencies).forEach(fusionDependency => {
      dependents[fusionDependency] = dependents[fusionDependency] || [];
      dependents[fusionDependency].push(pkg.name);
    });
  });

  // Insert depentents information.
  packages.forEach(pkg => {
    if (dependents[pkg.name]) {
      pkg.dependents = dependents[pkg.name];
    }
  });

  return packages;
}

function topologicallyBatchPackages(allPackages, {rejectCycles} = {}) {
  const packages = [...allPackages];
  const packageGraph = new PackageGraph(packages);

  // This maps package names to the number of packages that depend on them.
  // As packages are completed their names will be removed from this object.
  const refCounts = {};
  packages.forEach(pkg =>
    packageGraph.get(pkg.name).dependencies.forEach(dep => {
      if (!refCounts[dep]) {
        refCounts[dep] = 0;
      }
      refCounts[dep] += 1;
    })
  );

  const batches = [];
  while (packages.length) {
    // Get all packages that have no remaining dependencies within the repo
    // that haven't yet been picked.
    const batch = packages.filter(pkg => {
      const node = packageGraph.get(pkg.name);
      return node.dependencies.filter(dep => refCounts[dep]).length === 0;
    });

    // If we weren't able to find a package with no remaining dependencies,
    // then we've encountered a cycle in the dependency graph.  Run a
    // single-package batch with the package that has the most dependents.
    if (packages.length && !batch.length) {
      const cyclePackageNames = packages.map(p => `"${p.name}"`);
      const message = `${'Encountered a cycle in the dependency graph.' +
        'This may cause instability! Packages in cycle are: '}${cyclePackageNames.join(
        ', '
      )}`;

      if (rejectCycles) {
        throw new Error(message);
      }
      console.warn('ECYCLE', message);

      batch.push(
        packages.reduce(
          (a, b) =>
            (refCounts[a.name] || 0) > (refCounts[b.name] || 0) ? a : b
        )
      );
    }

    batches.push(batch);

    batch.forEach(pkg => {
      delete refCounts[pkg.name];
      packages.splice(packages.indexOf(pkg), 1);
    });
  }

  return batches;
}

async function installBatchedPackages(batches) {
  // Install non-fusion dependencies for all packages first.
  console.log(
    chalk.bold.blue(`installing package.json non-fusion dependencies`)
  );
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    await Promise.all(
      batch.map(async pkg => {
        console.log(`${pkg.name} - installing dependencies`);
        shelljs.exec(
          `cd packages/${pkg.name} && \
          yarn add ${Object.keys(pkg.nonFusionDependencies).join(' ')}`,
          {silent: true}
        );
      })
    );
  }

  console.log(chalk.bold.blue(`transpile and insert into dependent modules`));
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(
      chalk.bold.green(
        `Processing batch ${i} which contains ${batch.length} packages`
      )
    );

    // Process each batch of dependencies in parallel.
    await Promise.all(
      batch.map(async pkg => {
        // If we have a transpile script, transpile then copy to all other dependent packages
        if (pkg.scripts.transpile) {
          console.log(`${pkg.name} - transpiling`);
          shelljs.exec(
            `cd packages/${pkg.name} && yarn transpile`
          );
        }

        // Copy into all dependents
        for (let k = 0; k < pkg.dependents.length; k++) {
          console.log(
            `${pkg.name} - copying into dependent ${pkg.dependents[k]}`
          );
          // If there are no package files copy everything
          if (!pkg.files) {
            shelljs.exec(`
              cp -R packages/${pkg.name}/ packages/${
              pkg.dependents[k]
            }/node_modules/${pkg.name}`);
          } else {
            // Otherwise copy only the package files
            shelljs.exec(
              `mkdir -p packages/${pkg.dependents[k]}/node_modules/${pkg.name}`
            );
            ['package.json', ...pkg.files].forEach(file => {
              const copyTo = `packages/${pkg.dependents[k]}/node_modules/${
                pkg.name
              }/${file}`;
              // If file just copy
              if (file.includes('.')) {
                shelljs.exec(`cp packages/${pkg.name}/${file} ${copyTo}`);
              } else {
                // Handle folders
                shelljs.exec(`cp -R packages/${pkg.name}/${file}/ ${copyTo}`);
              }
            });
          }
        }
      })
    );
  }
}

exports.getPackages = getPackages;
exports.topologicallyBatchPackages = topologicallyBatchPackages;
exports.installBatchedPackages = installBatchedPackages;
