// @flow
/* eslint-env node */
const {getPackages, bootstrap} = require('./bootstrap.js');

run();

async function run() {
  await bootstrap(await getPackages());
}
