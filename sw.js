/* sw.js —— 离线缓存
   版本化缓存名：新版本激活时删掉所有旧缓存；首访预缓存外壳。
   导航请求（打开页面）走 network-first：刷新一定拿到最新构建，断网才回缓存壳——开发期改动频繁，
   旧的 stale-while-revalidate 会让用户刷新后仍看到上一版（曾据此误判「眼睛没跟着爬」等观感问题）。
   其余同源 GET 仍为 stale-while-revalidate（命中即回、后台刷新）。
   注册入口在 src/index.html 的 boot 段（仅 http(s) 协议注册，file:// 双击打开静默跳过）。 */
const CACHE = 'iso-snake-v3.0-stage3.1';   // 版本+1 让老客户端整缓存重建
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
  if (url.pathname.includes('/legacy/')) return;       // legacy 存档页直通网络：不缓存、断网也不误回退新版外壳
  e.respondWith(
    caches.match(e.request).then(hit => {
      const net = fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));   // 写入/刷新缓存
        }
        return res;
      });
      const safe = net.catch(() => undefined);     // 先给 net 挂上 catch：否则命中缓存时右式不求值，断网会冒泡成 unhandledrejection
      if (e.request.mode === 'navigate') {              // 导航：网络优先（刷新必得最新构建）
        return net.catch(() => hit || caches.match('./index.html'));   // 断网：回缓存壳
      }
      return hit || safe;                                // 资源：命中即回（SWR），断网回退缓存（没有缓存则 undefined）
    })
  );
});
