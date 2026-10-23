# 等距贪吃蛇 (Isometric Snake)

[![build](https://github.com/KKKK16689/isometric-snake/actions/workflows/build.yml/badge.svg)](https://github.com/KKKK16689/isometric-snake/actions/workflows/build.yml)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)

等距（2.5D）视角的贪吃蛇游戏。**单 HTML 文件、零依赖、纯 Canvas 渲染**，手机和电脑浏览器都能直接玩。

| 霓虹夜 | 赛博 | 熔岩（双人） |
|---|---|---|
| ![霓虹夜](screenshots/neon-night.png) | ![赛博](screenshots/cyber.png) | ![熔岩](screenshots/lava-pk.png) |

## 在线试玩

**https://kkkk16689.github.io/isometric-snake/**

> 仓库 Settings → Pages → Source 选 `main` 分支 `/ (root)`，约 1 分钟后生效。

## 主题（7 套，一键切换）

霓虹夜 · 冰川 · 赛博 · 糖果 · 熔岩 · 森林 · 沙漠

每套主题自带配色、地板图案（脉冲网格 / 冰裂 / 电路 / 糖粒 / 余烬 / 苔纹 / 沙纹）与光影风格；选择会记在本机，下次打开仍是上次那套。

## 冲刺音效（6 套，可自选）

工具栏最右侧下拉框可切换：**喷气 / 蓄能 / 街机 / 脉冲 / 引擎 / 电弧**，全部由 WebAudio 实时合成，无音频文件。选择同样会本地记住。

## 游戏模式

| 模式 | 说明 |
|------|------|
| 简单 | 3 条命，速度慢，适合上手 |
| 普通 | 1 条命，速度更快，冲刺更耗电 |
| 双人对战 | 同屏对战，3 个食物，撞到对方或自己即输 |
| 人机对战 | 对抗 AI，AI 有 简单 / 普通 / 困难 三档难度 |

## 操作

| 平台 | 操作 |
|------|------|
| 电脑 · P1 | `WASD` 或方向键转向，`Shift` / `E` 按住冲刺 |
| 电脑 · P2 | 方向键转向，`Enter` / `/` 按住冲刺 |
| 手机 | 屏幕按钮或滑动转向，按住「冲」冲刺 |
| 通用 | `空格` / `P` 暂停，点击画面开始 / 继续 |

- 冲刺消耗能量，耗尽后锁定至恢复到 30 才能再次冲刺
- 罗盘：箭头是蛇的朝向，橙点指向最近的食物
- 工具栏：音效 / 音乐 / 震动 / 每日挑战 / 幽灵 / 复制成绩；对战模式还可切 AI 难度
- 最高分保存在本地（localStorage）
- 横屏或宽屏（≥760px）自动切换到沉浸式布局：画布吃满视口、HUD 悬浮叠加

## URL 参数

| 参数 | 作用 |
|------|------|
| `?theme=N` | 指定初始主题（0–6） |
| `?mode=easy/normal/pk/ai` | 指定初始模式 |
| `?daily=1` | 进入今日每日挑战 |
| `?seed=N` | 自定义种子的每日挑战 |
| `?autostart=1` | 自动开赛（截图 / 演示用） |

## 特性

- 等距 3D 方块渲染：蛇身渐缩、箭头缝线、眼睛和吐信动画
- 7 套主题 + 7 种地板图案，纯数据注册表驱动，加新主题不动核心逻辑
- 粒子特效系统（吃食、撞击、冲刺光轨、电弧），固定容量对象池，零 GC 压力
- 冲刺能量系统 + 能量条 UI；6 套可切换冲刺音效
- AI 对手：洪水填充评估安全区域，避免追食物钻进死胡同；会预判对手头部位置并用冲刺抢食物
- 双人对战皮肤选择（双方不能同色）
- 全合成音效（WebAudio 振荡器 + 噪声 + 滤波器），无任何音频资源文件
- 连击计分：6s 内连续吃食，第 2 个起每个额外 +1（×2 封顶），HUD 显示连击数
- 金苹果：吃食后 12% 概率出现，6s 过期（最后 2s 闪烁告警），+3 分 +30 能量
- 每日挑战：同一种子全球同一局，结算可复制成绩分享对战（`?daily=1` / `?seed=N`）
- 幽灵回放：半透明重放本机破纪录局，和过去的自己同场竞速
- 本地统计：累计局数 / 食物 / 金苹果，结算页展示
- PWA：manifest + Service Worker 离线缓存，断网可玩，可安装到主屏幕
- 无障碍：读屏播报（aria-live）、尊重系统「减弱动态」、移动端震动反馈可开关

## 技术要点

- 零依赖，单文件成品（打包后约 91KB）
- **源码多文件 + 一键打包**：开发时按职责拆成 9 个模块，`node build.js` 内联成一个自包含 HTML
- 模块间通过事件总线单向通信，无强耦合；新增主题 / 图案 / 音色都是「往注册表加一条数据」
- 地板绘制一次后离屏缓存（offscreen canvas），每帧直接 `drawImage`
- 游戏逻辑与渲染分离；逻辑按固定 tick 步进，慢帧自动补 tick，游戏速度不依赖帧率
- 帧耗时滑动平均，设备变慢时自动关闭发光 / 电弧等重特效（lowFx 模式，带滞回恢复）
- 渲染性能：光晕预渲染精灵、加法通道合批、逐帧零分配（对象池 / 原地压实 / 量化色表）、单一 rAF 循环
- 画家算法按 `x + y` 排序绘制，保证等距遮挡正确
- 经典 `<script>` 顺序加载（非 ES module），因此双击本地 HTML 文件也能直接运行，不受 CORS 限制
- 无头测试：`npm test` 用 vm 加载纯逻辑 core.js 跑 node:test（转向 / 碰撞 / 填满判胜 / 种子确定性 / 200 局 AI 胜率），CI 在 PR 上跑测试并做产物漂移检查

## 目录结构

```
index.html        # 打包成品（GitHub Pages 入口，双击即玩）
src/              # 源码：index.html 模板 + css/ + js/（core / themes / patterns / audio / particles / render / ai / input）
build.js          # 一键打包脚本（零依赖，node build.js）
test/             # 无头逻辑测试（node --test，零依赖）
tools/            # 图标生成器（零依赖 PNG 编码器，npm run icons）
sw.js             # Service Worker 离线缓存（仅 http(s) 注册）
manifest.webmanifest + icons/   # PWA 清单与图标
docs/superpowers/ # v2 / v3 设计文档（plans/ 实施计划 + specs/ 设计规格）
screenshots/      # 截图
```

## 本地运行

两种方式都可以：

1. 直接双击根目录 `index.html`（成品，零依赖）
2. 起个本地服务看源码版：`python -m http.server 8098`，访问 `http://localhost:8098/src/index.html`

> 音效需要浏览器音频策略解锁：先用鼠标点一下页面（或按任意键）再操作即可正常发声。

## 构建

改完 `src/` 后重新打包：

```bash
node build.js      # 或 npm run build
npm test           # 无头逻辑测试（node --test）
npm run icons      # 重新生成 PWA 图标
```

## License

[MIT](LICENSE)
