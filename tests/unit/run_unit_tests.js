#!/usr/bin/env node
/*
 * Copyright 2027 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { stats } = require('./helpers/harness');

const filter = (process.argv[2] || '').toLowerCase();
const unitDir = __dirname;

const testFiles = fs.readdirSync(unitDir)
    .filter(f => f.endsWith('.test.js'))
    .sort()
    .filter(f => !filter || f.toLowerCase().includes(filter));

if (testFiles.length === 0) {
    console.error(`No unit test files matched filter: "${filter}"`);
    process.exit(1);
}

console.log('\x1b[1m\x1b[34m======================================================================\x1b[0m');
console.log('\x1b[1m\x1b[34m   Apigee AI Gateway - Unit, Performance & Security Skill Test Suite  \x1b[0m');
console.log('\x1b[1m\x1b[34m======================================================================\x1b[0m');

for (const file of testFiles) {
    require(path.join(unitDir, file));
}

if (stats.failed) {
    console.error('\n\x1b[1m\x1b[31m----------------------------------------------------------------------\x1b[0m');
    console.error(
        `\x1b[1m\x1b[31m✗ Failed ${stats.failed} test group(s), passed ${stats.tests} across ${stats.suites} suites\x1b[0m`
    );
    console.error('\x1b[1m\x1b[31m----------------------------------------------------------------------\x1b[0m');
    process.exit(1);
}

console.log('\n\x1b[1m\x1b[32m----------------------------------------------------------------------\x1b[0m');
console.log(
    `\x1b[1m\x1b[32m✓ Passed ${stats.tests} test groups across ${stats.suites} suites ` +
    `(${stats.javaCalloutRuns} Java Callout + ${stats.rhinoRuns} EventFlow Rhino executions verified)\x1b[0m`
);
console.log('\x1b[1m\x1b[32m----------------------------------------------------------------------\x1b[0m');
