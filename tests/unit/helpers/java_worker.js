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

const { workerData } = require('worker_threads');
const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');
const os = require('os');

const { port, syncBuf } = workerData;
const syncArr = new Int32Array(syncBuf);

const REPO_ROOT = path.resolve(__dirname, '../../..');
const M2_REPO = process.env.M2_REPO || path.join(os.homedir(), '.m2/repository');
const CLASSPATH = [
    path.join(REPO_ROOT, 'templates/ai-gateway/resources/java/ai-gateway-callouts.jar'),
    path.join(REPO_ROOT, 'callout/target/test-classes'),
    path.join(M2_REPO, 'com/apigee/gateway/libraries/message-flow/1.0.0/message-flow-1.0.0.jar'),
    path.join(M2_REPO, 'com/apigee/infra/libraries/expressions/1.0.0/expressions-1.0.0.jar')
].join(path.delimiter);

const javaProc = spawn('java', ['-cp', CLASSPATH, 'com.google.apigee.callouts.CalloutHarnessCli'], {
    stdio: ['pipe', 'pipe', 'pipe']
});

javaProc.unref();

const rl = readline.createInterface({
    input: javaProc.stdout,
    crlfDelay: Infinity
});

rl.on('line', (line) => {
    port.postMessage(line);
    Atomics.store(syncArr, 0, 1);
    Atomics.notify(syncArr, 0, 1);
});

javaProc.on('error', (err) => {
    port.postMessage(JSON.stringify({ error: 'JVM spawn error: ' + err.message }));
    Atomics.store(syncArr, 0, 1);
    Atomics.notify(syncArr, 0, 1);
});

port.on('message', (msg) => {
    if (msg === '__SHUTDOWN__') {
        try {
            javaProc.kill();
        } catch (e) {}
        process.exit(0);
    }
    javaProc.stdin.write(msg + '\n');
});
