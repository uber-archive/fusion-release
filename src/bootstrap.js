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
const lstat = util.promisify(fs.lstat);
const mkdir = util.promisify(fs.mkdir);
const readDir = util.promisify(fs.readdir);
const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

module.exports.getPackages = async (
  root: string = 'packages',
  additionalRepos: Array<string> = []
) => {
  const options = {cwd: root};
  const reset = `
    git reset --hard &&
    git clean -xdf &&
    git fetch &&
    git checkout origin/master &&
    git branch -D master &&
    git checkout -b master
  `;
  const ignoredRepos = [
    'probot-app-workflow',
    'create-fusion-app',
    'fusion-release',
    'fusion-plugin-service-worker',
  ];

  await exec(`mkdir -p ${root}`);
  console.log(`Cloning repositories`);
  const allPackages = [];
  await withEachRepo(async (api, repo) => {
    if (repo.upstream !== 'fusionjs' || ignoredRepos.includes(repo.name)) {
      return;
    }
    allPackages.push(`${repo.upstream}/${repo.name}`);
    const {upstream, name} = repo;
    const dir = `${upstream}/${name}`;
    if (!(await isFile(`${root}/${dir}/package.json`))) {
      const url = `https://github.com/${dir}.git`;
      await exec(`git clone --depth 1 ${url} ${dir}`, options);
    } else await exec(reset, {cwd: `${root}/${dir}`});
  });

  // Process anything from the ADDITIONAL_REPOS env var
  if (additionalRepos) {
    if (additionalRepos && additionalRepos.length) {
      for (let i = 0; i < additionalRepos.length; i++) {
        const parts = /([a-z0-9\-_]+)\/([a-z0-9\-_]+)$/i;
        // $FlowFixMe
        const [, owner, name] = additionalRepos[i].match(parts);
        const dir = `${owner}/${name}`;
        const url = additionalRepos[i];
        if (!(await isFile(`${root}/${dir}/package.json`))) {
          await exec(`git clone --depth 1 ${url} ${dir}`, options);
        } else await exec(reset, {cwd: `${root}/${dir}`});
        allPackages.push(dir);
      }
    }
  }

  return allPackages;
};

module.exports.bootstrap = async (
  allPackages: Array<string>,
  root: string = 'packages'
) => {
  const options = {cwd: root};

  console.log('Installing dependencies');
  const names = [];
  const deps = await allPackages.reduce(async (memo, dir) => {
    // eslint-disable-next-line import/no-dynamic-require
    const meta = JSON.parse(await readFile(`${root}/${dir}/package.json`));
    names.push(meta.name);
    return {
      ...(await memo),
      ...(meta.dependencies || {}),
      ...(meta.devDependencies || {}),
      ...(meta.peerDependencies || {}),
    };
  }, {});
  for (const key in deps) {
    if (names.indexOf(key) > -1) delete deps[key];
  }
  const data = JSON.stringify({
    name: 'verification',
    private: true,
    dependencies: deps,
  });
  await writeFile(`${root}/package.json`, data, 'utf-8');
  await exec(`yarn install`, options);

  // a horrible hack for a horrible bug... see https://github.com/facebook/flow/issues/1420
  await exec(`
    rm -f ${root}/node_modules/chrome-devtools-frontend/protocol.json &&
    rm -f ${root}/node_modules/devtools-timeline-model/node_modules/chrome-devtools-frontend/protocol.json
  `);
  const flowConfig = `[ignore]

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
    allPackages.map(async dir => {
      try {
        await exec(
          `cp -Rf ${root}/${dir}/flow-typed/npm/* ${root}/flow-typed/npm/. || true`
        );
      } catch (e) {
        console.log('Error when copying', e);
      }
    })
  );

  console.log(`Linking local dependencies`);
  const transpilable = [];
  await Promise.all(
    allPackages.map(async dir => {
      // eslint-disable-next-line import/no-dynamic-require
      const meta = JSON.parse(await readFile(`${root}/${dir}/package.json`));
      const parts = meta.name.split('/');
      const isNamespaced = parts.length === 2;
      const name = parts.pop();
      const rest = isNamespaced ? parts[0] : '';
      const cwd = [`${root}/node_modules`, rest].join('/');
      if (isNamespaced) await exec(`mkdir -p ${cwd}`);
      const rel = isNamespaced ? '../..' : '..';
      if (!(await isSymlink(`${cwd}/${name}`))) {
        await exec(`ln -sfn ${rel}/${dir}/ ${name}`, {cwd});
      }

      const dirs = await readDir(`${root}/node_modules`);
      await exec(`mkdir -p ${root}/${dir}/node_modules`);
      for (const d of dirs) {
        if (d === dir) continue;
        const opts = {cwd: `${root}/${dir}/node_modules`};
        if (!(await isSymlink(`${opts.cwd}/${d}`))) {
          await exec(`ln -sfn ../../../node_modules/${d}/ ${d}`, opts);
        }
      }

      if (meta.bin) {
        for (const key in meta.bin) {
          if (!(await isSymlink(`${root}/node_modules/.bin/${key}`))) {
            await exec(`ln -sfn ../../${dir}/${meta.bin[key]} ${key}`, {
              cwd: `${root}/node_modules/.bin/`,
            });
          }
        }
      }

      if (meta.scripts && meta.scripts.transpile) {
        transpilable.push(dir);
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
        g.map(async dir => {
          try {
            await exec(`yarn transpile`, {cwd: `${root}/${dir}`});
          } catch (e) {
            failed.push(dir);
          }
        })
      );
    }
    if (batch.length === failed.length) {
      throw new Error(`Can't transpile` + failed.join(', '));
    }
    batch = failed;
  }
};

async function isFile(filename) {
  try {
    return (await lstat(filename)).isFile();
  } catch (e) {
    return false;
  }
}

async function isSymlink(filename) {
  try {
    return (await lstat(filename)).isSymbolicLink();
  } catch (e) {
    return false;
  }
}
