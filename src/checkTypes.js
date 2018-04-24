/* eslint-env node */
/* eslint-disable no-console*/

const util = require('util');
const proc = require('child_process');
const fs = require('fs');

const exec = util.promisify(proc.exec);
const readDir = util.promisify(fs.readdir);
const lstat = util.promisify(fs.lstat);
const mv = util.promisify(fs.rename);

run();

async function run() {
  await rename('.flowconfig', '.flowconfig.tmp');
  const {stdout} = await exec(
    `yarn lerna exec --scope fusion-* --scope=browser-tests yarn flow check`
  );
  await rename('.flowconfig.tmp', '.flowconfig');
  console.log(stdout);
  if (stdout.match(/Found [1-9]/)) process.exit(1);
}
async function rename(a, b) {
  const groups = await readDir('packages');
  for (const group of groups) {
    if (await isDirectory(`packages/${group}`)) {
      const repos = await readDir(`packages/${group}`);
      for (const repo of repos) {
        if (await isDirectory(`packages/${group}/${repo}`)) {
          if (await isFile(`packages/${group}/${repo}/${a}`)) {
            await mv(
              `packages/${group}/${repo}/${a}`,
              `packages/${group}/${repo}/${b}`
            );
          }
        }
      }
    }
  }
}
async function isFile(filename) {
  try {
    return (await lstat(filename)).isFile();
  } catch (e) {
    return false;
  }
}
async function isDirectory(filename) {
  try {
    return (await lstat(filename)).isDirectory();
  } catch (e) {
    return false;
  }
}
