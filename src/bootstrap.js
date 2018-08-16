/** Copyright (c) 2018 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/* eslint-env node */
/* eslint-disable no-console*/
const fs = require('fs');
const util = require('util');
const proc = require('child_process');
const withEachRepo = require('fusion-orchestrate/src/utils/withEachRepo.js');

const exec = util.promisify(proc.exec);
const mkdir = util.promisify(fs.mkdir);
const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

module.exports.bootstrap = async (
  root: string = 'packages',
  additionalRepos: Array<string> = []
) => {
  const options = {cwd: root};

  const allPackages = [];

  const ignoredRepos = [
    'probot-app-workflow',
    'fusion-release',
    'fusion-plugin-service-worker',
  ];

  // Build initial dependencies for all packages.
  const deps = {
    dependencies: {},
    devDependencies: {},
    peerDependencies: {},
  };
  const resolutions = {};
  await withEachRepo(async (api, repo) => {
    if (repo.upstream !== 'fusionjs' || ignoredRepos.includes(repo.name)) {
      return;
    }
    allPackages.push(repo);

    const rawPackageContent = (await exec(
      `curl https://raw.githubusercontent.com/fusionjs/${
        repo.name
      }/master/package.json`
    )).stdout;
    const packageJson = JSON.parse(rawPackageContent);
    resolutions[repo.name] = `fusionjs/${repo.name}`;
    deps.dependencies = {
      [repo.name]: `fusionjs/${repo.name}`,
      ...deps.dependencies,
      ...packageJson.dependencies,
    };
    deps.devDependencies = {
      ...deps.devDependencies,
      ...packageJson.devDependencies,
    };
    deps.peerDependencies = {
      ...deps.peerDependencies,
      ...packageJson.peerDependencies,
    };
  });

  // Override deps for our packages.
  allPackages.forEach(dep => {
    if (deps.devDependencies[dep.name]) {
      deps.devDependencies[dep.name] = `fusionjs/${dep.name}`;
    }
    if (deps.dependencies[dep.name]) {
      deps.dependencies[dep.name] = `fusionjs/${dep.name}`;
    }
  });

  const data = JSON.stringify(
    {
      name: 'verification',
      private: true,
      ...deps,
      resolutions,
    },
    null,
    '  '
  );

  await exec(`mkdir -p ${root}`);
  await writeFile(`${root}/package.json`, data, 'utf-8');
  await exec(`yarn install`, options);

  // a horrible hack for a horrible bug... see https://github.com/facebook/flow/issues/1420
  await exec(`
    rm -f ${root}/node_modules/chrome-devtools-frontend/protocol.json &&
    rm -f ${root}/node_modules/devtools-timeline-model/node_modules/chrome-devtools-frontend/protocol.json
  `);
  const flowConfig = `[ignore]
.*src/fixtures/failure.*

[include]

[libs]
./fusionjs/fusion-core/flow-typed
./fusionjs/fusion-test-utils/flow-typed/tape-cup_v4.x.x.js

[lints]

[options]

[strict]`;
  await writeFile(`${root}/.flowconfig`, flowConfig, 'utf-8');

  // Make a flow-typed directory and pull everything into it.
  try {
    await mkdir(`${root}/flow-typed`);
    await mkdir(`${root}/flow-typed/npm`);
  } catch (e) {
    console.log('Could not create directory', e);
  }
  await Promise.all(
    allPackages.map(async ({name}) => {
      try {
        await exec(
          `cp -Rf ${root}/node_modules/${name}/flow-typed/npm/* ${root}/flow-typed/npm/. || true`
        );
      } catch (e) {
        console.log('Error when copying', e);
      }
    })
  );

  console.log(`Transpiling local dependencies`);
  const transpilable = [];
  await Promise.all(
    allPackages.map(async ({name}) => {
      const meta = JSON.parse(
        await readFile(`${root}/node_modules/${name}/package.json`)
      );
      const parts = meta.name.split('/');
      const isNamespaced = parts.length === 2;
      const rest = isNamespaced ? parts[0] : '';
      const cwd = [`${root}/node_modules`, rest].join('/');
      if (isNamespaced) await exec(`mkdir -p ${cwd}`);

      if (meta.scripts && meta.scripts.transpile) {
        transpilable.push(name);
      }
    })
  );
  let batch = transpilable;
  function* group(transpilable) {
    let list = transpilable;
    while (list.length) {
      yield list.slice(0, 30);
      list = list.slice(30);
    }
  }
  while (batch.length) {
    const failed = [];
    for (const g of group(batch)) {
      await Promise.all(
        g.map(async name => {
          try {
            console.log(`Transpiling ${name}`);
            await exec(`yarn transpile`, {cwd: `${root}/node_modules/${name}`});
          } catch (e) {
            console.log(`Error when transpiling ${name}`, e);
            failed.push(name);
          }
        })
      );
    }
    if (batch.length === failed.length) {
      throw new Error(`Can't transpile ` + failed.join(', '));
    }
    batch = failed;
  }
};
