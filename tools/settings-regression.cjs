/* 使用真实点击验证设置可达、蛇色、主题、地图和大地图入口。 */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const ROOT=path.join(__dirname,'..');
async function run(browser,out=path.join(ROOT,'output/playwright')) {
  fs.mkdirSync(out,{recursive:true});const results=[],errors=[];
  for(const [width,height] of [[1280,900],[390,844],[568,320],[844,390]]) {
    const context=await browser.newContext({viewport:{width,height},hasTouch:width<900});
    const page=await context.newPage();page.setDefaultTimeout(5000);
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
    try {
      await page.goto(pathToFileURL(path.join(ROOT,'index.html')).href);
      assert.equal(await page.locator('#home-settings').count(),1,'主页必须有可点击的设置入口');
      await page.locator('#home-settings').click();
      assert.equal(await page.locator('#preferences').isVisible(),true);
      await page.locator('.sw[data-p="0"] button').nth(2).click();
      assert.equal(await page.evaluate(()=>Snake.S.skin[0]),2,'单人蛇色必须能实际切换');
      const before=await page.evaluate(()=>Snake.theme.current.id);
      await page.locator('.th button').nth(1).click();
      const after=await page.evaluate(()=>Snake.theme.current.id);
      assert.notEqual(after,before);assert.equal(await page.evaluate(()=>localStorage.getItem('iso-snake-theme')),after);
      await page.locator('#lv').selectOption('ridges-40');
      assert.equal(await page.evaluate(()=>Snake.S.T.w),40);assert.equal(await page.evaluate(()=>Snake.S.levelId),'ridges-40');
      assert.equal(await page.locator('#lv option').count(),9,'经典棋盘和八张可玩地形图都可选');
      await page.screenshot({path:path.join(out,`preferences-${width}x${height}.png`)});
      const bounds=await page.locator('#preferences').evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth;});
      assert.ok(bounds,'设置面板必须在屏幕内，内容可以滚动');
      await page.locator('#close-settings').click();await page.locator('#state-start').click();
      await page.waitForFunction(()=>Snake.S.elapsed>0);
      await page.screenshot({path:path.join(out,`explore-${width}x${height}.png`)});
      await page.locator('#pause').click();
      await page.locator('#state-settings').click();
      assert.equal(await page.locator('#preferences').isVisible(),true,'暂停状态仍能进入设置');
      await page.locator('#lv').selectOption('harbor-32');
      assert.equal(await page.evaluate(()=>Snake.S.T.w),32);
      await page.locator('#close-settings').click();await page.locator('#state-home').click();
      await page.locator('#play-mission').click();await page.locator('#state-home').click();
      await page.locator('#play-terrain').click();
      assert.equal(await page.evaluate(()=>Snake.S.T.w),32,'从小任务图进入自由探索必须回到大地图');
      assert.equal(await page.evaluate(()=>Snake.S.mission),null);
      await page.locator('#state-settings').click();
      await page.locator('#lv').selectOption('');
      assert.equal(await page.evaluate(()=>Snake.S.T),null,'经典棋盘选项能关闭地形');
      await page.locator('#lv').selectOption('ice-32');
      assert.equal(await page.evaluate(()=>Snake.S.T.w),32,'经典模式也能直接选大地图');
      await page.locator('.mode button[data-m="pk"]').click();
      await page.locator('.sw[data-p="1"] button').nth(3).click();
      assert.equal(await page.evaluate(()=>Snake.S.skin[1]),3,'双人模式第二条蛇也能换色');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'无横向溢出');
      results.push({width,height,status:'passed',coverage:'home-settings/pause-settings/P1-P2-colors/theme/maps-32-40/classic/free-explore'});
    } finally {await context.close();}
  }
  assert.deepEqual(errors,[]);
  const report={browser:browser.version(),realDevice:false,results,errors};
  fs.writeFileSync(path.join(out,'settings-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));return report;
}
module.exports={run};
