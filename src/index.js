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

  // Process anything from the ADDITIONAL_REPOS env var
  if (process.env.ADDITIONAL_REPOS) {
    const additionalRepos = process.env.ADDITIONAL_REPOS.split(',');
    if (additionalRepos && additionalRepos.length) {
      for (let i = 0; i < additionalRepos.length; i++) {
        shelljs.exec(`
          cd packages &&
          git clone --depth 1 ${additionalRepos[i]}
        `);
        allPackages.push(additionalRepos[i].match(/([A-Za-z0-9\-_]*)$/)[1]);
      }
    }
  }

  console.log('Initializing topologically sorted monorepo.');
  const packages = packageUtils.getPackages(allPackages);
  console.log('Building batches.');
  const batches = packageUtils.topologicallyBatchPackages(packages);

  if (process.env.VERBOSE) {
    console.log(
      'Buidling batches:',
      JSON.stringify(
        batches.map(batch => batch.map(pkg => pkg.name)),
        null,
        '  '
      )
    );
  }

  console.log('Installing and transpiling batched package groups.');
  await packageUtils.installBatchedPackages(batches);
})();
