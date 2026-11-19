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
const os = require('os');
const vm = require('vm');
const path = require('path');
const { execFileSync } = require('child_process');
const { Worker, MessageChannel, receiveMessageOnPort } = require('worker_threads');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const TMPL_DIR = path.join(REPO_ROOT, 'templates/ai-gateway');
const TMPL_JSC_DIR = path.join(TMPL_DIR, 'resources/jsc');
const TMPL_JAVA_DIR = path.join(TMPL_DIR, 'resources/java');
const CALLOUT_SRC_DIR = path.join(REPO_ROOT, 'callout/src/main/java/com/google/apigee/callouts');

let tempRenderDir = null;

function resolveRenderedBundleDir() {
    if (process.env.RENDERED_BUNDLE_DIR && fs.existsSync(process.env.RENDERED_BUNDLE_DIR)) {
        return process.env.RENDERED_BUNDLE_DIR;
    }
    const candidates = [
        'apigee-go-gen',
        path.join(REPO_ROOT, 'bin/apigee-go-gen'),
        '/usr/local/bin/apigee-go-gen',
        path.join(os.homedir(), 'go/bin/apigee-go-gen')
    ];
    let generatorBin = 'apigee-go-gen';
    for (const c of candidates) {
        if (c !== 'apigee-go-gen' && fs.existsSync(c)) {
            generatorBin = c;
            break;
        }
    }
    tempRenderDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-gw-unit-bundle-'));
    execFileSync(generatorBin, [
        'render', 'apiproxy',
        '--template', path.join(TMPL_DIR, 'apiproxy.yaml'),
        '--values', path.join(TMPL_DIR, 'values.yaml'),
        '--output', tempRenderDir,
        '--validate=true'
    ], { stdio: 'ignore' });
    return path.join(tempRenderDir, 'apiproxy');
}

const BUNDLE_DIR = resolveRenderedBundleDir();
const JSC_DIR = path.join(BUNDLE_DIR, 'resources/jsc');
const JAVA_DIR = path.join(BUNDLE_DIR, 'resources/java');

const stats = {
    suites: 0,
    tests: 0,
    scriptRuns: 0,
    javaCalloutRuns: 0,
    rhinoRuns: 0
};

let javaWorker = null;
let javaPort = null;
let javaSyncArr = null;

function ensureJavaWorker() {
    if (javaWorker) return;
    const syncBuf = new SharedArrayBuffer(4);
    javaSyncArr = new Int32Array(syncBuf);
    const { port1, port2 } = new MessageChannel();
    javaPort = port1;
    javaWorker = new Worker(path.join(__dirname, 'java_worker.js'), {
        workerData: { port: port2, syncBuf },
        transferList: [port2]
    });
    javaWorker.unref();
    javaPort.unref();
}

function shutdownJavaWorker() {
    if (javaPort && javaWorker) {
        try {
            javaPort.postMessage('__SHUTDOWN__');
            javaWorker.terminate();
        } catch (e) {}
        javaWorker = null;
        javaPort = null;
    }
    if (tempRenderDir) {
        try {
            fs.rmSync(tempRenderDir, { recursive: true, force: true });
        } catch (e) {}
        tempRenderDir = null;
    }
}

process.on('exit', shutdownJavaWorker);

/**
 * Executes an Apigee Java Callout (via the persistent CalloutHarnessCli JVM bridge)
 * while enforcing apigee-performance-engineering and apigee-security-engineering invariants:
 *   1. Zero duplicate msgCtxt.getVariable(k) calls (VarCache single-read memoization)
 *   2. Zero raw Collection/Map/Array objects stored in MessageContext
 *   3. Stacktraces strictly isolated to private.* namespace
 */
function runJavaCallout(scriptName, vars, opts) {
    ensureJavaWorker();

    const cleanVars = {};
    for (const [k, v] of Object.entries(vars)) {
        if (v !== undefined && v !== null) {
            cleanVars[k] = v;
        }
    }

    Atomics.store(javaSyncArr, 0, 0);
    javaPort.postMessage(JSON.stringify({
        script: scriptName,
        vars: cleanVars
    }));

    const waitRes = Atomics.wait(javaSyncArr, 0, 0, 15000);
    if (waitRes === 'timed-out') {
        throw new Error(`Java Callout timed out for ${scriptName}`);
    }

    const msg = receiveMessageOnPort(javaPort);
    if (!msg || !msg.message) {
        throw new Error(`Empty response from Java Callout worker for ${scriptName}`);
    }

    const res = JSON.parse(msg.message);
    if (res.error) {
        throw new Error(`Java Callout execution failed for ${scriptName}: ${res.error}`);
    }

    const outVars = res.vars || {};
    const calloutErr = outVars.auth_callout_error ||
        outVars.router_callout_error ||
        outVars.resp_callout_error ||
        outVars.fallback_callout_error;

    if (
        calloutErr &&
        !(opts && opts.allowPrintError) &&
        outVars.json_duplicate_key_detected !== 'true' &&
        outVars.json_malformed_payload_detected !== 'true' &&
        outVars.invalid_request_param_detected !== 'true' &&
        outVars.preflight_quota_exceeded !== 'true'
    ) {
        throw new Error(`${scriptName} Java Callout exception: ${calloutErr}`);
    }

    for (const k of Object.keys(vars)) {
        if (!(k in outVars)) {
            delete vars[k];
        }
    }
    for (const [k, v] of Object.entries(outVars)) {
        if ((opts && opts.allowPrintError) && (k.endsWith('_callout_error') || k.endsWith('_callout_stacktrace'))) {
            continue;
        }
        vars[k] = v;
    }

    stats.scriptRuns++;
    stats.javaCalloutRuns++;

    const dupReads = Object.entries(res.duplicateReads || {});
    if (dupReads.length > 0) {
        throw new Error(
            `${scriptName} Java Callout called msgCtxt.getVariable() multiple times for the same key(s) (violates apigee-performance-engineering Rule 2): ` +
            dupReads.map(([k, c]) => `${k} (${c}x)`).join(', ')
        );
    }

    if (opts && typeof opts.onComplete === 'function') {
        opts.onComplete(res.readCounts || {}, res.writeCounts || {});
    }

    return res.action;
}

