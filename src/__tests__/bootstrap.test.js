/* eslint-env jest */

const shelljs = require('shelljs');
const {bootstrap} = require('../bootstrap');

describe('botstrap', () => {
  test('builds and installs modules correctly', async () => {
    const allPackages = ['a', 'b'];
    await bootstrap(allPackages, 'src/__tests__/fixture');

    const output = shelljs.exec('node src/__tests__/fixture/b/index.js');
    expect(output.stdout).toBe('dep: a\n');
  });
});
