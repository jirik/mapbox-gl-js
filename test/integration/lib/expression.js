'use strict';

const path = require('path');
const harness = require('./harness');
const diff = require('diff');
const fs = require('fs');
const compactStringify = require('json-stringify-pretty-compact');

// we have to handle this edge case here because we have test fixtures for this
// edge case, and we don't want UPDATE=1 to mess with them
function stringify(v) {
    let s = compactStringify(v);
    // http://timelessrepo.com/json-isnt-a-javascript-subset
    if (s.indexOf('\u2028') >= 0) {
        s = s.replace(/\u2028/g, '\\u2028');
    }
    if (s.indexOf('\u2029') >= 0) {
        s = s.replace(/\u2029/g, '\\u2029');
    }
    return s;
}

const floatPrecision = 6; // in decimal sigfigs

function deepEqual(a, b) {
    if (typeof a !== typeof b)
        return false;
    if (typeof a === 'number') {
        if (a === 0) { return b === 0; }
        const digits = 1 + Math.floor(Math.log10(Math.abs(a)));
        const multiplier = Math.pow(10, floatPrecision - digits);
        return Math.floor(a * multiplier) === Math.floor(b * multiplier);
    }
    if (a === null || b === null || typeof a !== 'object')
        return a === b;

    const ka = Object.keys(a);
    const kb = Object.keys(b);

    if (ka.length !== kb.length)
        return false;

    ka.sort();
    kb.sort();

    for (let i = 0; i < ka.length; i++)
        if (ka[i] !== kb[i] || !deepEqual(a[ka[i]], b[ka[i]]))
            return false;

    return true;
}
/**
 * Run the expression suite.
 *
 * @param {string} implementation - identify the implementation under test; used to
 * deal with implementation-specific test exclusions and fudge-factors
 * @param {Object} options
 * @param {Array<string>} [options.tests] - array of test names to run; tests not in the array will be skipped
 * @param {Array<string>} [options.ignores] - array of test names to ignore.
 * @param {} runExpressionTest - a function that runs a single expression test fixture
 * @returns {undefined} terminates the process when testing is complete
 */
exports.run = function (implementation, options, runExpressionTest) {
    const directory = path.join(__dirname, '../expression-tests');
    options.fixtureFilename = 'test.json';
    harness(directory, implementation, options, (fixture, params, done) => {
        try {
            const result = runExpressionTest(fixture, params);
            const dir = path.join(directory, params.group, params.test);

            if (process.env.UPDATE) {
                fixture.expected = result;
                // We save the expected serialization, but the round-tripped compilation results
                // and outputs should be identical, so no need to save them.
                delete fixture.expected.recompiled;
                delete fixture.expected.roundTripOutputs;
                fs.writeFile(path.join(dir, 'test.json'), `${stringify(fixture, null, 2)}\n`, done);
                return;
            }

            const expected = fixture.expected;
            const compileOk = deepEqual(result.compiled, expected.compiled);
            const evalOk = compileOk && deepEqual(result.outputs, expected.outputs);

            // Serialization/round-tripping only exists on native
            let recompileOk = true;
            let roundTripOk = true;
            let serializationOk = true;

            if (implementation === 'native' && expected.compiled.result !== 'error') {
                serializationOk = compileOk && deepEqual(expected.serialized, result.serialized);
                recompileOk = compileOk && deepEqual(result.recompiled, expected.compiled);
                roundTripOk = recompileOk && deepEqual(result.roundTripOutputs, expected.outputs);
            }

            params.ok = compileOk && evalOk && recompileOk && roundTripOk && serializationOk;

            let msg = '';

            const diffJson = (expectedJson, actualJson) => {
                return diff.diffJson(expectedJson, actualJson)
                    .map((hunk) => {
                        if (hunk.added) {
                            return `+ ${hunk.value}`;
                        } else if (hunk.removed) {
                            return `- ${hunk.value}`;
                        } else {
                            return `  ${hunk.value}`;
                        }
                    })
                    .join('');
            };
            if (!compileOk) {
                msg += diffJson(expected.compiled, result.compiled);
            }
            if (compileOk && !serializationOk) {
                msg += diffJson(expected.serialized, result.serialized);
            }
            if (compileOk && !recompileOk) {
                msg += diffJson(expected.compiled, result.recompiled);
            }

            const diffOutputs = (testOutputs) => {
                return expected.outputs.map((expectedOutput, i) => {
                        if (!deepEqual(expectedOutput, testOutputs[i])) {
                            return `f(${JSON.stringify(fixture.inputs[i])})\nExpected: ${JSON.stringify(expectedOutput)}\nActual: ${JSON.stringify(testOutputs[i])}`;
                        }
                        return false;
                    })
                    .filter(Boolean)
                    .join('\n');
            };
            if (compileOk && !evalOk) {
                msg += diffOutputs(result.outputs);
            }
            if (recompileOk && !roundTripOk) {
                msg += diffOutputs(results.roundTripOutputs);
            }

            params.difference = msg;
            if (msg) { console.log(msg); }

            params.expression = JSON.stringify(fixture.expression, null, 2);

            done();
        } catch (e) {
            done(e);
        }
    });
};
