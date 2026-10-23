/* sw.test.mjs —— Service Worker 离线策略无头测试
   把 sw.js 跑进 vm 沙箱：self/caches/fetch/location/URL 全用桩，
   直接触发 install / activate / fetch 三类事件并断言 respondWith 的结果。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SW_SRC = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://game.example';

function res(body) {
  return { status: 200, type: 'basic', body, clone: () => res(body) };
}

function loadSW() {
  const store = new Map();          // cacheName -> Map(绝对URL -> response)
  const events = {};                // type -> handler
  const waits = [];
  const responded = [];
  const flags = { skipWaiting: false, claim: false, precached: [], deleted: [] };

  const resolveKey = u => new URL(u, ORIGIN).href;
  const cachesStub = {
    open: name => {
      if (!store.has(name)) store.set(name, new Map());
      const c = store.get(name);
      return Promise.resolve({
        addAll: urls => {
          flags.precached.push(...urls);
          for (const u of urls) c.set(resolveKey(u), res('PRECACHE:' + u));
        },
        put: (req, r) => { c.set(resolveKey(req.url ?? req), r); },
        match: req => c.get(resolveKey(req.url ?? req)),
      });
    },
    match: req => {
      const k = resolveKey(req.url ?? req);
      for (const c of store.values()) if (c.has(k)) return Promise.resolve(c.get(k));
      return Promise.resolve(undefined);
    },
    keys: () => Promise.resolve([...store.keys()]),
    delete: name => { flags.deleted.push(name); store.delete(name); return Promise.resolve(true); },
  };

  const sandbox = {
    URL, Promise, Math, console,
    location: { origin: ORIGIN },
    caches: cachesStub,
    fetchOnline: true,
    fetch: req => sandbox.fetchOnline
      ? Promise.resolve(res('NET:' + (req.url ?? req)))
      : Promise.reject(new Error('offline')),
    clients: { claim: () => { flags.claim = true; return Promise.resolve(); } },
    addEventListener: (type, fn) => { events[type] = fn; },
    skipWaiting: () => { flags.skipWaiting = true; return Promise.resolve(); },
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SW_SRC, sandbox, { filename: 'sw.js' });

  const fire = (type, ev) => { events[type](ev); };
  const install = () => { fire('install', { waitUntil: p => waits.push(p) }); };
  const activate = () => { fire('activate', { waitUntil: p => waits.push(p) }); };
  const fetchEv = (url, mode) => {
    const ev = { request: { method: 'GET', url, mode }, respondWith: p => responded.push(p) };
    fire('fetch', ev);
    return responded[responded.length - 1];
  };
  return { sandbox, flags, store, waits, responded, install, activate, fetchEv, events };
}

const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(r => setTimeout(r, 0)); };

test('SW 生命周期：install 预缓存外壳并 skipWaiting，activate 清旧缓存并接管页面', async () => {
  const H = loadSW();
  H.store.set('iso-snake-v1.0.0', new Map());      // 模拟老版本缓存
  H.install();
  await Promise.all(H.waits.splice(0));
  assert.equal(H.flags.skipWaiting, true);
  assert.ok(H.flags.precached.includes('./index.html'));
  assert.ok(H.flags.precached.includes('./manifest.webmanifest'));
  assert.equal(H.flags.precached.length, 7);
  H.activate();
  await Promise.all(H.waits.splice(0));
  assert.deepEqual(H.flags.deleted, ['iso-snake-v1.0.0']);
  assert.equal(H.flags.claim, true);
});

test('SW 在线：缓存命中立回旧副本，后台刷新写入新副本（stale-while-revalidate）', async () => {
  const H = loadSW();
  H.install();
  await Promise.all(H.waits.splice(0));
  const p = H.fetchEv(ORIGIN + '/index.html');
  assert.ok(p, '同源 GET 应被接管');
  const stale = await p;
  assert.equal(stale.body, 'PRECACHE:./index.html');   // 先回缓存（stale）
  await flush();
  const cacheName = [...H.store.keys()].find(k => k.startsWith('iso-snake-v'));
  const fresh = H.store.get(cacheName).get(ORIGIN + '/index.html');
  assert.equal(fresh.body, 'NET:' + ORIGIN + '/index.html');  // 后台已刷新
});

test('SW 断网：导航回退缓存壳，资源回 undefined，跨域与 POST 不接管', async () => {
  const H = loadSW();
  H.install();
  await Promise.all(H.waits.splice(0));
  H.sandbox.fetchOnline = false;

  // 没缓存过的导航地址（如分享链接 ?daily=1）→ 回退缓存的 index.html
  const nav = await H.fetchEv(ORIGIN + '/?daily=1&seed=777', 'navigate');
  assert.equal(nav.body, 'PRECACHE:./index.html');

  // 没缓存过的普通资源 → undefined（浏览器按失败处理）
  const asset = await H.fetchEv(ORIGIN + '/README.md');
  assert.equal(asset, undefined);

  // 缓存过的地址断网仍命中
  const hit = await H.fetchEv(ORIGIN + '/manifest.webmanifest');
  assert.equal(hit.body, 'PRECACHE:./manifest.webmanifest');

  // 跨域与 POST 不进 respondWith
  const before = H.responded.length;
  H.fetchEv('https://cdn.example/pic.png');
  H.events.fetch({ request: { method: 'POST', url: ORIGIN + '/x' }, respondWith: () => assert.fail('POST 不应被接管') });
  assert.equal(H.responded.length, before);
});
