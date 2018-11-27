/** Copyright (c) 2018 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/* eslint-env jest, node */

const afterVerification = require('../afterVerification');

// Mock buildkite agent meta-data calls
jest.mock('shelljs', () => {
  return {
    exec: command => {
      if (command.includes('"prerelease"')) {
        return '';
      } else if (command.includes('"release-pr-head-sha"')) {
        return '';
      } else if (command.includes('"release-pr-base-repo-full-name"')) {
        return '';
      } else if (command.includes('"status"')) {
        return '';
      }
    },
  };
});

jest.mock('@octokit/rest', () => {
  const createStatus = jest.fn();
  return () => ({
    authenticate: () => {},
    repos: {
      createStatus,
    },
  });
});

const octokit = require('@octokit/rest');

describe('scheduled verification', () => {
  test('does not update github', async () => {
    afterVerification();
    expect(octokit().repos.createStatus.mock.calls.length).toBe(0);
  });
});
