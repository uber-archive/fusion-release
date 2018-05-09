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
    const hash = (await exec(`git log -n 1 --pretty=format:"%H"`, {
      cwd: `${root}/${dir}`,
    })).stdout;
    const metadataKey = `sha-${dir.replace(/\//g, '-')}`;
    commitMetadata[metadataKey] = hash;
    await exec(`buildkite-agent meta-data set ${metadataKey} ${hash}`);
  });

  // Query for last build metadata
  const postData = {
    query: query,
    variables: {branch: ['annotate-commit-information']},
  };
  const metadata = JSON.parse(
    (await exec(`curl https://graphql.buildkite.com/v1 \
  -H "Authorization: Bearer ${String(process.env.BUILDKITE_API_TOKEN)}" \
  -d '${JSON.stringify(postData)}'`)).stdout
  );

  // Annotate build with commit info
  const annotationData = ['# Commits since last verification build\n'];

  metadata.data.organization.pipelines.edges[0].node.builds.edges[0].node.metaData.edges.forEach(
    ({node}) => {
      if (node.key && node.key.startsWith('sha-')) {
        const ghPath = node.key
          .replace(/^sha-/, '')
          .replace(/fusionjs-/, 'fusionjs/');
        annotationData.push(
          `**<a href="https://github.com/${ghPath}/compare/${node.value}...${
            commitMetadata[node.key]
          }" target="_blank">${ghPath}</a>**\n\n${commitMetadata[node.key]}...${
            node.value
          }\n`
        );
      }
    }
  );

  console.log('Annotation is?', annotationData);
  await exec(
    `buildkite-agent annotate "${annotationData.join(
      '\n'
    )}" --style 'info' --context 'ctx-info'`
  );
}

// Only run on CI
if (process.env.BUILDKITE) {
  annotate();
} else {
  console.log('Not running in CI, exiting.');
}
