# 等距贪吃蛇 v3 视觉精炼设计（主题精简 + 细腻化 + 全模式自适应）

> 状态：待用户审查
> 日期：2026-10-18
> 前置：v2 视觉升级已验收提交（main @ b08691e 含滚动修复）；用户决策记录：删 绿屏/深渊/暮光、细腻化方向 B、布局方案 A

## 0. 范围与非目标

**本轮做：**
1. 主题精简：10 → 7 套
2. 画面细腻化（方向 B）：光影层 + 图案注册表（patterns.js）
3. 全模式自适应布局（方案 A）：统一沉浸式 `body.im`
4. 滚动/晃动修复已入账（b08691e），本轮不重复

**非目标（明确后置）：** GitHub Pages 部署、排行榜、道具系统、AI/音频/玩法改动。部署与排行榜等本轮视觉验收通过后另开迭代。

**硬约束延续：** 零依赖单文件可双击运行（build.js 内联）；主题=纯数据注册表；音频全合成；lowFx 自动降级；事件总线单向通信。

## 1. 主题精简

- `themes.js` LIST 删除 `retro`（绿屏）、`abyss`（深渊）、`dusk`（暮光）三条目。
- 保留 7 套：`neon-night` 霓虹夜、`glacier` 冰川、`cyber` 赛博、`candy` 糖果、`forest` 森林、`lava` 熔岩、`desert` 沙漠。
- 回退零改动：`apply()` 已 `byId(id) || byId(DEF)`，旧 localStorage 记忆（含被删 id）与非法 `?theme=` 自动回退霓虹夜。
- 主题点行 `.th` 由 LIST 渲染，删条目即少点；`screenshots/` 现有 4 张（neon-night/cyber/candy/lava）均在保留集内，本轮末重截。

## 2. 细腻化方向 B

### 2.1 光影层（全主题，进离屏缓存，每帧零成本）

在 `render.js` 的 `paintBoard()`（boardCache 离屏绘制）内追加：
1. **瓦片倒角**：每瓦片填充+网格线后，描上两边（左上、右上棱）高光线 lineWidth 1：暗主题 `rgba(255,255,255,.07)`、浅主题 `rgba(255,255,255,.5)`（暗/浅判定 = 背景亮度 < 128）。
2. **侧面纵向渐变**：棋盘左/右侧面由纯色改为线性渐变：`floorLeft/floorRight` 顶 → 同色压暗 40% 底。
3. **台缘描边光**：棋盘外轮廓菱形描边 `glow` 色 alpha .45、lineWidth 1。

每帧层（不进缓存但零布局成本）：
4. **背景晕影**：径向渐变（中心透明 → 边缘暗主题 `rgba(0,0,0,.35)` / 浅主题 `rgba(90,70,70,.10)`），渐变对象在 resize/themeChange 时创建并缓存；绘制时机 = 背景+星空之后、棋盘缓存之前。

不改动：蛇头 glow（shadowBlur 10 现状）、食物呼吸光晕、冲刺电弧。

### 2.2 图案注册表（新文件 `src/js/patterns.js`）

- 结构：`PAT = { <id>: function (ctx, cx, cy, pal, x, y) {...} }`；导出 `Snake.Patterns = { draw(id, ctx, cx, cy, pal, x, y) }`，查无 id 静默 no-op。
- 调用点：`paintBoard()` 每瓦片末尾 `Snake.Patterns.draw(theme.pattern, ...)` → 图案进 boardCache，**每帧零成本**；themeChange/resize 已有 `invalidateBoard` 链路自动重建。
- 主题数据新增可选字段 `pattern: '<id>'`（themes.js LIST 每条一处）。
- 取色纪律：仅用 `pal.grid / pal.glow / pal.spark / pal.food`，alpha .2-.4，线宽 ≤1.5，不抢蛇与食物视觉焦点。
- 7 套默认图案（确定性伪随机用 `K.fr(种子)`，种子含 x/y）：
  | 主题 | id | 画法 |
  |---|---|---|
  | 霓虹夜 | pulse | `(x*7+y*13)%5==0` 瓦片：内嵌 .45 缩放菱形描边 glow a.35 + 中心 2px 点 glow a.5 |
  | 冰川 | ice | `fr(x*3+y*5)>.6` 瓦片：自瓦片上棱随机点向中心 2 段折线裂纹 glow a.3 |
  | 赛博 | circuit | `(x+y)%4==0` 瓦片：左棱→中心→上棱 L 形走线 + 中心节点点 glow a.35 |
  | 糖果 | sprinkle | 每瓦片 3 根 4-6px 短棒，角度/位置 fr 种子，色 spark/food 交替 a.35 |
  | 森林 | moss | 每瓦片 4-6 个 r=1 圆点簇，fr 偏移，spark a.25-.4 |
  | 熔岩 | ember | 每瓦片 3 段锯齿裂线横贯 glow a.3；`fr>.7` 瓦片加 1 个 food 色余烬点 a.5 |
  | 沙漠 | ripple | 每瓦片 2 道 .3/.6 缩放下半菱形弧（仅下两边）glow a.25 |
