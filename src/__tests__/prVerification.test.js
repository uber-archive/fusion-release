/* eslint-env jest, node */

const afterVerification = require('../afterVerification');

// Mock buildkite agent meta-data calls
jest.mock('shelljs', () => {
  const __commandMock__ = jest.fn();
  return {
    __commandMock__,
    exec: command => {
      if (command.includes('"prerelease"')) {
        return false;
      } else if (command.includes('"release-pr-head-sha"')) {
        return 'TEST_SHA';
      } else if (command.includes('"release-pr-head-repo-full-name"')) {
        return 'TEST_OWNER/TEST_REPO';
      } else if (command.includes('"status"')) {
        return __commandMock__();
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
const {__commandMock__} = require('shelljs');

describe('pull request verification', () => {
  test('success - updates github status', async () => {
    process.env.BUILDKITE_BUILD_URL = 'http://buildkite...';
    __commandMock__.mockReturnValueOnce('success');
    afterVerification();
    expect(octokit().repos.createStatus.mock.calls[0][0]).toMatchSnapshot();
  });

  test('failure - updates github status', async () => {
    process.env.BUILDKITE_BUILD_URL = 'http://buildkite...';
    __commandMock__.mockReturnValueOnce('failure');
    afterVerification();
    expect(octokit().repos.createStatus.mock.calls[1][0]).toMatchSnapshot();
  });
});
