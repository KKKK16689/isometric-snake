import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
test('已签入入口与源码构建完全一致', () => {
  const r = spawnSync(process.execPath, ['build.js', '--check'], {cwd:root, encoding:'utf8'});
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('--check 检出漂移且不改写产物，重建后检查通过', () => {
  const dir = mkdtempSync(join(tmpdir(), 'iso-snake-build-'));
  try {
    for (const p of ['src','build.js','index.html']) cpSync(join(root,p), join(dir,p), {recursive:true});
    const run = args => spawnSync(process.execPath, ['build.js', ...args], {cwd:dir,encoding:'utf8'});
    assert.equal(run([]).status,0);
    const before = readFileSync(join(dir,'index.html'));
    appendFileSync(join(dir,'src/js/input.js'), '\n// build regression\n');
    const r = run(['--check']);
    assert.equal(r.status,1);
    assert.match(r.stderr,/index.html/);
    assert.deepEqual(readFileSync(join(dir,'index.html')),before);
    assert.equal(run([]).status,0);
    assert.equal(run(['--check']).status,0);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
