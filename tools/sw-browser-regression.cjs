/* 本地 HTTP + 真实 Service Worker；不访问 GitHub Pages、不发布。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ROOT = path.join(__dirname, '..');

async function run(browser, out, swSource = fs.readFileSync(path.join(ROOT, 'sw.js'))) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/seed') { res.setHeader('Content-Type', 'text/html'); return res.end('<title>Cache seed</title>'); }
    const relative = url.pathname.replace(/^\/isometric-snake\//, '') || 'index.html';
    const allowed = ['index.html','sw.js','manifest.webmanifest',
      'icons/icon-192.png','icons/icon-512.png','icons/maskable-512.png','icons/apple-touch-icon.png'];
    if (!url.pathname.startsWith('/isometric-snake/') || !allowed.includes(relative)) { res.writeHead(404); return res.end('Missing'); }
    res.setHeader('Content-Type', relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.html') ? 'text/html' : relative.endsWith('.png') ? 'image/png' : 'application/manifest+json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(relative === 'sw.js' ? swSource : fs.readFileSync(path.join(ROOT, relative)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const context = await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(base + '/seed');
    await page.evaluate(async () => {
      for (const name of ['iso-snake-old','other-app-v1','iso-snakeboard']) {
        const c = await caches.open(name); await c.put('/foreign', new Response(name));
      }
    });
    await page.goto(base + '/isometric-snake/');
    await page.waitForFunction(() => !!navigator.serviceWorker.controller,{},{timeout:15000});
    const names = await page.evaluate(() => caches.keys());
    assert.ok(!names.includes('iso-snake-old'), '激活必须删除游戏旧缓存');
    for (const name of ['other-app-v1','iso-snakeboard']) assert.ok(names.includes(name), '激活不得删除其他应用缓存：' + name);
    assert.equal(await page.evaluate(() => navigator.serviceWorker.controller.scriptURL), base + '/isometric-snake/sw.js');
    await context.setOffline(true);
    const shell = await page.goto(base + '/isometric-snake/?level=harbor-route');
    assert.equal(shell.status(),200,'子路径和查询参数断网仍能载入游戏壳');
    await page.locator('#state-start').click();
    assert.equal(await page.evaluate(() => Snake.S.state),'playing');
    await page.locator('#pause').click();
    await page.screenshot({path:path.join(out,'offline-390x844.png')});
    const missing = await page.evaluate(async () => {
      const r = await fetch('./missing.png'); return {status:r.status,body:await r.text()};
    });
    assert.equal(missing.status,503,'断网且资源未命中必须返回明确 503');
    assert.match(missing.body,/offline/i);
    await page.evaluate(async () => {
      for (const name of await caches.keys()) if (name.startsWith('iso-snake-')) await caches.delete(name);
      // 其他应用即使有同路径页面，也不得被当作游戏离线壳。
      const c = await caches.open('other-app-v1');
      await c.put('./index.html',new Response('FOREIGN'));
    });
    const cold = await page.goto(base + '/isometric-snake/?cold=1');
    assert.equal(cold.status(),503,'游戏缓存清空后离线导航必须返回 503');
    assert.match(await page.locator('body').innerText(),/offline/i);
    assert.deepEqual(errors,[]);
    const report = {browser:browser.version(),mode:'local HTTP /isometric-snake/; real Service Worker; offline emulation',realDevice:false,
      checks:['activation-cache-isolation','subpath-offline-shell','offline-game-start','uncached-resource-503','cold-navigation-503','foreign-cache-exclusion'],status:'passed',errors};
    fs.writeFileSync(path.join(out,'sw-results.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
    return report;
  } finally {
    await context.close();
    await new Promise(resolve => server.close(resolve));
  }
}
module.exports = { run };
