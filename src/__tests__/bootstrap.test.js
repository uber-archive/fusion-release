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
const {bootstrap} = require('../bootstrap');

describe('bootstrap', () => {
  test(
    'builds the monorepo',
    async () => {
      await bootstrap();

      // Flow config exists
      expect(fs.existsSync(__dirname + '/../../.flowconfig')).toBe(true);
    },
    60 * 60 * 1000
  );
});
