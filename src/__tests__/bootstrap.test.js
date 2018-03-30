/* eslint-env jest */

const shelljs = require('shelljs');
const {bootstrap} = require('../bootstrap');

describe('botstrap', () => {
  test('builds and installs modules correctly', async () => {
    const allPackages = ['pub/a', 'pub/b'];
    await bootstrap(allPackages, 'src/__tests__/fixture');

    const output = shelljs.exec('node src/__tests__/fixture/pub/b/index.js');
    expect(output.stdout).toBe('dep: a\n');
  });
  test('builds and installs scoped packages', async () => {
    const allPackages = ['priv/c', 'priv/d'];
    await bootstrap(allPackages, 'src/__tests__/fixture');

    const output = shelljs.exec('node src/__tests__/fixture/priv/d/index.js');
    expect(output.stdout).toBe('dep: c\n');
  });
});
