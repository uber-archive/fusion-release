// @flow
/* eslint-env node */
/* eslint-disable no-console*/

const util = require('util');
const proc = require('child_process');
const fs = require('fs');

const readDir = util.promisify(fs.readdir);
const lstat = util.promisify(fs.lstat);
const mv = util.promisify(fs.rename);

run();

async function run() {
  await rename('.flowconfig', '.flowconfig.tmp');
  const command = `yarn lerna exec --scope fusion-* --scope=browser-tests yarn flow check`;
  const [cmd, ...args] = command.split(' ');
  proc.spawn(cmd, args, {stdio: 'inherit'}).on('close', ({code}) => {
    rename('.flowconfig.tmp', '.flowconfig');
    if (code) process.exit(code);
  });
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
