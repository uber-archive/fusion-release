const shelljs = require('shelljs');
const withEachRepo = require('fusion-orchestrate/src/utils/withEachRepo.js');

(async function() {
  const ignoredRepos = ['probot-app-workflow'];

  await withEachRepo(async (api, repo) => {
    if (repo.upstream !== 'fusionjs' || ignoredRepos.includes(repo.name)) {
      return;
    }
    console.log(`Cloning repository: ${repo.upstream}/${repo.name}`);

    shelljs.exec(`
      cd packages &&
      git clone --depth 1 git@github.com:${repo.upstream}/${repo.name}.git
    `);
  });

  console.log('Initializing lerna monorepo');
  shelljs.exec(`
    ./node_modules/.bin/lerna init
  `);
})();
