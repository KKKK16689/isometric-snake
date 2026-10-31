import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../', import.meta.url));   // 仓库根（路径含中文，必须用 fileURLToPath；url.pathname 会百分号编码）
const read = p => readFileSync(REPO + p, 'utf8');
const selfContained = h => !/<script[^>]+src=/i.test(h) && !/<link[^>]+rel=["']?stylesheet/i.test(h);

/* 三个版本的入口文件都必须存在、都是自包含单文件（双击能玩、Pages 不会裂） */
test('版本存档：3.0 主入口 + legacy20（2.0）+ legacy（v3）都在，且都是自包含单文件', () => {
  for (const f of ['index.html', 'legacy20/index.html', 'legacy/index.html']) {
    assert.ok(existsSync(REPO + f), f + ' 不存在');
    const h = read(f);
    assert.ok(h.length > 20000, f + ' 太小，像空的');
    assert.ok(/<canvas[^>]+id=["']c["']/.test(h), f + ' 里没有主画布');
    assert.ok(selfContained(h), f + ' 不是自包含单文件（有外部 script/stylesheet 引用）');
  }
  /* 三个版本必须真的不同：3.0 有地名关卡，2.0 有 best2 键，v3 两者都没有 */
  assert.ok(read('index.html').includes('station-32'), '3.0 入口缺 3.0 特征（station-32）');
  assert.ok(read('legacy20/index.html').includes('iso-snake-best2-'), 'legacy20 不是 2.0');
  assert.ok(!read('legacy20/index.html').includes('station-32'), 'legacy20 混进了 3.0');
  assert.ok(!read('legacy/index.html').includes('iso-snake-best2-'), 'legacy 不是 v3');
});
