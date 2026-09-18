# 词炬 · CET 备考助手

**答案经 examcrafts + 懒笔记双轮权威源交叉校对（1407 条答案 0 冲突）**——这是本产品与同类题库软件最硬的差异。在此之上：单词记忆、真题练习、听力训练、模拟考试、整卷研读（65 套，2021.06 – 2026.06，79 段听力音频齐备）、AI 阅读助手。

所有数据本地存储（内置词库随应用打包，用户进度存 localStorage），不依赖账号和联网服务，无广告。

## 功能

| 页面 | 说明 |
| --- | --- |
| 总览 | 学习统计与进度 |
| 单词 | 词库浏览与记忆 |
| 真题练习 | 分题型刷题（内置题库 66 套） |
| 听力 | 听力专项训练 |
| 试卷 | 真题整卷研读：按年/月筛选列表 → 卷面原文、听力原文与音频、逐题答案与解析（65 套，2021.06 – 2026.06） |
| 模拟考试 | 计时整卷模拟（内置题库 66 套） |
| 错题本 | 错题汇总与复习 |
| AI 阅读助手 | 阅读辅助（Markdown 渲染、语法解析、自定义提问） |
| 设置 | 主题（蓝白 / 黑白）等 |

## 技术栈

- **Electron 33 + Vite 5 + React 18 + TypeScript**
- 纯 CSS（`src/styles.css`），无 UI 库
- 页面切换靠 `App.tsx` 的 `PageKey` 状态，无路由库
- 数据全本地：内置词库 `src/data/`，用户数据 localStorage（`services/storage.ts`）

## 快速开始

```bash
npm install
```

| 方式 | 命令 |
| --- | --- |
| 双击启动（Windows） | `start.cmd` |
| 开发模式（Vite + Electron 热更） | `npm run dev` |
| 沙箱/受限环境启动 | `start.cmd soft`（或 `npm run dev:soft`） |
| 仅浏览器开发 | `npm run dev:web` |
| 类型检查 | `npm run typecheck` |
| 打包安装包 | `npm run dist`（输出到 `packaging/`；该目录被残留句柄占用时改用 `npx electron-builder -c.directories.output=packaging-newN`） |

> `dev:soft` 会清掉宿主注入的 `ELECTRON_RUN_AS_NODE`、禁用 GPU 加速，专为受限会话准备。Chromium 开关必须放在应用路径前面（`electron --no-sandbox --disable-gpu .`）。

## 目录结构

```
├─ electron/          主进程 + preload
├─ src/               渲染进程（页面、组件、词库、样式）
│  ├─ pages/          各功能页面
│  ├─ data/           生成产物：papers.ts（真题）、builtin-banks.ts（题库）——勿手改
│  ├─ components/     Icon.tsx 自绘 SVG 图标（全站唯一图标来源）
│  └─ styles.css      全部样式（分节维护）
├─ public/            听力音频等静态资源
├─ docs/              项目诊断报告
├─ scripts/           数据管线：OCR → 解析 → 生成题库（约 90 个 .mjs）
├─ ocr/               真题 PDF 与 OCR 文本（数据源）
├─ DESIGN.md          视觉规范（主题系统）
└─ HANDOVER.md        试卷/题库管线深度文档（接手必读）
```

## 数据管线

题库与试卷由脚本从 PDF（OCR + 文字层解析）及权威站点对照生成：

1. **卷面提取**：真题 PDF → 文字层/OCR → `layout-lines.mjs` 版式还原 → `build-papers.mjs` 结构化
2. **答案校对**：两轮权威源对照 —— examcrafts.com（只覆盖被改过的题）→ english-exam.lazynote.cn（全量，答案一律按「选项原文」定位，绝不按字母比）
3. **生成产物**：`import-all-papers.mjs` 拼装出 `src/data/papers.ts` 与 `src/data/builtin-banks.ts`

```bash
# 全量重建（有缓存，续跑很快）
node scripts/import-all-papers.mjs --conc 2 --threads 8

# 题库体检
node scripts/qa-question-bank.mjs --json .qa/qa-final.json
```

解析与修复脚本默认 **dry-run**，`--apply` 才落盘并自动备份。细节与踩坑见 [HANDOVER.md](HANDOVER.md)。

## 主题系统

- 唯一注册点 `src/theme.ts` 的 `THEMES`，皮肤 = `styles.css` 内对应 `:root[data-theme]` 覆盖块
- 切换走 `applyThemeSmooth(key, origin)`：新皮肤从点击处圆形漾开（View Transition），非交叉淡入
- 覆盖块只改几何与字体，禁止在基础类上写 `background`/`border-color`（会被特异性压掉变体类）

视觉规范详见 [DESIGN.md](DESIGN.md)。

## 注意事项

- `src/data/papers.ts`（约 4.3MB）与 `src/data/builtin-banks.ts` 均由脚本生成，**勿手改**；要改数据请走 `scripts/` 里的对应管线
- `ELECTRON_RUN_AS_NODE` 环境变量存在时（即使为空）Electron 会退化成纯 Node，`dev:soft` 已处理
- 打包输出目录（`packaging/win-unpacked`）一旦用过会被残留句柄锁住，无法删除或重命名 → 直接换一个新的输出目录即可；electron-builder 打包需免沙箱运行
- 验证打包版可运行：先 `unset ELECTRON_RUN_AS_NODE`（宿主注入会让 Electron 退化成纯 Node 直接退出），再 `CET_DISABLE_GPU=1 CET_DEBUG=1 "CET备考助手.exe" --no-sandbox --disable-gpu --disable-gpu-compositing --disable-gpu-sandbox`
- 引用ponytail、awesome-design-md等工具
