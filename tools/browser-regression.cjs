/* 真实浏览器 UI 回归；手机尺寸/合成指针不等于手机真机。无需 HTTP 服务。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..');

async function run(browser, out = path.join(ROOT, 'output/playwright')) {
  fs.mkdirSync(out, { recursive: true });
  const results = [], errors = [];
  for (const [width,height] of [[1280,900],[320,568],[390,844],[568,320],[844,390]]) {
    const context = await browser.newContext({viewport:{width,height},hasTouch:width < 900});
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
    try {
      await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href);
      await page.locator('#play-mission').waitFor({state:'visible'});
      assert.equal(await page.locator('#experience').isVisible(),true);
      await page.screenshot({path:path.join(out,`home-${width}x${height}.png`)});
      await page.locator('#learn').click();
      for (const dir of ['up','right','down','left']) await page.locator('#train-'+dir).click();
      await page.locator('#train-sprint').dispatchEvent('pointerdown',{pointerId:7,pointerType:'touch'});
      await page.evaluate(()=> { Object.defineProperty(document,'hidden',{configurable:true,value:true}); document.dispatchEvent(new Event('visibilitychange')); });
      await page.waitForTimeout(550); // 明确验证半秒训练阈值，后台不得自动完成练习
      assert.equal(await page.locator('#training-play').count(),0,'切后台必须取消练习冲刺计时');
      await page.evaluate(()=> { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
      await page.locator('#train-sprint').dispatchEvent('pointerdown',{pointerId:7,pointerType:'touch'});
      await page.locator('#training-play').waitFor({state:'visible'});
      assert.equal(await page.evaluate(()=>localStorage.getItem('iso-snake-tutorial-v1')),'done');
      await page.locator('#training-play').click();
      await page.locator('#state-start').click();
      assert.equal(await page.evaluate(()=>Snake.S.mission.id),'harbor-route-1');
      assert.equal(await page.locator('h1').isVisible(),false,'新操作层不能在固定任务栏下重复显示旧标题');
      await page.locator('#settings').click();
      assert.equal(await page.evaluate(()=>Snake.S.state),'paused');
      assert.equal(await page.locator('#settings').getAttribute('aria-expanded'),'true');
      await page.screenshot({path:path.join(out,`settings-${width}x${height}.png`)});
      const settingsBounds = await page.locator('#preferences').evaluate(el => {
        const r = el.getBoundingClientRect();
        return {top:r.top,bottom:r.bottom,viewport:innerHeight};
      });
      assert.ok(settingsBounds.top >= 0 && settingsBounds.bottom <= settingsBounds.viewport,
        '设置面板必须完整位于屏幕内：' + JSON.stringify(settingsBounds));
      await page.locator('#settings').click();
      await page.locator('#state-start').click();
      assert.equal(await page.evaluate(()=>Snake.S.state),'playing');
      await page.screenshot({path:path.join(out,`playing-${width}x${height}.png`)});
      await page.locator('#pause').click();
      const elapsed = await page.evaluate(()=>Snake.S.elapsed);
      await page.screenshot({path:path.join(out,`mission-${width}x${height}.png`)});
      assert.equal(await page.evaluate(()=>Snake.S.elapsed),elapsed);
      await page.locator('#state-home').click();
      await page.locator('#learn').click();
      const bounds = await page.locator('.training-controls button').evaluateAll(els=>els.map(el=> {
        const r=el.getBoundingClientRect(),card=el.closest('.experience-card').getBoundingClientRect();
        return r.left>=card.left && r.right<=card.right && r.width>=44 && r.height>=44;
      }));
      assert.ok(bounds.every(Boolean),'练习按钮必须在面板内且至少 44×44');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),'页面不得横向溢出');
      // 屏幕旋转和地址栏收缩对应的尺寸变化由真实布局引擎处理。
      await page.setViewportSize({width:height,height:width});
      await page.locator('#training-back').click();
      await page.locator('#state-start').click();
      assert.equal(await page.evaluate(()=>Snake.S.state),'playing');
      results.push({width,height,status:'passed',coverage:'home/training/mission/settings/pause/resize'});
    } finally { await context.close(); }
  }
  assert.deepEqual(errors,[],'浏览器脚本/渲染不得报错');
  const report = {browser:browser.version(),mode:'desktop Chromium with viewport and touch emulation; file URL',realDevice:false,results,errors};
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  return report;
}
module.exports = { run };
if (require.main === module) (async()=> {
  const browser = await chromium.launch({headless:true,
    ...(process.env.QA_BROWSER ? {executablePath:process.env.QA_BROWSER} : {}),args:['--disable-crashpad']});
  try {
    await run(browser);
    await require('./settings-regression.cjs').run(browser,path.join(ROOT,'output/playwright'));
    await require('./sw-browser-regression.cjs').run(browser,path.join(ROOT,'output/playwright'));
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
