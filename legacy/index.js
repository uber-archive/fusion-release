// @noflow
/* eslint-env node */
/* eslint-disable no-console*/
const fs = require('fs');
const util = require('util');
const shelljs = require('shelljs');
const withEachRepo = require('fusion-orchestrate/src/utils/withEachRepo.js');
const {bootstrap} = require('./bootstrap');

const lstat = util.promisify(fs.lstat);

(async function() {
  const ignoredRepos = [
    'probot-app-workflow',
    'fusion-release',
    'fusion-plugin-service-worker',
  ];

  shelljs.exec('mkdir -p packages');

  const allPackages = [];
  if (!process.env.IGNORE_CORE_REPOS) {
    await withEachRepo(async (api, repo) => {
      if (repo.upstream !== 'fusionjs' || ignoredRepos.includes(repo.name)) {
        return;
      }
      allPackages.push(`${repo.upstream}/${repo.name}`);
      const {upstream, name} = repo;
      if (
        !(await isFile(`packages/${repo.upstream}/${repo.name}/package.json`))
      ) {
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
  }

  // Process anything from the ADDITIONAL_REPOS env var
  if (process.env.ADDITIONAL_REPOS) {
    const additionalRepos = process.env.ADDITIONAL_REPOS.split(',');
    if (additionalRepos && additionalRepos.length) {
      for (let i = 0; i < additionalRepos.length; i++) {
        const [, owner, name] = additionalRepos[i].match(
          /([a-z0-9\-_]+)\/([a-z0-9\-_]+)$/i
        );
        if (!(await isFile(`packages/${owner}/${name}/package.json`))) {
          shelljs.exec(`
            cd packages &&
            git clone --depth 1 ${additionalRepos[i]} ${owner}/${name}
          `);
        }
        allPackages.push(`${owner}/${name}`);
      }
    }
  }

  await bootstrap(allPackages);
})();

async function isFile(filename) {
  try {
    return (await lstat(filename)).isFile();
  } catch (e) {
    return false;
  }
}
