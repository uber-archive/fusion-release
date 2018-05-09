/* eslint-env node */
/* eslint-env jest */

const annotate = require('../annotate');

function getBuildkiteMetadataResp(metadataEdges) {
  return {
    data: {
      organization: {
        pipelines: {
          edges: [
            {
              node: {
                builds: {
                  edges: [
                    {
                      node: {
                        metaData: {
                          edges: metadataEdges,
                        },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    },
  };
}

jest.mock('fusion-orchestrate/src/utils/withEachRepo.js', () => callback => {
  callback(null, {
    name: 'fusion-cli',
    upstream: 'fusionjs',
  });
});

jest.mock('child_process', () => {
  const __commandMock__ = jest.fn();
  const __graphQlMock__ = jest.fn();
  const __currentCommitMock__ = jest.fn();
  return {
    __commandMock__,
    __graphQlMock__,
    __currentCommitMock__,
    exec: (command, options, callback) => {
      if (!callback) {
        callback = options;
      }
      if (command.includes('graphql.buildkite')) {
        return callback(null, {
          stdout: JSON.stringify(__graphQlMock__()),
        });
      } else if (command.startsWith('git log')) {
        return callback(null, {
          stdout: __currentCommitMock__(),
        });
      } else if (command.startsWith('buildkite-agent annotate')) {
        __commandMock__(command);
        return callback(null, {
          stdout: '',
        });
      }
    },
  };
});

const {
  __commandMock__,
  __currentCommitMock__,
  __graphQlMock__,
} = require('child_process');

describe('annotate', () => {
  test('annotates when no commits differ', async () => {
    __currentCommitMock__.mockReturnValueOnce('TEST-MOCK-COMMIT');
    __graphQlMock__.mockReturnValueOnce(
      getBuildkiteMetadataResp([
        {
          node: {
            key: 'sha-fusionjs-fusion-cli',
            value: 'TEST-MOCK-COMMIT',
          },
        },
      ])
    );
    await annotate();
    expect(__commandMock__.mock.calls[0][0]).toContain('No new commits');
  });

  test('annotates when commits differ', async () => {
    __currentCommitMock__.mockReturnValueOnce(
      '3e15f758140a7833e3e391cfc24aa2304634b449'
    );
    __graphQlMock__.mockReturnValueOnce(
      getBuildkiteMetadataResp([
        {
          node: {
            key: 'sha-fusionjs-fusion-cli',
            value: 'dac0a31e8cf66d8d908672c1c3e49037f38ce805',
          },
        },
      ])
    );
    await annotate();
    const annotation = __commandMock__.mock.calls[1][0];
    expect(annotation).toContain('Commits since last verification build');
    expect(annotation).toContain(
      'https://github.com/fusionjs/fusion-cli/compare/3e15f758140a7833e3e391cfc24aa2304634b449...dac0a31e8cf66d8d908672c1c3e49037f38ce805'
    );
  });
});
