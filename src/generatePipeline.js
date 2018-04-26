// @flow
/* eslint-env node */
const fs = require('fs');
const shelljs = require('shelljs');
const withEachRepo = require('fusion-orchestrate/src/utils/withEachRepo.js');

(async function() {
  const ignoredRepos = [
    'probot-app-workflow',
    'fusion-release',
    'fusion-plugin-service-worker',
  ];
  const testSteps = [];

  await withEachRepo(async (api, repo) => {
    if (repo.upstream !== 'fusionjs' || ignoredRepos.includes(repo.name)) {
      return;
    }

    testSteps.push({
      name: `${repo.name} test`,
      command: `cd ${repo.name} && yarn test`,
      agent: {
        queue: 'workers',
      },
      plugins: {
        'docker-compose#v1.7.0': {
          run: 'fusion-release',
        },
      },
    });
  });

  fs.writeFileSync(__dirname + '/steps.json', JSON.stringify(testSteps));

  // eslint-disable-next-line no-console
  console.log('Initializing lerna monorepo and uploading pipeline.');
  shelljs.exec(`
      buildkite-agent pipeline upload steps.json
    `);
})();
