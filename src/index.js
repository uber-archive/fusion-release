/* eslint-env node */
/* eslint-disable no-console*/
const shelljs = require('shelljs');
const withEachRepo = require('fusion-orchestrate/src/utils/withEachRepo.js');
const packageUtils = require('./packageUtils');

(async function() {
  const ignoredRepos = [
    'probot-app-workflow',
    'fusion-release',
    'fusion-plugin-service-worker',
  ];

  const allPackages = [];
  await withEachRepo(async (api, repo) => {
    if (repo.upstream !== 'fusionjs' || ignoredRepos.includes(repo.name)) {
      return;
    }
    allPackages.push(repo.name);
    // eslint-disable-next-line no-console
    console.log(`Cloning repository: ${repo.upstream}/${repo.name}`);

    shelljs.exec(`
      cd packages &&
      git clone --depth 1 https://github.com/${repo.upstream}/${repo.name}.git
    `);
  });

  console.log('Initializing topologically sorted monorepo.');
  const packages = packageUtils.getPackages(allPackages);
  console.log('Building batches.');
  const batches = packageUtils.topologicallyBatchPackages(packages);
  console.log('Installing and transpiling batched package groups.');
  await packageUtils.installBatchedPackages(batches);
})();
