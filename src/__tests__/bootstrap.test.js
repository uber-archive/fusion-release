/** Copyright (c) 2018 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/* eslint-env node */
/* eslint-env jest */

const fs = require('fs');
const shelljs = require('shelljs');
const {bootstrap} = require('../bootstrap');

describe('bootstrap', () => {
  test('builds and installs modules correctly', async () => {
    const allPackages = [
      {
        upstream: 'pub',
        name: ' a',
      },
      {
        upstream: 'pub',
        name: 'b',
      },
    ];

    // The pub/b package should not have `nop` listed.
    const packageBJson = require('./fixture/pub/b/package.json');
    expect(packageBJson.dependencies.nop).toBe(undefined);

    await bootstrap(allPackages, 'src/__tests__/fixture');

    const output = shelljs.exec('node src/__tests__/fixture/pub/b/index.js');
    expect(output.stdout).toBe('dep: a\n');

    // Should bring along package dependencies (currently the nop module)
    expect(
      fs.existsSync(__dirname + '/fixture/node_modules/nop/index.js')
    ).toBe(true);
  });
  test('builds and installs scoped packages', async () => {
    const allPackages = [
      {
        upstream: 'priv',
        name: ' a',
      },
      {
        upstream: 'priv',
        name: 'b',
      },
    ];
    await bootstrap(allPackages, 'src/__tests__/fixture');

    const output = shelljs.exec('node src/__tests__/fixture/priv/d/index.js');
    expect(output.stdout).toBe('dep: c\n');
  });
});