/**
 * Executes an Apigee Rhino JavaScript callout inside an isolated VM context
 * (used for <EventFlow> streaming policy combine_resp.js).
 */
function runRhinoScript(scriptName, vars, opts) {
    const proxyScriptPath = path.join(JSC_DIR, scriptName);
    const tmplScriptPath = path.join(TMPL_JSC_DIR, scriptName);
    const code = fs.readFileSync(proxyScriptPath, 'utf8');

    if (fs.existsSync(tmplScriptPath)) {
        const tmplCode = fs.readFileSync(tmplScriptPath, 'utf8');
        if (code !== tmplCode) {
            throw new Error(`Parity violation: apiproxy/resources/jsc/${scriptName} differs from templates/ai-gateway/resources/jsc/${scriptName}`);
        }
    }

    const getVarCounts = {};
    const setVarCounts = {};
    const sandbox = {
        context: {
            getVariable: (k) => {
                getVarCounts[k] = (getVarCounts[k] || 0) + 1;
                return (vars[k] !== undefined ? vars[k] : null);
            },
            setVariable: (k, v) => {
                if (Array.isArray(v) || typeof v === 'function') {
                    throw new Error(
                        `${scriptName} passed a raw JS ${Array.isArray(v) ? 'Array' : 'Function'} to context.setVariable('${k}'), ` +
                        `which bypasses NativeObjectWrapper in Rhino ScriptableContext.java and pins TopLevelScope in memory!`
                    );
                }
                setVarCounts[k] = (setVarCounts[k] || 0) + 1;
                vars[k] = v;
            },
            removeVariable: (k) => {
                delete vars[k];
            }
        },
        print: (msg) => {
            if (!(opts && opts.allowPrintError)) {
                throw new Error(`${scriptName} error: ${msg}`);
            }
        }
    };

    vm.runInNewContext(code, sandbox);
    stats.scriptRuns++;
    stats.rhinoRuns++;

    const leakedGlobals = Object.keys(sandbox).filter(k => k !== 'context' && k !== 'print');
    if (leakedGlobals.length > 0) {
        throw new Error(`${scriptName} leaked global variable(s) into Rhino TopLevelScope: ${leakedGlobals.join(', ')}`);
    }

    const dupReads = Object.entries(getVarCounts).filter(([, c]) => c > 1);
    if (dupReads.length > 0) {
        throw new Error(
            `${scriptName} called context.getVariable() multiple times for the same key(s) (violates apigee-performance-engineering Rule 2): ` +
            dupReads.map(([k, c]) => `${k} (${c}x)`).join(', ')
        );
    }

    if (opts && typeof opts.onComplete === 'function') {
        opts.onComplete(getVarCounts, setVarCounts);
    }
}

/**
 * Unified execution entry point:
 * - Routes combine_resp.js (<EventFlow> SSE policy) to the Rhino VM sandbox
 * - Routes all 21 non-streaming policies to the compiled Apigee Java Callouts
 */
function runScript(scriptName, vars, opts) {
    if (scriptName === 'combine_resp.js' || (opts && opts.forceRhino)) {
        return runRhinoScript(scriptName, vars, opts);
    }
    return runJavaCallout(scriptName, vars, opts);
}

function suite(title, fn) {
    stats.suites++;
    console.log(`\n  \x1b[1m\x1b[36m▸ ${title}\x1b[0m`);
    fn();
}

function test(name, fn) {
    try {
        fn();
        stats.tests++;
        console.log(`    \x1b[32m✓\x1b[0m ${name}`);
    } catch (err) {
        stats.failed = (stats.failed || 0) + 1;
        console.error(`    \x1b[31m✗ FAILED: ${name}\x1b[0m`);
        console.error(`      \x1b[31m${err && err.message ? err.message : err}\x1b[0m`);
    }
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message || 'Assertion failed');
    }
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message ? message + ': ' : ''}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

module.exports = {
    REPO_ROOT,
    JSC_DIR,
    TMPL_JSC_DIR,
    JAVA_DIR,
    TMPL_JAVA_DIR,
    CALLOUT_SRC_DIR,
    BUNDLE_DIR,
    TMPL_DIR,
    stats,
    runScript,
    runJavaCallout,
    runRhinoScript,
    shutdownJavaWorker,
    suite,
    test,
    assert,
    assertEqual
};
