/* sw.js —— 离线缓存
   版本化缓存名：新版本激活时只删本游戏旧缓存；首访预缓存外壳。
   导航请求（打开页面）走 network-first：刷新一定拿到最新构建，断网才回缓存壳——开发期改动频繁，
   旧的 stale-while-revalidate 会让用户刷新后仍看到上一版（曾据此误判「眼睛没跟着爬」等观感问题）。
   其余同源 GET 仍为 stale-while-revalidate（命中即回、后台刷新）。
   注册入口在 src/index.html 的 boot 段（仅 http(s) 协议注册，file:// 双击打开静默跳过）。 */
const CACHE_PREFIX = 'iso-snake-';
const CACHE = 'iso-snake-v3.0.0-review-2';   // SW 策略更新，让老客户端重建缓存
const PRECACHE = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;          // 跨域（截图外链等）不接管
  if (url.pathname.includes('/legacy/') || url.pathname.includes('/legacy20/')) return;       // legacy 存档页直通网络：不缓存、断网也不误回退新版外壳
  const cache = caches.open(CACHE).catch(() => null);
  const match = async req => { try { const c = await cache; return c ? await c.match(req) : undefined; } catch (err) { return undefined; } };
  const offline = () => new Response('Game offline: connect to the network and reload.', {
    status: 503, statusText: 'Service Unavailable',
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
  });
  const net = fetch(e.request);
  // 同步登记生命周期；缓存配额/写入失败不能使有效网络响应失败。
  e.waitUntil(net.then(async res => {
    if (res && res.status === 200 && res.type === 'basic') {
      const clone = res.clone(), c = await cache;
      if (c) await c.put(e.request, clone);
    }
  }).catch(() => {}));
  const safe = net.catch(() => undefined);
  if (e.request.mode === 'navigate') {
    e.respondWith(safe.then(async res => res || await match(e.request) || await match('./index.html') || offline()));
  } else {
    e.respondWith(match(e.request).then(async hit => hit || await safe || offline()));
  }
});
