#!/usr/bin/env node

/* eslint-disable no-var */
/* eslint-disable flowtype/require-valid-file-annotation */
'use strict';

var ver = process.versions.node;
var majorVer = parseInt(ver.split('.')[0], 10);

if (majorVer < 4) {
  console.error('Node version ' + ver + ' is not supported, please use Node.js 4.0 or higher.');
  process.exitCode = 1;
} else {
  var fs = require('fs');
  var path = require('path');
  var dirPath;
  if (fs.existsSync(path.join(__dirname, '..', 'src'))) {
    dirPath = '../src/';
  } else {
    dirPath = '../lib/';
    var v8CompileCachePath = dirPath + 'v8-compile-cache';
    // We don't have/need this on legacy builds and dev builds
    if (fs.existsSync(v8CompileCachePath)) {
      require(v8CompileCachePath);
    }
  }

  // Just requiring this package will trigger a yarn run since the
  // `require.main === module` check inside `cli/index.js` will always
  // be truthy when built with webpack :(
  var cli = require(dirPath + 'cli');
  if (!cli.autoRun) {
    cli.default();
  }
}
