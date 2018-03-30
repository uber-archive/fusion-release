/* eslint-env node */
/* eslint-disable no-console*/

const PackageUtils = require('./packageUtils');

/**
 * Bootstraps the monorepo.
 */
const bootstrap = async (allPackages, dir) => {
  const packageUtils = new PackageUtils({dir});

  console.log('Initializing topologically sorted monorepo.');
  const packages = packageUtils.getPackages(allPackages);
  console.log('Building batches.');
  const batches = packageUtils.topologicallyBatchPackages(packages);

  if (process.env.VERBOSE) {
    console.log(
      'Building batches:',
      JSON.stringify(
        batches.map(batch => batch.map(pkg => pkg.name)),
        null,
        '  '
      )
    );
  }

  console.log('Installing and transpiling batched package groups.');
  await packageUtils.installBatchedPackages(batches);
};

module.exports.bootstrap = bootstrap;
