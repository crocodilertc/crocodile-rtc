# Contributing

## Important notes
Please don't edit files in the `dist` subdirectory as they are generated via Grunt. You'll find source code in the `src` subdirectory!

### Code style
Regarding code style like indentation and whitespace, **follow the conventions you see used in the source already.**

### Unit testing
While Grunt would normally run unit tests via [PhantomJS](http://phantomjs.org/), this does not currently support WebRTC, or even WebSockets, so the `grunt test` target is not run by default. Instead you must run the `test/*.html` unit test file(s) in _actual_ browsers (after having inserted a valid API key and user credentials).

## Building the code
First, ensure that you have [Node.js](http://nodejs.org/) and [npm](http://npmjs.org/) installed.  Most of the development work has been done using Node v0.10.3.

Test that Grunt's CLI is installed by running `grunt --version`.  If the command isn't found, run `npm install -g grunt-cli`.  For more information about installing Grunt, see the [getting started guide](http://gruntjs.com/getting-started).

1. Fork and clone the repo.
1. Run `npm install` to install all dependencies (including Grunt).
1. Run `grunt` to grunt this project.

Assuming that you don't see any red, you're ready to go. Just be sure to run `grunt` after making any changes, to ensure that nothing is broken.

## Submitting pull requests

1. Create a new branch, please don't work in your `master` branch directly.
1. Add failing tests for the change you want to make.
1. Fix stuff.
1. Open `test/*.html` unit test file(s) in a browser to see if the tests pass.
1. Rinse and repeat until all tests pass.
1. Update the documentation to reflect any changes.
1. Push to your fork and submit a pull request.
