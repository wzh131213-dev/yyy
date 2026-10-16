import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLrc,safeProjectPath} from '../src/render.js';
test('parses timed lyrics',()=>{const x=parseLrc('[00:01.20]你好\n[00:03.50]世界');assert.equal(x.lines.length,2);assert.equal(x.lines[0].time,1.2);assert.equal(x.lines[1].text,'世界');assert.deepEqual(x.problems,[]);});
test('detects backwards timestamps',()=>{assert.ok(parseLrc('[00:03.00]a\n[00:02.00]b').problems.some(x=>x.includes('倒退')));});
test('rejects unsafe project ids',()=>{assert.throws(()=>safeProjectPath('/tmp/projects','../../etc/passwd'));});
