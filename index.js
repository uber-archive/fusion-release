const fs = require('fs');
const shelljs = require('shelljs');
const withEachRepo = require('fusion-orchestrate/src/utils/withEachRepo.js');

(async function() {
  const ignoredRepos = ['probot-app-workflow', 'fusion-release'];
  const testSteps = [];

  await withEachRepo(async (api, repo) => {
    if (repo.upstream !== 'fusionjs' || ignoredRepos.includes(repo.name)) {
      return;
    }
    console.log(`Cloning repository: ${repo.upstream}/${repo.name}`);

    shelljs.exec(`
      cd packages &&
      git clone --depth 1 git@github.com:${repo.upstream}/${repo.name}.git
    `);

    testSteps.push({
      name: `${repo.name} test`,
      command: `cd ${repo.name} && npm run test`,
      agent: {
        queue: 'workers',
      },
    });
  });

  fs.writeFileSync(__dirname + '/steps.json', JSON.stringify(testSteps));

  console.log('Initializing lerna monorepo and uploading pipeline.');
  shelljs.exec(`
      ./node_modules/.bin/lerna init &&
      ./node_modules/.bin/lerna bootstrap &&
      buildkite-agent pipeline upload steps.json
    `);
})();
