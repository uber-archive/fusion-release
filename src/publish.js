/* eslint-env node */
/* eslint-disable no-console, import/no-dynamic-require */
const fs = require('fs');
const chalk = require('chalk');
const GitHubApi = require('github');
const shelljs = require('shelljs');
const packageUtils = require('./packageUtils');

const verbose = true;
const newVersion = require(`${__dirname}/../package.json`).version;
const fusionCoreVersion = require(`${__dirname}/../packages/fusion-core/package.json`)
  .version;
if (!fusionCoreVersion || newVersion === fusionCoreVersion) {
  console.log(
    chalk.bold.green.underline(
      `Current version (${newVersion}) matches fusion-core (${fusionCoreVersion}). Exiting.`
    )
  );
  process.exit();
}

const github = new GitHubApi({
  //debug: true,
  timeout: 5000,
  host: 'api.github.com',
  protocol: 'https',
  rejectUnauthorized: false,
});

github.authenticate({
  type: 'token',
  token: process.env.GITHUB_TOKEN,
});

(async function() {
  console.log(
    chalk.bold.black.underline(
      `Beginning lockstep publishing process. Updating versions to: ${newVersion}`
    )
  );
  const allPackages = fs
    .readdirSync(`${__dirname}/../packages/`)
    .filter(name => name !== '.gitkeep');
  const packages = packageUtils.getPackages(allPackages);
  const batches = packageUtils.topologicallyBatchPackages(packages);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(
      chalk.bold.green(
        `Processing batch ${i + 1} of ${batches.length} which contains ${
          batch.length
        } packages`
      )
    );
    // Process each batch of dependencies in parallel.
    await parallelBatchPublish(batch);
  }
})();

async function updateDependents(pkg, dev) {
  const flags = dev ? '--dev ' : '';
  const dependents = dev ? pkg.devDependents : pkg.dependents;
  for (let k = 0; k < dependents.length; k++) {
    shelljs.exec(
      `cd packages/${dependents[k]} && \
      yarn add ${flags} ${pkg.name}@${newVersion}`,
      {silent: !verbose}
    );
  }
}

async function waitForPullRequestMerged(pkg, pull) {
  return new Promise(resolve => {
    async function checkPullStatus() {
      const result = await github.pullRequests.checkMerged({
        owner: 'fusionjs',
        repo: pkg.name,
        number: pull.data.id,
      });
      if (result.data.merged) {
        console.log(`${pkg.name} - pull request is merged`);
        resolve();
      } else {
        console.log(
          chalk.red(
            `${pkg.name} - waiting for version to be published: ${
              pull.data.html_url
            }`
          )
        );
        setTimeout(checkPullStatus, 5000);
      }
    }
    setTimeout(checkPullStatus, 5000);
  });
}

async function waitForPackagePublished(pkg) {
  return new Promise(resolve => {
    async function checkPackagePublished() {
      const isPublished =
        shelljs.exec(`npm view ${pkg.name} version`) === newVersion;
      if (isPublished) {
        console.log(`${pkg.name} - package not published yet`);
        resolve();
      } else {
        console.log(`${pkg.name} - waiting for package to be published`);
        setTimeout(checkPackagePublished, 5000);
      }
    }
    setTimeout(checkPackagePublished, 5000);
  });
}

// Publish all packages for a given batch.
async function parallelBatchPublish(batch) {
  await Promise.all(
    batch.map(async pkg => {
      console.log(`${pkg.name} - updating version`);
      shelljs.exec(
        `cd packages/${pkg.name} && \
        yarn version --new-version ${newVersion} && \
        git push origin release/release-v${newVersion}`,
        {silent: !verbose}
      );

      console.log(`${pkg.name} - opening pull request`);
      const pull = await github.pullRequests.create({
        owner: 'fusionjs',
        repo: pkg.name,
        title: `Release v${newVersion}`,
        body: 'Created by fusion-release.',
        head: `release/release-v${newVersion}`,
        base: 'master',
      });
      console.log(`${pkg.name} - opened pull request: ${pull.data.html_url}`);

      console.log(`${pkg.name} - waiting for pull request to land`);
      await waitForPullRequestMerged(pkg, pull);

      console.log(`${pkg.name} - waiting for package to be published`);
      await waitForPackagePublished(pkg);

      console.log(`${pkg.name} - updating all dependent packages`);
      await updateDependents(pkg);
      await updateDependents(pkg, true);
    })
  );
}
