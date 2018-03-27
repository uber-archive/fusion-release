/* eslint-env node */
/* eslint-disable no-console*/
const fs = require('fs');
const util = require('util');
const shelljs = require('shelljs');
const withEachRepo = require('fusion-orchestrate/src/utils/withEachRepo.js');
const packageUtils = require('./packageUtils');

const lstat = util.promisify(fs.lstat);

(async function() {
  const ignoredRepos = [
    'probot-app-workflow',
    'fusion-release',
    'fusion-plugin-service-worker',
  ];

  shelljs.exec('mkdir packages');

  const allPackages = [];
  await withEachRepo(async (api, repo) => {
    if (repo.upstream !== 'fusionjs' || ignoredRepos.includes(repo.name)) {
      return;
    }
    allPackages.push(`${repo.upstream}/${repo.name}`);
    const {upstream, name} = repo;
    if (!await isFile(`packages/${repo.upstream}/${repo.name}/package.json`)) {
      // eslint-disable-next-line no-console
      console.log(`Cloning repository: ${repo.upstream}/${repo.name}`);

      shelljs.exec(`
        cd packages &&
        git clone --depth 1 https://github.com/${upstream}/${name}.git ${upstream}/${name}
      `);
    }
    shelljs.exec('git reset --hard && git pull', {
      cwd: `packages/${upstream}/${name}`,
    });
  });

  // Process anything from the ADDITIONAL_REPOS env var
  if (process.env.ADDITIONAL_REPOS) {
    const additionalRepos = process.env.ADDITIONAL_REPOS.split(',');
    if (additionalRepos && additionalRepos.length) {
      for (let i = 0; i < additionalRepos.length; i++) {
        const [, owner, name] = additionalRepos[i].match(
          /([a-z0-9\-_]+)\/([a-z0-9\-_]+)$/i
        );
        shelljs.exec(`
          cd packages &&
          git clone --depth 1 ${additionalRepos[i]} ${owner}/${name}
        `);
        allPackages.push(`${owner}/${name}`);
      }
    }
  }

  console.log('Initializing topologically sorted monorepo.');
  const packages = packageUtils.getPackages(allPackages);
  console.log('Building batches.');
  const batches = packageUtils.topologicallyBatchPackages(packages);
  console.log('Installing and transpiling batched package groups.');
  await packageUtils.installBatchedPackages(batches);
})();

async function isFile(filename) {
  try {
    return (await lstat(filename)).isFile();
  } catch (e) {
    return false;
  }
}
