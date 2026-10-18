#!/usr/bin/env node
/* build.js —— 零依赖打包：src/ → 根目录 index.html 单文件（即 GitHub Pages 入口）
   规则：按声明顺序把 <link rel="stylesheet"> 与 <script src> 内联替换；文件缺失时报错退出。 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = __dirname, SRC = path.join(ROOT, 'src'), OUT = path.join(ROOT, 'index.html');
const err = m => { console.error('[build] ' + m); process.exit(1); };
const read = a => { try { return fs.readFileSync(a, 'utf8'); } catch (e) { err('缺失文件: ' + path.relative(ROOT, a)); } };

let html = read(path.join(SRC, 'index.html'));
let cssN = 0, jsN = 0;
html = html.replace(/<link\b[^>]*?\brel=["']stylesheet["'][^>]*?\bhref=["']([^"']+)["'][^>]*?\/?>/gi, (full, href) => {
  cssN++;
  return '<style>\n' + read(path.join(SRC, href)) + '\n</style>'; // 内联在 <head> 原位
});
html = html.replace(/<script\b[^>]*?\bsrc=["']([^"']+)["'][^>]*?>\s*<\/script>/gi, (full, src) => {
  jsN++;
  return '<script>\n' + read(path.join(SRC, src)) + '\n</script>'; // 内联在 body 原位，保证执行顺序
});
fs.writeFileSync(OUT, html);
console.log('[build] OK → index.html（CSS ×' + cssN + ' · JS ×' + jsN + ' · ' + (Buffer.byteLength(html) / 1024).toFixed(1) + 'KB）');