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
    this.nodesByPath = {};

    for (let p = 0; p < packages.length; p += 1) {
      const pkg = packages[p];
      const node = new PackageGraphNode(pkg);
      this.nodes.push(node);
      this.nodesByPath[pkg.getPath()] = node;
    }

    for (let n = 0; n < this.nodes.length; n += 1) {
      const node = this.nodes[n];
      const dependencies = node.package.allDependencies || {};
      const depNames = Object.keys(dependencies);

      for (let d = 0; d < depNames.length; d += 1) {
        const depName = depNames[d];
        const packageNode = this.nodesByPath[depName];

        if (packageNode) {
          node.dependencies.push(depName);
        }
      }
    }
  }

  get(packageName) {
    return this.nodesByPath[packageName];
  }
}

class Package {
  constructor(workDir, packageName, packageJsons) {
    const packageList = packageJsons.map(p => p.name);
    const packageJson = PackageUtils.getPackageJson(workDir, packageName);
    const [owner, name] = packageName.split('/');
    this.owner = owner;
    this.name = name;
    this.scopedPath = packageJson.name;
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
    this.nonFusionDependencies = Object.keys(packageJson.dependencies || {})
      .filter(key => !packageList.includes(key))
      .reduce((obj, key) => {
        obj[key] = packageJson.dependencies[key];
        return obj;
      }, {});
    this.nonFusionDevDependencies = Object.keys(
      packageJson.devDependencies || {}
    )
      .filter(key => !packageList.includes(key))
      .reduce((obj, key) => {
        obj[key] = packageJson.devDependencies[key];
        return obj;
      }, {});
  }

  getPath() {
    return `${this.owner}/${this.name}`;
  }
}

class PackageUtils {
  constructor({dir}) {
    this.dir = dir || 'packages';
  }

  static getPackageJson(workDir, packageName) {
    // eslint-disable-next-line import/no-dynamic-require
    return require(path.join(workDir, packageName, 'package.json'));
  }

  getPackages(packageList) {
    const workDir = process.cwd() + '/' + this.dir;
    const packageJsons = packageList.map(p =>
      PackageUtils.getPackageJson(workDir, p)
    );
    const packages = packageList.map(
      packageName => new Package(workDir, packageName, packageJsons)
    );

    // Gather dependents information.
    const dependents = {};
    packages.forEach(pkg => {
      Object.keys(pkg.fusionDependencies).forEach(fusionDependency => {
        dependents[fusionDependency] = dependents[fusionDependency] || [];
        dependents[fusionDependency].push(pkg.getPath());
      });
    });

    // Insert depentents information.
    packages.forEach(pkg => {
      const key = pkg.scopedPath;
      if (dependents[key]) {
        pkg.dependents = dependents[key];
      }
    });

    return packages;
  }

  topologicallyBatchPackages(allPackages, {rejectCycles} = {}) {
    const packages = [...allPackages];
    const packageGraph = new PackageGraph(packages);

    // This maps package names to the number of packages that depend on them.
    // As packages are completed their names will be removed from this object.
    const refCounts = {};
    packages.forEach(pkg =>
      packageGraph.get(pkg.getPath()).dependencies.forEach(dep => {
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
        const node = packageGraph.get(pkg.getPath());
        return node.dependencies.filter(dep => refCounts[dep]).length === 0;
      });

      // If we weren't able to find a package with no remaining dependencies,
      // then we've encountered a cycle in the dependency graph.  Run a
      // single-package batch with the package that has the most dependents.
      if (packages.length && !batch.length) {
        const cyclePackagePaths = packages.map(p => `"${p.getPath()}"`);
        const message = `${'Encountered a cycle in the dependency graph.' +
          'This may cause instability! Packages in cycle are: '}${cyclePackagePaths.join(
          ', '
        )}`;

        if (rejectCycles) {
          throw new Error(message);
        }
        console.warn('ECYCLE', message);

        batch.push(
          packages.reduce(
            (a, b) =>
              (refCounts[a.getPath()] || 0) > (refCounts[b.getPath()] || 0)
                ? a
                : b
          )
        );
      }

      batches.push(batch);

      batch.forEach(pkg => {
        delete refCounts[pkg.getPath()];
        packages.splice(packages.indexOf(pkg), 1);
      });
    }

    return batches;
  }

  async installBatchedPackages(batches) {
    // Install non-fusion dependencies for all packages first.
    console.log(
      chalk.bold.blue(`installing package.json non-fusion dependencies`)
    );

    const packageLookup = {};
    batches.forEach(batch =>
      batch.forEach(pkg => (packageLookup[pkg.scopedPath] = pkg))
    );

    /**
     * Finds all missing dependencies that should be installed.
     * These are dependencies that meet the following criteria.
     * - A dependency of a fusion repo that we are linking.
     * - Not listed in our package dependencies.
     */
    function findMissingDeps(pkg, type) {
      const additionalDeps = {};
      Object.keys(pkg.fusionDependencies).forEach(fusionDependency => {
        const depPackage = packageLookup[fusionDependency];
        Object.keys(depPackage[type]).forEach(dep => {
          if (!pkg[type][dep]) {
            additionalDeps[dep] = depPackage[type][dep];
          }
        });
      });
      return additionalDeps;
    }

    function generatePinnedDeps(deps) {
      return Object.keys(deps)
        .map(dep => `${dep}@${deps[dep]}`)
        .join(' ');
    }

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      await Promise.all(
        batch.map(async pkg => {
          console.log(`${pkg.getPath()} - installing dependencies`);
          const path = `${this.dir}/${pkg.getPath()}`;
          const deps = generatePinnedDeps({
            ...pkg.nonFusionDependencies,
            ...findMissingDeps(pkg, 'nonFusionDependencies'),
          });
          if (deps) {
            shelljs.exec(`cd ${path} && yarn add ${deps}`);
          }
          const devDeps = generatePinnedDeps({
            ...pkg.nonFusionDevDependencies,
            ...findMissingDeps(pkg, 'nonFusionDevDependencies'),
          });
          if (devDeps) {
            shelljs.exec(`cd ${path} && yarn add ${devDeps} --dev`);
          }
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
            console.log(`${pkg.getPath()} - transpiling`);
            shelljs.exec(`cd ${this.dir}/${pkg.getPath()} && yarn transpile`);
          }

          // Copy into all dependents
          for (let k = 0; k < pkg.dependents.length; k++) {
            console.log(
              `${pkg.getPath()} - copying into dependent ${pkg.dependents[k]}`
            );
            const dir = this.dir;
            const dep = pkg.dependents[k];
            const targetDir = `${dir}/${dep}/node_modules/${pkg.scopedPath}`;
            shelljs.exec(`mkdir -p ${targetDir}`);
            // If there are no package files copy everything
            if (!pkg.files) {
              shelljs.exec(`cp -R ${targetDir}`);
            } else {
              // Otherwise copy only the package files
              ['package.json', ...pkg.files].forEach(file => {
                const copyTo = `${targetDir}/${file}`;
                const sourceDir = `${this.dir}/${pkg.getPath()}/${file}`;
                // If file just copy
                if (file.includes('.')) {
                  shelljs.exec(`cp ${sourceDir} ${copyTo}`);
                } else {
                  // Handle folders
                  shelljs.exec(`mkdir -p ${copyTo}`);
                  shelljs.exec(`cp -R ${sourceDir}/. ${copyTo}/`);
                }
              });
            }
          }
        })
      );
    }
  }
}

module.exports = PackageUtils;
