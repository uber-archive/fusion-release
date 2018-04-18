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
        console.log(`Cloning repository: ${dir}`);

        const repo = `https://github.com/${dir}.git`;
        await exec(`git clone --depth 1 ${repo} ${dir}`, options);
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
        if (!await isFile(`packages/${dir}/package.json`)) {
          const repo = additionalRepos[i];
          await exec(`git clone --depth 1 ${repo} ${dir}`, options);
        }
        await exec(reset, {cwd: `packages/${dir}`});
        allPackages.push(dir);
      }
    }
  }
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

  // copy fusion packages after running `yarn add` because `yarn add` deletes things that are not in lock file
  allPackages.forEach(async dir => {
    // eslint-disable-next-line import/no-dynamic-require
    const meta = JSON.parse(await readFile(`packages/${dir}/package.json`));
    const parts = meta.name.split('/');
    const name = parts.pop();
    const cwd = ['packages/node_modules', ...parts].join('/');
    await exec(`ln -s ../${dir}/ ${name}`, {cwd});
    const dirs = await readDir('packages/node_modules');
    await exec(`mkdir -p packages/${dir}/node_modules`);
    for (const d of dirs) {
      await exec(`ln -s ../../../node_modules/${d}/ ${d}`, {
        cwd: `packages/${dir}/node_modules`,
      });
    }
  });
})();

async function isFile(filename) {
  try {
    return (await lstat(filename)).isFile();
  } catch (e) {
    return false;
  }
}
