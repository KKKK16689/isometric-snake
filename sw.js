/* sw.js —— 离线缓存（stale-while-revalidate）
   版本化缓存名：新版本激活时删掉所有旧缓存；首访预缓存外壳，其余同源 GET 命中即回、后台刷新。
   注册入口在 src/index.html 的 boot 段（仅 http(s) 协议注册，file:// 双击打开静默跳过）。 */
const CACHE = 'iso-snake-v2.0.1';   // UI 布局修复：版本+1 让老客户端整缓存重建
const PRECACHE = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;          // 跨域（截图外链等）不接管
  e.respondWith(
    caches.match(e.request).then(hit => {
      const net = fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));   // 后台刷新
        }
        return res;
      }).catch(() => hit);                             // 断网：回退缓存
      return hit || net;                               // 有缓存先回缓存（stale），没有等网络
    })
  );
});