- **扩展性**：新增图案 = PAT 加一个函数 + 主题写 id；核心/render 零改动（满足"后续增加美观图案"）。
- lowFx：图案与光影层均在缓存层，不受 lowFx 影响（不新增每帧开销，无需降级分支）。

## 3. 全模式自适应布局（方案 A：统一沉浸式）

### 3.1 类与触发

- `input.js`：`const wideMQ = matchMedia('(orientation: landscape), (min-width: 760px)')`；`syncModeUi()` 增补 `document.body.classList.toggle('im', wideMQ.matches)`；`wideMQ.addEventListener('change', syncModeUi)`；init 已调用 syncModeUi（b08691e）。
- 四象限行为：
  | 环境 | 单人 easy/normal | 双人 pk/ai |
  |---|---|---|
  | 电脑/横屏/≥760px | 沉浸（新） | 沉浸（现状） |
  | 手机竖屏 <760px | 列式（现状） | 列式 + 横屏提示（现状） |
  | 平板竖屏 ≥760px | 沉浸（画布按宽居中） | 沉浸 |

### 3.2 CSS 迁移（base.css）

- 沉浸规则选择器 `body.pk` → `body.im`（main 全屏 flex、canvas、hud/mode/pad/sw/cmp/eb 悬浮、h1/tip 隐藏、touch-action、overflow:hidden）。
- 竖屏媒体块改为 `body.pk:not(.im)`：列式 + `.rotate` 显示 + `overflow:auto`（防裁切）。
- 单人沉浸悬浮位（`body.im:not(.pk)`）：pad[p0] 右下（left:auto;right:10px）、eb[p0] 右上 top:64px right:10px；cmp[p0] 左上同现状。
- 主题点行沉浸悬浮：`body.im .th{position:absolute;top:36px;right:10px;display:flex;flex-wrap:nowrap;margin:0;z-index:2}`、点 20px；删除 `body.pk .th{display:none}` → 沉浸下亦可换主题（单人双人同享）。
- 列式（非 im）下 `.th` 保持静态行现状。

### 3.3 画布防拉伸（render.js applyCanvasSize）

- 沉浸（body.im）时：取 main 客户区 aw/ah，`ratio = S.W/S.H`，`w = min(aw, ah*ratio)`，`h = w/ratio`，写 `cv.style.width/height` 像素值；列式时清空内联宽高（回 `width:100%` + aspect-ratio 现状）。
- `render.boot()` 增 `addEventListener('resize', applyCanvasSize)`（窗口尺寸/方向变化即重 fit；matchMedia 跨越必伴随 resize 事件）。
- 验收判据：沉浸下 `|canvas盒宽高比 - S.W/S.H| < 0.02`。

## 4. 错误处理与回退

- 图案 id 查无 → no-op（不崩不 warn 刷屏）。
- matchMedia 不支持（极老浏览器）→ `wideMQ` 取 `window.matchMedia ? ... : {matches:false, addEventListener(){}}` 兜底为列式（现状行为）。
- 旧主题记忆/非法 URL → 回退霓虹夜（现状）。
- 绘制异常 → render 现有 try/catch 保循环（现状）。

## 5. 测试与验收

浏览器走查（src 与 dist 各一轮关键项）：
1. PC 1280x900 单人：body 含 im；画布比例判据通过；无滚动条；右上主题点可切换。
2. PC 双人：沉浸现状不回归（双 pad 左右、名牌、overflow hidden）。
3. 模拟手机竖屏 390x844：单人列式；双人显横屏提示且可滚动。
4. 模拟手机横屏 844x390：单人沉浸、pad 右下不挡棋盘主体。
5. 沉浸中切 7 主题：图案/光影随主题重建、无 console error。
6. 强制 `S.lowFx=true` 对局 10s：无报错、图案仍在（缓存层）。
7. `?mode=pk` 与 `?mode=ai` URL 入口：im 类与按钮高亮正确（b08691e 回归）。
8. 重截候选图 4-5 张（含单人沉浸构图）存 screenshots/，人眼复检。

提交分笔：① 主题精简 ② patterns.js+光影层 ③ 布局 A（css+input+render） ④ 截图更新。

## 6. 后续迭代（本轮不做）

视觉验收通过后：GitHub Pages 部署（README 双语/LICENSE/仓库 isometric-snake）→ 排行榜功能（留存接口 v2 已预留）。
