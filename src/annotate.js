// @flow
/* eslint-env node */
/* eslint-disable no-console*/
const proc = require('child_process');
const util = require('util');

const withEachRepo = require('fusion-orchestrate/src/utils/withEachRepo.js');

const query = require('./queries/lastCompletedBuild.js');

const exec = util.promisify(proc.exec);

const ignoredRepos = [
  'probot-app-workflow',
  'fusion-release',
  'fusion-plugin-service-worker',
];

async function annotate() {
  const commitMetadata = {};

  // Build a map of repos and set metadata
  await withEachRepo(async (api, repo) => {
    if (repo.upstream !== 'fusionjs' || ignoredRepos.includes(repo.name)) {
      return;
    }
    const root = 'packages';
    const {upstream, name} = repo;
    const dir = `${upstream}/${name}`;
    const hash = await exec(`git log -n 1 --pretty=format:"%H"`, {
      cwd: `${root}/${dir}`,
    });
    const metadataKey = `sha-${dir.replace(/\//g, '-')}`;
    console.log('DEBUG: Hash is: ', metadataKey, hash);
    commitMetadata[metadataKey] = hash;
    await exec(`buildkite-agent meta-data set ${metadataKey} ${hash}`);
  });

  // Query for last build metadata
  const metadata = await exec(`curl https://graphql.buildkite.com/v1 \
  -H "Authorization: Bearer ${String(process.env.BUILDKITE_API_TOKEN)}" \
  -d '{
    "query": "${query}",
    "variables": "{ }"
  }'`);
  console.log('metadata is?', commitMetadata);
  console.log('Debug, metadata is?', metadata);

  // Annotate build with commit info
}

// Only run on CI
if (process.env.BUILDKITE) {
  annotate();
} else {
  console.log('Not running in CI, exiting.');
}
