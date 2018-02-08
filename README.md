# fusion-release

Validates and releases fusion packages. This repo clones every fusion plugin and runs tests for every plugin.

## Publishing

To publish new packages, update the version inside of package.json. If the package.json version does not match the version found in fusion-core, a new publish processing will occur. Merge each pull request as they occur, and the process will continue to publish all packages.
