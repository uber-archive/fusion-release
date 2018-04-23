/* eslint-env node */
/* eslint-disable no-console*/
const fs = require('fs');
const util = require('util');
const proc = require('child_process');
const withEachRepo = require('fusion-orchestrate/src/utils/withEachRepo.js');

const exec = util.promisify(proc.exec);
const lstat = util.promisify(fs.lstat);
const readDir = util.promisify(fs.readdir);
const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);
const link = util.promisify(fs.link);

const options = {cwd: 'packages'};
const reset = `
  git reset --hard &&
  git clean -xdf &&
  git fetch &&
  git checkout origin/master &&
  git branch -D master &&
  git checkout -b master
`;

(async function() {
  const ignoredRepos = [
    'probot-app-workflow',
    'fusion-release',
    'fusion-plugin-service-worker',
  ];

  await exec('mkdir -p packages');

  console.log(`Cloning repositories`);
  const allPackages = [];
  if (!process.env.IGNORE_CORE_REPOS) {
    await withEachRepo(async (api, repo) => {
      if (repo.upstream !== 'fusionjs' || ignoredRepos.includes(repo.name)) {
        return;
      }
      allPackages.push(`${repo.upstream}/${repo.name}`);
      const {upstream, name} = repo;
      const dir = `${upstream}/${name}`;
      if (!await isFile(`packages/${dir}/package.json`)) {
        const url = `https://github.com/${dir}.git`;
        await exec(`git clone --depth 1 ${url} ${dir}`, options);
      }
      await exec(reset, {cwd: `packages/${dir}`});
    });
  }

  // Process anything from the ADDITIONAL_REPOS env var
  if (process.env.ADDITIONAL_REPOS) {
    const additionalRepos = process.env.ADDITIONAL_REPOS.split(',');
    if (additionalRepos && additionalRepos.length) {
      for (let i = 0; i < additionalRepos.length; i++) {
        const parts = /([a-z0-9\-_]+)\/([a-z0-9\-_]+)$/i;
        const [, owner, name] = additionalRepos[i].match(parts);
        const dir = `${owner}/${name}`;
        const url = additionalRepos[i];
        if (!await isFile(`packages/${dir}/package.json`)) {
          await exec(`git clone --depth 1 ${url} ${dir}`, options);
        }
        await exec(reset, {cwd: `packages/${dir}`});
        allPackages.push(dir);
      }
    }
  }

  console.log('Installing dependencies');
  const deps = await allPackages.reduce(async (memo, dir) => {
    // eslint-disable-next-line import/no-dynamic-require
    const meta = JSON.parse(await readFile(`packages/${dir}/package.json`));
    return {
      ...(await memo),
      ...(meta.dependencies || {}),
      ...(meta.devDependencies || {}),
      ...(meta.peerDependencies || {}),
    };
  }, {});
  const data = JSON.stringify({
    name: 'verification',
    private: true,
    dependencies: deps,
  });
  await writeFile('packages/package.json', data, 'utf-8');
  await exec(`yarn install`, options);
  //await exec(`yarn add ${Object.keys(deps).join(' ')}`, options);

  // a horrible hack for a horrible bug... see https://github.com/facebook/flow/issues/1420
  await exec(`
    rm -f packages/node_modules/chrome-devtools-frontend/protocol.json &&
    rm -f packages/node_modules/devtools-timeline-model/node_modules/chrome-devtools-frontend/protocol.json
  `);
  const flowConfig = `[ignore]

[include]

[libs]
./fusionjs/fusion-core/flow.js
./fusionjs/fusion-core/flow-typed
./fusionjs/fusion-test-utils/flow-typed/tape-cup_v4.x.x.js

[lints]

[options]

[strict]`;
  await writeFile('packages/.flowconfig', flowConfig, 'utf-8');

  console.log(`Linking local dependencies`);
  const transpilable = [];
  await Promise.all(
    allPackages.map(async dir => {
      // eslint-disable-next-line import/no-dynamic-require
      const meta = JSON.parse(await readFile(`packages/${dir}/package.json`));
      const parts = meta.name.split('/');
      const name = parts.pop();
      const cwd = ['packages/node_modules', ...parts].join('/');
      await exec(`rm -rf ${name} && ln -sf ../${dir}/ ${name}`, {cwd});

      const dirs = await readDir('packages/node_modules');
      await exec(`mkdir -p packages/${dir}/node_modules`);
      if (await isFile(`packages/${dir}/.flowconfig`)) {
        await exec(
          `mv packages/${dir}/.flowconfig packages/${dir}/.flowconfig.tmp`
        );
      }
      for (const d of dirs) {
        if (d === dir) continue;
        const opts = {cwd: `packages/${dir}/node_modules`};
        await exec(`ln -sf ../../../node_modules/${d}/ ${d}`, opts);
      }

      if (meta.scripts && meta.scripts.transpile) transpilable.push(dir);
    })
  );
  await Promise.all(
    transpilable.map(dir => exec(`yarn transpile`, {cwd: `packages/${dir}`}))
  );
})();

async function isFile(filename) {
  try {
    return (await lstat(filename)).isFile();
  } catch (e) {
    return false;
  }
}
