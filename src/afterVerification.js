// @flow
/* eslint-env node */
/* eslint-disable no-console */

const shelljs = require('shelljs');

const octokit = require('@octokit/rest')({
  timeout: 0,
  requestMedia: 'application/vnd.github.v3+json',
  headers: {
    'user-agent': 'octokit/rest.js v1.2.3',
  },
});

octokit.authenticate({
  type: 'token',
  token: process.env.GITHUB_TOKEN,
});

module.exports = async function afterVerification() {
  const statusMetadata = shelljs.exec('buildkite-agent meta-data get "status"');
  const isPrerelease = shelljs.exec(
    'buildkite-agent meta-data get "prerelease"'
  );

  // No need to update statuses for prereleases or when there is no status.
  if (isPrerelease === 'true' || statusMetadata === '') {
    return;
  }

  const sha = String(
    shelljs.exec('buildkite-agent meta-data get "release-pr-head-sha"')
  );
  const [owner, repo] = shelljs
    .exec('buildkite-agent meta-data get "release-pr-base-repo-full-name"')
    .split('/');

  const newState = statusMetadata == 'failure' ? 'failure' : 'success';
  console.log(`Updating Buildkite verification status to ${newState}`);
  console.log(`Owner: ${owner}`);
  console.log(`Repo: ${repo}`);
  console.log(`Sha: ${sha}`);
  console.log(`Targe URL: ${String(process.env.BUILDKITE_BUILD_URL)}`);

  await octokit.repos.createStatus({
    owner,
    repo,
    sha,
    state: newState,
    target_url: process.env.BUILDKITE_BUILD_URL,
    description: `Verification build resulted in ${newState}`,
    context: 'probot/release-verification',
  });
};
