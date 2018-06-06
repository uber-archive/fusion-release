/** Copyright (c) 2018 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/* eslint-env node */
/* eslint-disable no-console*/
const proc = require('child_process');
const util = require('util');

process.on('unhandledRejection', function(reason, p) {
  console.log(
    'Possibly Unhandled Rejection at: Promise ',
    p,
    ' reason: ',
    reason
  );
  process.exit(1);
});

const octokit = require('@octokit/rest')({
  timeout: 0,
  requestMedia: 'application/vnd.github.v3+json',
  headers: {
    'user-agent': 'octokit/rest.js v1.2.3',
  },
});

const withEachRepo = require('fusion-orchestrate/src/utils/withEachRepo.js');

const query = require('./queries/lastCompletedBuild.js');

const exec = util.promisify(proc.exec);

if (process.env.GITHUB_TOKEN) {
  octokit.authenticate({
    type: 'token',
    token: process.env.GITHUB_TOKEN,
  });
}

const ignoredRepos = [
  'probot-app-workflow',
  'fusion-release',
  'fusion-plugin-service-worker',
];

async function getCommitsLinks(owner, repo, lastCommit, currentCommit) {
  try {
    const result = await octokit.repos.compareCommits({
      owner,
      repo,
      base: lastCommit,
      head: currentCommit,
    });

    return result.data.commits.map(
      ({commit, sha}) =>
        `* <a href="https://github.com/${owner}/${repo}/commit/${sha}" target="_blank">${
          commit.message.split('\n')[0]
        }</a>`
    );
  } catch (e) {
    return ['Unable to load commits for revision range.'];
  }
}

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
    variables: {branch: ['master']},
  };
  const metadata = JSON.parse(
    (await exec(`curl https://graphql.buildkite.com/v1 \
  -H "Authorization: Bearer ${String(process.env.BUILDKITE_API_TOKEN)}" \
  -d '${JSON.stringify(postData)}'`)).stdout
  );

  // Annotate build with commit info
  const annotationData = [];

  const metadataEdges =
    metadata.data.organization.pipelines.edges[0].node.builds.edges[0].node
      .metaData.edges;
  for (let i = 0; i < metadataEdges.length; i++) {
    const {node} = metadataEdges[i];
    if (node.key && node.key.startsWith('sha-')) {
      const lastBuildCommit = node.value;
      const currentBuildCommit = commitMetadata[node.key];
      const repo = node.key.replace(/^sha-/, '').replace(/fusionjs-/, '');

      // Only show repo annotation if the commit is different.
      if (lastBuildCommit === currentBuildCommit) {
        continue;
      }

      const commits = await getCommitsLinks(
        'fusionjs',
        repo,
        lastBuildCommit,
        currentBuildCommit
      );

      annotationData.push(
        `**<a href="https://github.com/fusionjs/${repo}/compare/${lastBuildCommit}...${currentBuildCommit}" target="_blank">${repo}</a>**\n\n
${commits.join('\n')}\n`
      );
    }
  }

  if (annotationData.length > 0) {
    annotationData.unshift('## Commits since last verification build\n');
  } else {
    annotationData.push(
      '**No new commits found between this build and last verification build.**'
    );
  }

  console.log('Annotation is?', annotationData);
  await exec(
    `buildkite-agent annotate "${annotationData.join(
      '\n'
    )}" --style 'info' --context 'ctx-info'`
  );
}
module.exports = annotate;

// Only run on CI
if (require.main === module && process.env.BUILDKITE) {
  annotate();
} else {
  console.log('Not running in CI, exiting.');
}
