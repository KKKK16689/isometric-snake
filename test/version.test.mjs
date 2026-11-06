import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = p => fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('当前版本与作者：包、源码、页面、分享及说明一致，历史入口保留',()=>{
  const pkg=JSON.parse(read('package.json'));
  assert.equal(pkg.version,'3.0.0'); assert.equal(pkg.author,'孔垂瑞');
  assert.match(read('src/js/core.js'),new RegExp("VERSION: '"+pkg.version.replaceAll('.','\\.')+"'"));
  for(const p of ['src/index.html','index.html']) {
    assert.ok(read(p).includes('name="application-version" content="'+pkg.version+'"'));
    assert.ok(read(p).includes('name="author" content="'+pkg.author+'"'));
  }
  for(const p of ['README.md','docs/gameplay-guide.md','docs/gameplay-release.md']) assert.ok(read(p).includes('V'+pkg.version));
  assert.ok(read('LICENSE').includes('Copyright (c) 2026 '+pkg.author));
  for(const p of ['src/js/core.js','src/js/input.js']) assert.equal(read(p).includes('等距贪吃蛇 2.0 ·'),false);
  assert.ok(read('sw.js').includes('v'+pkg.version));
});
