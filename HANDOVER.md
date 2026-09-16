# 交接文档 · 试卷提取、题库修复与「试卷」功能

> 更新：2026-09-13
> 范围：
> 1. `ocr/` 文件夹 66 套四六级真题的「卷面 + 答案解析」结构化提取；
> 2. 应用内「试卷」页面（列表 + 整卷研读）；
> 3. **题库数据质量修复**（2026-09-13：`src/data/papers.ts` 61 套 + `src/data/builtin-banks.ts` 66 套）。

---

## 1. 目标

参考 [examcrafts.com](https://examcrafts.com)（`/cet4` 试卷列表、`/cet4/exam/:id` 整卷、`/cet4/exam/:id/answer` 解析页），把本地 `ocr/` 里的答案解析 PDF 与 `scripts/.download/` 里的真题 PDF 提取成结构化数据，在应用里做出「试卷」功能：**一级按年/月筛选的试卷列表 → 二级整卷研读（卷面原文、听力原文、逐题答案与官方解析）**。

## 2. 现状快照（2026-09-11 下午 · 质量修复后）

| 项 | 数值 |
|---|---|
| 产物 | `src/data/papers.ts`（**65 套**，tsc 通过、已在页面中使用；61 套 → 65 套见 §2.7） |
| 覆盖 | 四级 + 六级，2021.06 – **2026.06**（2026_06 第 1、2 套已导入，见 §2.7） |
| 数据质量 | `scripts/qa-papers.mjs` 扫描：问题条目从 **3826 → 244**（缺解析 1200+→48、空壳题→0、选项丢失 300+→27） |
| 构建失败 | **0 套**（原 10 套扫描卷全部救回；其中 5 套 OCR 全废、0 题，已由 assemble 过滤不入库） |
| 残留缺口 | 集中在 2021_06 / 2022_09 / 2023_12 的扫描卷：缺答案 156、缺解析 48、听力原文缺（解析 PDF 里没有「听力原文/标题」块） |
| 逐套明细 | `.qa/papers/cache/_audit.json`；质量扫描 `.qa/papers/qa-scan-final.log` / `qa-issues-final.json` |

**根因一句话**：`test.pdf`（真题卷）里 **39 套是扫描件、没有文字层**。解析器最初是按「有文字层的版式」写的，扫描卷走 OCR 后版式差异大，需要逐类适配。管线本身是通的、可续跑，剩下的是解析规则的迭代，不是基础设施问题。

### 2.1 本轮已修的解析器坑（build-papers.mjs / import-all-papers.mjs）

1. **Part 标题匹配重写**：OCR 把罗马数字打成 `Ⅱ/I/N/PartN`，且「Reading」被误标成 PartII——Part 定位改为「行首 12 字符内的部分名关键词 + 短行判定」，解析侧（`findIdx`）同步改。
2. **解析定位兜底**：解析 PDF 里 `News Report One` 等听力标题整块丢失时，按 `·答案详解·` 标记切块、逐题**按题号合并**（`ana.listeningByNum` / `ana.readingByNum`），不再依赖位置对齐。
3. **splitBilingual 纯英文头 bug**：解析头行只有英文时原来返回 `en:''`（题干全丢进 cn），已修；body 首行纯中文的题干译文也归位为 `stemCn`。
4. **选项标记三形态**：`A)` / `A.` / `A、` 都认（`OPT_MARK`）；粘连的 `instructed.D)` 先补空格再切。
5. **答案回填**：卷面 KEYS 缺失时，从解析文案提取答案（「选项B是正确答案」「故选C」「答案B。」「【答案】A」「选词填空头行 `26.F)impact…`」）。
6. **空壳题过滤**：题干/选项/解析全无的题、纯「题号+答案」卡、无题的听力分组、空 Part、0 题整卷都会被丢弃（0 题卷在 assemble 里过滤）。
7. **页脚/乱码清理**：`六级2021年6月31` 页脚变体、`\uFFFD` 替换符、`Translation (30 minutes)PartN` 头部粘连；OCR 打废的中文翻译题干（乱码率过高）整段置空而不是展示乱码。
8. **质量扫描脚本**：`node scripts/qa-papers.mjs --json out.json`（题库体检，注意 #26–45 是字母格选项，0 options 属正常）。

### 2.2 examcrafts 对照修正（2026-09-11 下午）

用户提供了站点账号（**凭据只走命令行参数，不入仓库**）。链路：

- **采集**：`node scripts/ec-crawl.mjs <user> <pass> .qa/ec/api`。站点内容接口 `admin.examcrafts.com/api/exams/cet/cet-content/<id>/?mode=answer` 强制 AES-GCM 加密（payload+iv+key_id → `decrypt-key-v2/<key_id>` 返回 hex key），且挂了 EdgeOne 反爬 —— **必须在浏览器页面上下文里 fetch**（headless Edge + CDP，见脚本）。解密后 JSON 落 `.qa/ec/api/ec-<id>.json`，卡片列表在 `_cards.json`（79 套，2020–2026）。
- **注意**：EdgeOne 有 IP 限频，请求太快会 `IP_BLOCKED`/挑战页，脚本已内置重试+退避；被封后等冷却再跑（脚本只补缺的文件，可反复跑）。
- **字段前缀是随机的反爬噪声**（wkz_/tdb_/ffj_…），`compare-ec.mjs` 按「去前缀字段名 + 形状」解析；选词填空的空格 id 有按段内 1-10 编号的形态，脚本统一归位 26–35（B/C 段同理）。
- **比对**：`node scripts/compare-ec.mjs` → `.qa/papers/ec-report.md` + `scripts/paper-fixes.json`。**站点优先原则**（用户定版）：站点是人工校验的权威源，所有字段一律以站点为准——答案/解析/题干/选项无条件覆盖，翻译/范文/听力原文有站点值就用站点值；fixes 文件**只增不删（merge）**。materials 每轮全量重推导（站点 transcripts 是整场 SRT 字幕，需按 `Questions X-Y are based on` 分组标记切开、按题号归位到分组块，不能整段塞进每块）。
- **build-papers.mjs 应用 fixes**：答案/解析/题干/选项（题级）、选词填空词库整体替换、听力原文、翻译 prompt+参考译文、写作范文+题目。
- 成效：61 套里 41 套与站点对齐（1234 个答案全部一致），另回填解析 25、题干 12、听力原文 40、翻译 9、范文 19；qa-papers 总问题 244 → **127**。
- 剩余 23 套站点数据因 IP 封禁未抓到（多为 2022–2023 六级扫描卷 + 站点也没有 2021 六级），封禁解除后重跑 crawl → compare → import 即可自动补上。

### 2.3 站点数据补齐 + 听力音频（2026-09-13）

- IP 封禁解除后重跑 `ec-crawl.mjs`，站点 79 套里 **76 套**已抓齐（3 套站点本身无内容），本地 61 套里 **55 套有站点对照**（cet6-2021_06_1/2、cet6-2023_12_2 站点没有对应卷）。累计：1397 个答案与站点一致、修正 6+20 处、回填翻译 17 套等。
- **听力音频**：站点每套有 Section A/B/C 三段 mp3（`media/` 无鉴权，直接 GET）。`node scripts/download-ec-audio.mjs` → `public/audio/papers/<本地id>-{A,B,C}.mp3`（213 个文件，带 `.ok` 标记防重复下载，manifest 在 `.qa/ec/api/audio-manifest.json`）。
- **接线**：`compare-ec.mjs` 把 audio_urls 写进 fixes；`build-papers.mjs` 按「本地 mp3 存在」给 Part II section 挂 `audio` 字段（types.ts `PaperSection.audio`）；`Papers.tsx` 的 SectionView 在 ps-head 下渲染 `.ps-audio` 播放器（原生 audio 控件，preload=none）。
- 新套卷音频补齐流程：crawl（抓内容）→ `download-ec-audio.mjs`（下 mp3）→ `compare-ec.mjs` → `import-all-papers.mjs`。
- 已知未采纳：`cet6-2023_12_1` 有 7 题站点与本地答案不同但全卷一致率仅 30%（两边的「第1套」很可能不是同一份卷），按规则拒绝覆盖，保留本地答案。

### 2.4 题库数据质量修复（2026-09-13）

针对用户提出的四类问题：**选项缺失 / 空格间断缺失 / 内容冗余 / 信息缺失**。两套数据都改了：

| 数据 | 文件 | 用在哪 |
|---|---|---|
| 整卷真题 61 套 / 2156 题 | `src/data/papers.ts` | 「试卷」页 `Papers.tsx` |
| 内置题库 66 套 / 2237 题 | `src/data/builtin-banks.ts` | 「模拟考试」页 `MockExam.tsx` |

备份：`.qa/papers.ts.bak`、`.qa/builtin-banks.ts.bak`。详细报告：`.qa/题库修复报告.md`。

**成效**

| 指标 | papers.ts | builtin-banks.ts |
|---|---|---|
| 选项不足 4 个 / 字母键异常 | 27 → **2** | 19 → **3** |
| 空格间断 | 英文粘连修 569+19 处；选词填空空格占位**补齐 16 个块** | 选词填空无编号 **61 → 0**，另修 121 处 |
| 内容冗余 | 译文前缀 258→**0**、广告 15→**7** | 清理 563 处 |
| 缺答案 | 58 → **33** | 271 → **143** |
| 缺题干译文 | 825 → **687** | — |

**根因一句话**：卷面 PDF 是**双栏排版**（`A) … C) …` 换行 `B) … D) …`），早期导入只取到左栏，C/D 整列丢失；解析里的答案字母也常被 OCR 抹掉。

**修复后复检（`node scripts/qa-question-bank.mjs`，61 套 / 2156 题）**

| 类别 | 剩余 | 构成 |
|---|---|---|
| 内容冗余 | 285 | 解析过长（>1200 字）201、解析尾部混入词汇表 43、解析重复片段 41 |
| 信息缺失 | 115 | 答案 33、选项译文 36、篇章/听力原文 26、解析过短 18、其它 2 |
| 空格缺失 | 58 | 英文粘连 48、选词填空空格不足 10 个 |
| 选项缺失 | **2** | — |

**注意：审计脚本的绝对数值在 2026-09-13 晚做过一次口径修正**，之前报的 3848 里有 3000+ 是误报，别拿旧数字对比：

| 误报源 | 说明 |
|---|---|
| 「解析重复片段」正则 | 老写法用了 `\1` 反向引用但分组带 `?`，未参与匹配时退化成空串，整条式子恒真 → 2400 条假阳性。已换成「中文 40 字连续片段重复」 |
| 长篇阅读 / 选词填空计成「选项缺失」 | 这两类的选项就是 A–O 字母格，`options` 恒为 `{}`，UI 走 `letterOnly` 渲染。已豁免 |
| 粘连检测用的 200 词小词典 | `handbook` / `workplace` / `headteacher` / `something` 这类真复合词被当成粘连。已改为直接复用 `lib-spacing.mjs` 的 `_splitGlued`，**审计口径 == 修复口径** |
| 选词填空「题干为空」 | 选词填空的题干就是篇章里的 `___26___`，`stem` 恒空。已豁免 |

**新增脚本**（都是默认 dry-run，`--apply` 才落盘）

| 脚本 | 作用 |
|---|---|
| `scripts/fix-question-bank.mjs` | papers.ts 五阶段修复：① 选项/词库回填 ② 空格 ③ 冗余 ④ 答案 ⑤ 听力题干译文 |
| `scripts/fix-builtin-banks.mjs` | builtin-banks.ts：补选项、`____`→`___26___`、只填空缺答案、清冗余 |
| `scripts/lib-parse-testocr.mjs` | 卷面 OCR 解析：题号块 + 双栏选项 + 挤成一行的词库 |
| `scripts/lib-spacing.mjs` | 英文空格修复（词形还原 + OCR 垃圾词表）。`_splitGlued` 同时供审计复用 |
| `scripts/fix-banked-blanks.mjs` | 补回选词填空被 OCR 吃掉的 `___26___` 空格占位，见下方说明 |
| `scripts/diff-spacing.mjs` | 空格改动前后对照，人工抽查用 |
| `scripts/qa-question-bank.mjs` | 题库四类问题全量审计 |
| `scripts/detect-glued.mjs` | 粘连词检测 |

```bash
node scripts/fix-question-bank.mjs                    # dry-run 看统计
node scripts/fix-question-bank.mjs --apply --report .qa/fix-report.json
node scripts/fix-builtin-banks.mjs --apply
node scripts/fix-banked-blanks.mjs --apply            # 补选词填空的 ___26___
node scripts/qa-question-bank.mjs --json .qa/qa-final.json
node scripts/diff-spacing.mjs 30 material             # 抽查 30 条篇章空格改动
```

### 2.5 选词填空的空格占位（`fix-banked-blanks.mjs`）

选词填空的空格在卷面上是 `a meaningful ___26___ on health`，部分扫描卷 OCR 后下划线整段丢失，只剩裸数字，而且形态五花八门：

| 形态 | 例子 |
|---|---|
| 下划线跑前面 | `createfabricand_26__it into a shirt` |
| 只剩尾下划线 | `somewhat 27_, since…` |
| 干干净净的裸数字 | `a meaningful 26 on health` |
| 被吃掉 | `Despite these 35, the study's…` |

脚本思路：26–35 每个编号在篇章里必然出现**且按序递增**。已带 `___NN___` 的当锚点，缺失编号在候选里做递增匹配——先试「26–35 全部凑齐」的严格解，凑不齐再退到单调贪心（允许少补几个，但先后顺序仍然正确）。护栏三条：数字后紧跟单位词（`30 minutes`）不算、页脚附近的数字（`…[26] ===== PAGE 4 ====`）不算、删完短于 40 字的整块放弃。

结果：41 个选词填空块里 **24 → 32 个凑齐 10 空**，剩余 9 个是编号被 OCR 彻底吃掉的，没敢猜。

**答案源可信度（重要，别踩）**

| 来源 | 结论 |
|---|---|
| `scripts/paper-fixes.json`（examcrafts 对照） | **1407 条零冲突**，唯一可信答案源。但只含「被改过」的题，长篇阅读 36–45 一条没有 |
| `scripts/.download/*/*/answers.json` | **冲突 501 : 一致 379，已弃用**。只认带 `_verified` 的 9 个文件 |
| `scripts/.download/*/*/web-answers.txt` | 一致 162 : 冲突 186，套次编号对不上，不可用 |

**刻意保守的几处**（接手前先读，别贸然「补全」）

1. **两套库答案有 428 条分歧**（占 27%），解析文本因双栏串扰无法裁决——同一段里既有「故答案为 A)」又有「因此答案为B)」，分属相邻两题。**只填空着的答案，已有答案一律不覆盖。**
2. **残余 33 个答案保持留空**：主要是长篇阅读（36–45），字母在 OCR 里被彻底吃掉。实测「题干↔段落关键词重合」推断法在 356 道已知题上 **Top1 命中 0%**（同义转述 + 干扰段共享主题词），放弃猜测——留空优于填错。
3. **长串粘连只修最有把握的一类**：61 套语料只有 2.2 万词，用词典 DP 猜任意单词会把 `readiness` 切成 `read iness`、`confirmsthat` 切成 `con firms that`。
4. **43 条「解析尾部混入词汇表」没删**（`pensionn.养老金；退休金 ·private sector私营部门`）。试过按「重合片段」自动清洗，但仔细阅读的解析本来就要引用定位句，一删就把答案理由删没了；而且词汇表出现的位置不固定（有的在解析前、有的在解析后），没有可靠的切点。**它对学生其实是有用信息**，暂留，等 UI 上单独拆一个「词汇」区再搬。
5. **不要用「解析过长 / 重复片段」去自动截断解析**：抽查发现有些不是冗余而是**字段错置**——例如 `cet4-2023_06_1-long` 的 `material` 里存的是选项文本（`c) they enable him to enjoy a creative career…`），真正的篇章正文被塞进了某题的 `analysis`。自动删会把正确答案依据删掉。这类要先修 `material` 再谈清洗。

## 2.6 二轮修正：换源到 english-exam.lazynote.cn（2026-09-13 晚）

上一轮的答案源是 examcrafts，只覆盖「被改过的题」，长篇阅读一条没有。这轮换了新源：**懒笔记 `english-exam.lazynote.cn`**，
四六级 2015–2026 各 76 套，逐题给出**答案 / 题干 / 四选项 / 逐项中译 / 逐空解析 / 完整录音原文**，锚点稳定（`id="q-N"`）。

> **注意：该站点整站没有试卷图片**（`<img>` 只有 favicon；下载的 PDF 也带 `/Font` 文字层）。
> 直接解析 HTML 文本即可，不要走「渲染成图再 OCR」——上一轮 3826 条问题的根因就是 OCR。

**两个必须记住的坑**

1. **本地与站点的「第 N 套」常不是同一份卷**（本地套号来自扫描卷）。做法：同一考次站点 1/2/3 套做排列匹配，取最相似者，< 80% 的整卷跳过。→ 120/127 套对齐。
2. **本地选项的字母顺序常与官方卷不同**（同一组四选项被打乱，甚至有完全倒序的）。所以
   **答案一律按「选项原文」定位，绝不按字母比**：先看站点说哪段文本对，再在本地选项里找同文本的字母。
   按字母比会把 100% 正确的套卷判成 58% 一致率。选词填空则按「词」在本地词库里定位字母。

**成效**（清单 `.qa/lazynote/fixes.json` 3094 条，逐条含旧值/新值）

| 指标 | 修正前 | 修正后 |
|---|---:|---:|
| `papers.ts` 缺答案 | 33 | **1** |
| `papers.ts` 选项缺失 | 2 | **0** |
| `builtin-banks.ts` 缺答案 | 143 | **1** |
| 两库同卷答案分歧（原 §2.5 的 428 条） | 428 | **33** |

修正类型：修改答案 929、新增答案 174、新增选项中译 1700、新增题干/陈述句中译 264、新增听力原文 24、新增选项 3，**删除 0**。
`npx tsc --noEmit` 通过；试卷页 / 模拟考试页实测渲染正常。详见 `.qa/lazynote/修正报告.md`。

**刻意没动**：选项顺序未重排（只保证本地字母↔答案自洽）；选词填空词库未替换（站点干扰词与本地不同的那几套无法判定谁对）；
内容冗余 285 条未删（理由同 §2.5）；7 套整卷跳过（`cet6-2023_03_1`、4 套「第2、3套合并卷」、`cet4-2022-06-3`、`cet6-2023-03-1`）。

**新增脚本**：`scripts/lz-crawl.mjs`（抓站点 → `.qa/lazynote/{raw,extract}`，有缓存、可重跑）、`scripts/lz-fix.mjs`（对齐 + 修正，默认 dry-run，`--apply` 落盘并自动备份 `.bak2`；自带「两库同卷答案交叉校验」）。

## 2.7 新增整卷：2026 年 6 月四六级（2026-09-13 晚）

`2026_06` 长期只有真题没有解析（`scripts/.download` 里 `test.pdf` 是 325 字节的占位文件），**现在用 lazynote 补齐并导入 4 套**：
`cet4-2026_06_1` / `cet4-2026_06_2` / `cet6-2026_06_1` / `cet6-2026_06_2`，**61 套 → 65 套 / 2376 题**，4 套均 0 缺答案、0 缺解析。

- 脚本 `scripts/lz-build-2026.mjs`（默认 dry-run，`--apply` 落盘、自动备份 `.bak3`、同 id 先删后插可反复跑）。
- 字段来源：逐题数据取 `.qa/lazynote/extract/<套>.json`；听力分组取解析页目录（`ptoc__link--top`，**权威分组，别按题号硬编码**）；篇章取段落容器 `id="p-N"`；写作取 `id="directions"/"essay"/"essay-zh"/"analysis"/"review"`；翻译取 `id="stem"/"translation"`。
- 校验：逐题答案与页面自带答案串 **24/24×4 套**一致；与本地 hqwx 的 `answers.json` 51–55/55 一致（分歧以站点为准）。
- **第 3 套没导**：站点没有 `/cetX/sections/listening/2026-06-3/`，只有阅读 26–55，缺整个 Part II，不导。
- **没音频**：站点 mp3 由前端 JS 动态加载，HTML 里查不到地址，4 套新卷 Part II 都没有 `.ps-audio`。
- 顺带修了 `lz-crawl.mjs` 的 4 个抽取坑（详见 `.qa/lazynote/2026-06导入报告.md` §4）：解析块 `aside`/`div` 两种标签、解析块要**配平取**（否则被第一行 `</div>` 截断）、段落切片会吞掉后面的解析、`data-pdh-stem` 是 `<span>`。

> 修好解析抽取后 `lz-fix.mjs` 会多出 `ADD_ANALYSIS=394`（旧 61 套的长篇阅读等），**本轮刻意没落盘**——「做题界面」的逐题解析已删，`analysis` 目前没有消费方。要补再跑 `node scripts/lz-fix.mjs --apply`。

## 3. 数据流

```
真题卷 scripts/.download/cet{4|6}/<key>/test.pdf
   ├─ 有文字层 → scripts/dump-paper-text.mjs ──────────┐
   └─ 扫描件（<2KB）→ scripts/ocr-pdf.mjs ─┐           │
                                           ├→ layout-lines.mjs ─┤
解析卷 ocr/pdfs/{四级|六级}/*_答案解析.pdf ─┘                    │
                                                                ▼
                              scripts/build-papers.mjs ──→ .qa/papers/cache/out/<id>.json
                                                                │
                              scripts/import-all-papers.mjs ────┘（拼装 + 校验）
                                                                ▼
                                                   src/data/papers.ts
```

- 两个来源分工：**卷面**（题干、英文选项、篇章、词库、KEYS 答案）来自真题 PDF；**解析**（听力原文、选项中文、逐题详解、范文/点评/译文/词汇/句型、翻译参考译文）来自答案解析 PDF 的 OCR。
- 缓存：`.qa/papers/cache/<id>/paper.txt` 与 `analysis.txt`。**存在即跳过**，所以重跑很快；改了解析规则后只想重建数据，把对应 `paper.txt`/`analysis.txt` 删掉再跑即可。
- OCR 页级 JSON 留在 `C:\Users\yy\AppData\Local\Temp\cetocr\batch\<id>\out\`，调版式时**不必重跑 OCR**，只跑 `layout-lines.mjs`。

## 4. 文件清单

### 核心（别删）

| 文件 | 作用 |
|---|---|
| `scripts/render_pdf.py` | PDF → PNG。**必须用系统 Python 3.12**（`C:/Users/yy/AppData/Local/Programs/Python/Python312/python.exe`，只有它装了 PyMuPDF） |
| `scripts/ocr-pdf.mjs` | 单套 PDF → PP-OCRv5 页级 JSON。参数 `<pdf> <workDir> [dpi] [threads]`，`workDir` 必须纯 ASCII |
| `scripts/layout-lines.mjs` | 页级 JSON → 正确阅读顺序的文本（单栏 + 局部双栏混排） |
| `scripts/dump-paper-text.mjs` | 有文字层的真题 PDF → 按 y 聚行的整卷文本 |
| `scripts/build-papers.mjs` | 卷面 + 解析 → 单套 JSON。**每套写一个 JSON 到 `--out` 所在目录**，不做读回合并 |
| `scripts/import-all-papers.mjs` | 编排：发现套卷 → 并发提取 → 逐套构建 → 拼装 `src/data/papers.ts` → 审计 |
| `src/data/papers.ts` | 生成产物，**勿手改** |
| `src/types.ts` 的 `Paper / PaperSection / PaperBlock / PaperQuestion` | 数据模型 |
| `src/pages/Papers.tsx` | 「试卷」页（列表 + 整卷） |
| `src/styles.css` 第 33 节 | 试卷页样式，类名前缀 `.paper-* .pf-* .pc-* .ps-* .pb-* .pq-* .pa-*` |
| `scripts/fix-question-bank.mjs` | 题库修复（papers.ts），见 2.4 |
| `scripts/fix-builtin-banks.mjs` | 题库修复（builtin-banks.ts），见 2.4 |
| `scripts/lib-parse-testocr.mjs` / `lib-spacing.mjs` | 上述两个修复脚本依赖的解析 / 空格库 |
| `scripts/qa-question-bank.mjs` / `diff-spacing.mjs` / `detect-glued.mjs` | 题库体检与改动抽查 |
| `scripts/download-ec-audio.mjs` / `merge-paper-audio.mjs` | ec 听力 A/B/C 分段下载、字节拼接成整段 mp3（§12） |
| `scripts/lz-audio.mjs` | 懒笔记 HLS（m3u8+TS）→ 单文件 AAC，纯 JS 抽流，**无 ffmpeg 依赖**（§12） |
| `scripts/fill-paper-audio.mjs` | 按 TARGETS 表回填 `audioUrl`（dry-run / `--apply`），带备份 + 自检 |
| `scripts/audit-paper-audio.mjs` | 音频体检：哪些听力 section 没音频 / 文件不存在 |
| `scripts/check-bank-audio-match.mjs` | 题库内置音频 ↔ 整卷听力是否同一份卷（按选项原文 Dice） |
| `scripts/qa-paper-transcript.mjs` | 连运行中 Electron（CDP 9222）自检「听力原文」按钮三种入口行为 |

### 一次性 / 可删

`ocr-papers.mjs`、`ocr-papers2.mjs`（被 `ocr-pdf.mjs` 取代）、`ec-login.mjs`（被 `ec-paper.mjs` 取代）、`batch-ocr*.mjs/.py`、`test-ocr-params*.mjs`、`kill-edge.ps1`、`kill-node.ps1`。
`scripts/ec-probe.mjs` / `ec-paper.mjs`：headless Edge 采集参考站用，留着以后对照版式。

### 参考素材

`.qa/ec/site/`：examcrafts 的列表页 / 考试页 / 解析页截图与文本。
`.qa/papers/`：应用截图、批量日志（`import*.log`）、缓存。

## 5. 常用命令

```bash
# 全量（有缓存，续跑很快）
node scripts/import-all-papers.mjs --conc 2 --threads 8

# 只跑某一级 / 限量
node scripts/import-all-papers.mjs --level 4 --limit 3

# 只重跑「解析规则」（删掉某套的中间产物后重跑）
rm .qa/papers/cache/cet4-2025_12_1/analysis.txt
node scripts/import-all-papers.mjs --conc 2 --threads 8

# 看某套的版式还原（不重跑 OCR）
node scripts/layout-lines.mjs "C:/Users/yy/AppData/Local/Temp/cetocr/batch/cet4-2025_12_1/out" /tmp/x.txt

# 页面视觉自测（Vite 5173 需先跑起来）
node scripts/qa-shot.mjs http://127.0.0.1:5173/ none - 3 "null" .qa/papers/shot.png 600
```

## 6. 数据模型（一卷三层）

```
Paper                    id / level / year / month / setNo / title / minutes
 └ PaperSection          partNo I–IV、partName、score、minutes
    └ PaperBlock         一个「组」：听力的一段材料 / 阅读的一篇 / 写作或翻译一题
       └ PaperQuestion   num / stem / stemCn / options / optionCn / answer / analysis
```

- `options`、`optionCn` 都是「字母 → 文本」映射（键 A–O）。
- **选词填空与长篇阅读的选项就是字母本身**（词库 / 段落编号），UI 里走 `letterOnly` 只渲染 A–O 字母格。
- 写作块：`prompt / review(审题) / sample(范文) / sampleNote(点评) / sampleCn(译文) / vocab / patterns`。
- 翻译块：`prompt / terms(难词译注) / reference(参考译文) / notes(译点精析)`。

## 7. 踩坑清单（接手必读）

**环境**
1. `ppocr.exe` 在**非 ASCII 路径**下直接崩（GBK/UTF-8 问题），所以中间产物全放 `%TEMP%\cetocr`。
2. 子命令必须写成 `ppocr.exe ocr --input=...`（等号形式）。只给 `--input` 会报 `Unsupported pipeline`；空格分隔的 `--input x` 会直接打印 help。
3. 路径必须**相对于 bin 目录**（`c:\Users\yy\.trae-cn\skills\local-ocr-npu\bin`），模型在 `C:/Users/yy/.openvino/models/PP-OCRv5_server_{det,rec}_ov`。
4. 这台机器**不是 Intel AIPC，NPU 不可用**，只能 `--device=cpu`；skill 自带的 `run.ps1` 因中文路径编码问题会失败，直接调 exe。
5. 渲染 PDF 用系统 Python 3.12（有 PyMuPDF）；managed Python 3.13 没有。
6. headless Edge 采集网页：`Page.captureScreenshot` **别加 `captureBeyondViewport`**，会挂住 CDP；整页图改成「先量 `scrollHeight` 再把视口设高」。

**OCR 质量**
7. PP-OCRv5 对**两端对齐的英文会吞词间空格**（`shouldadopt` / `coverofa` / `cathas`）。`build-papers.mjs` 里的 `fixEnSpacing` 用项目自带 7 个词库（3.4 万词）做词典分词切回来，并要求大小写边界也过词典（`McDonald` 不会被拆成 `Mc Donald`）。**词库是唯一词表来源**，遇到专有名词切不动时宁可保留粘连。
8. 标题里的空格也会被吞（`NewsReport Three`），匹配标题要允许无空格形式。

**版式还原（`layout-lines.mjs`）**
9. 找栏间距**不能用全页水平投影**（页面下方的通栏段落会在别的 y 上填满栏间距），**也不能用页面中线**（左栏文字常常跨过中线）。正确做法：按行统计「行内部横向空白」，出现 ≥3 次的同一位置才是真栏间距。
10. 作文区是双栏「左＝范文，右＝点评」，还原后顺序是 范文 → `·范文译文·` → 点评 → 译文。切分依据：**译文标题行是纯中文、含「：」、很短、下一行是长正文**；点评每行都夹英文词。

**解析器（`build-papers.mjs`）**
11. **定位 Part 不能靠罗马数字**——PDF 文字层会把它识别成 `Il` / `][` / `N` / `Ⅱ`。已改成按每部分独有标题关键词（`Writing(30 minutes)` / `Listening Comprehension` / `Reading Comprehension` / `Translation(30 minutes)`）。
12. 卷面题号偶尔漏句点（`48 What may…`），`NUM_RE` 已兼容「数字+空格+大写字母」。
13. 每篇阅读末尾的「46.C 47.B 48.D」答案速查行会被当成题干，**覆盖掉同题号真正的解析**（曾导致 46/50 解析为空）。`ANS_LIST_RE` 已排除。
14. 页脚「2 四级2025.12第一套」、页眉「斤第一套」（实为「｜第一套」误识）、解析行首「→」都要清掉。
15. **不要在 `build-papers.mjs` 里做「读回再合并」**——`indexOf('[')` 会撞上 import 行的 `Paper[] = [`，导致整份文件被「只剩当前一套」覆盖（已经踩过一次，56 套变 1 套）。现在每套写独立 JSON，最后统一拼装。

**页面布局（整卷页两栏）**
16. 整卷页是「顶栏固定 + 卷面/题号目录各自滚动」，靠 `.paper-page` 撑满一屏（`height: calc(100dvh - var(--main-pt) - var(--main-pb))`）。**`--main-pt/--main-pb` 与 `.main` 的纵向内边距必须同源**，改一个就得改另一个，否则 `.main` 会多出一条 1px~几十 px 的滚动条。窄屏（≤1180px）两栏堆叠时这条前提不成立，媒体查询里已把两栏改回 `overflow: visible` 走整页滚动。
17. 栏内滚动容器不要用 `position: sticky` 顶栏来「假装分离」——sticky 只能钉住一栏，滚轮压在它上面时滚的仍是同一个滚动轴。验证用 `scripts/qa-paper-scroll.mjs`（headless Edge + CDP），**别加 `--hide-scrollbars`**，否则量不到滚动条占位宽度。

## 8. 待办（按优先级）

1. **扫描卷的卷面适配（最大头，39 套）**
   现状：只有少数扫描卷能出全 55 题，多数缺听力部分。做法：挑 `cet4-2023_12_1`（40 题）和 `cet6-2021_12_3`（20 题）这类「部分成功」的，对照 `paper.txt` 找听力分组标题 / KEYS 页的实际形态，逐类补规则。改完删对应缓存里的 `paper.txt` 重跑即可，单套秒级。
2. ~~**残余空缺答案**（33 / 143）~~ **已解决**：换源 lazynote 后剩 1 / 1，见 §2.6。
2.5 ~~**两套库的 428 条答案分歧**~~ **已解决**：以站点为准覆盖后剩 33 条，全部落在 §2.6 跳过的 7 套里。
2.6 **`material` 字段错置**（新发现，优先级高但量小）：`cet4-2023_06_1-long` 的 `material` 存的是选项文本而不是篇章，篇章正文跑到某题的 `analysis` 里。先全库扫一遍「`material` 里出现 `a) / b) / c)` 选项行」的块，确认范围再决定是重跑 build-papers 还是单独修。
2.7 **9 个选词填空篇章空格仍缺**：编号被 OCR 彻底吃掉，`fix-banked-blanks.mjs` 找不到候选就跳过了。只能回 `test-ocr.txt` 原文按段落位置补。
2.8 ~~**缺选项译文 / 缺题干译文 / 缺听力原文**~~ **大部分已解决**（§2.6：补选项中译 1700、题干与陈述句中译 264、听力原文 24）。**仍缺**：阅读篇章原文（`material`）还是本地 OCR 文本、48 处粘连；26 个块的篇章原文没有站点对应页（站点阅读原文在文章页，不在套卷页）。
3. ~~**`2026_06`**~~ **已导入第 1、2 套各两个级别（61 → 65 套），见 §2.7**。剩余：**第 3 套缺听力源**（站点无听力页）。
4. ~~**听力音频**~~ **已补齐：79 个听力 section 全部有 `audioUrl`（2026-09-15）**，见 §12。剩下的只有「音质版本」选择：ec 的音频是**无答题停顿的压缩版**（如 cet4-2026_06_1 18.3min vs 懒笔记 23.8min），若要全站换成带停顿的原速版，需要重抓 65 套（约 800MB），别轻易动。
5. **整卷页交互**（可选，部分已做，见 §11）：题号目录只有「作答状态 + 跳转」，没有「当前题高亮」；顶栏只有「显示答案解析」一个总开关，**Part 级开关仍 TODO**。
6. **打包注意**：`papers.ts` 现在 4.3 MB（HANDOVER 上一版写的 2.8 MB 是笔误），和 `builtin-banks.ts` 一起会推高单包体积；若要做拆包，`import.ts` 的动态导入方案在 `.workbuddy/memory/2026-09-10.md` 里有记录。
   打包实践（2026-09-13）：产物 `packaging-new/CET备考助手 Setup 1.0.0.exe`（901MB）。沙箱会话里 electron-builder packaging 阶段会卡死，须免沙箱跑；旧 `packaging/win-unpacked/resources/app.asar` 可能被 WorkBuddy 宿主进程占用（删除/改名失败），用 `-c.directories.output=packaging-new` 换目录绕开。详见 `.workbuddy/memory/2026-09-13.md`。

## 9. 其他

- 参考站 examcrafts.com（第一轮答案校对的来源）与 english-exam.lazynote.cn（第二轮、见 §2.6）。examcrafts 的账号密码由用户提供（**不要写进仓库**），登录采集脚本见 `scripts/ec-paper.mjs`。
- 项目约定、历史踩坑见 `.workbuddy/memory/MEMORY.md` 与 `2026-09-10.md` / `2026-09-11.md`。

## 10. 第三套卷的听力导入（2026-09-14）

`scripts/import-set3-listening.mjs`（dry-run / `--apply`）：把每个年月**第1、2套的听力**（section + 整段音频）deep-clone 进**同场次第3套**，作为两个 variant；前端 `Papers.tsx` 对同一 `partNo` 的多个 variant **随机显示一个**（进卷随机，Part II 头部「换一套听力」按钮确定性轮换；右侧目录/总题量同步按选中项算）。

- 数据源：懒笔记 `.qa/lazynote`（listeningBlocks 从 raw HTML TOC + extract 重建完整 25 题）。**排列匹配**：本地有 ≥3 道听力题时按「正确选项原文」比对（≥80% 采信）；不足时退回阅读排列匹配（选词按词、长篇按字母、仔细阅读按选项原文，≥5 题 ≥80%）。cet4/cet6-2023_06_2 为 96%（24/25），其余全 100%。
- 幂等：重跑先移除 `sourceSet` variant 再导入；第1/2套重建后听力补全为 25 题（此为附带修复）。
- 音频：7 套缺合并 mp3 的（cet4-2021_12_1、cet4-2023_06_1/2、cet6-2022_12_2、cet6-2023_12_1、cet6-2023_06_1、cet6-2024_06_2）由 A/B/C 分段字节拼接补齐。第3套 variant 的 `audioUrl` 直接引用第1/2套文件，音题天然一一对应。
- **已知无音频**（题+原文完整，无播放器）：cet6-2021_06_1/2、cet6-2021_12_1/2（懒笔记无页、ec 无 2021 六级卡片）、cet6-2023_12_2（两边都没有）。懒笔记站点本就没有 2022-06/09、2023-03 的「第2套」听力页（404 已探测），但这些场次本地也没有第3套卷，不影响导入。
- `PaperSection.sourceSet`（types.ts）标记来源「第1套/第2套」；备份 `.qa/lazynote/papers.ts.bak5`。QA 截图 `.qa/lazynote/set3-qa/`。

## 11. 整卷页交互模型（2026-09-15 定版）

整卷页（`Papers.tsx`）三种进卷方式，解析可见性由此决定，别随手改：

| 入口 | `analysisMode` | `revealed` | 表现 |
|---|---|---|---|
| 列表「进入试卷」 | false | false | 答题模式：不出现任何解析入口（顶栏/侧栏按钮都 `analysisMode &&` 条件渲染，只藏一处会从另一处漏答案）；**「听力原文」按钮也不渲染**（见下） |
| 列表「答案解析」 | true | true | 进卷即展开解析，顶栏「隐藏解析」可收 |
| 卷内「提交」 | false | — | `submitted` 走同一套对错渲染 + 解析正文，但不出现解析开关；**此时「听力原文」按钮才出现** |

- **原文折叠开关**：块头右侧 `.dt-tag.ps-src.pb-src`（`<button>`，`aria-expanded`，eye / eyeOff 图标，展开态加 `.is-on`（`background: var(--bg)`））。默认值 `materialOpen ?? (!isListening || revealed)` —— **听力原文**（`block.intro` 存在）在答题模式默认收起（不剧透）、进解析模式或交卷后默认展开；**篇章原文**是卷面正文，默认展开。手动切换优先于默认值。
  - **按钮的可见性单独一道闸**：`SectionView → BlockView` 传 `allowTranscript={analysisMode || shown}`，`canToggleMaterial = !!block.material && (!isListening || allowTranscript)`。即**由「进入试卷」进入、未交卷时，听力原文按钮根本不渲染**（旧行为是渲染按钮、默认收起，用户仍能点开偷看 → 2026-09-15 改）。答题模式下音频播放器 `.ps-audio` 照常显示，被藏掉的只有原文按钮，别一起藏。
  - 曾经的坑：一度把 `showMaterial` 开关连同按钮一起删掉、原文全部常显，块头留了一个「看起来能点但不能点」的静态 `.dt-tag`。
- **逐题官方解析**：`QuestionView` 里 `revealed && q.analysis` → `.analysis-box` + `.ab-title`「官方解析」+ `.ana-text`（`formatAnalysis` 把 `【答案】【定位】【信号】【替换】【排除】` 逐段换行）。与听力练习页同一套呈现，**中性**配色（不要用绿色的 `.pq-ana`——那是写作块解析用的，绿色在本页是「答对」语义）。同时 `revealed` 时补 `q.stemCn`（`.pq-stem-cn`）。
  - `formatAnalysis` 从 `ui.tsx` 的 `AnalysisBtn` 里抽出来共用，别在页面里再抄一份正则。
- 验收脚本：`.qa/papers-src-analysis.mjs`（headless Edge + CDP，走 Vite 5173）。`node .qa/papers-src-analysis.mjs http://127.0.0.1:5173/ spacex` 可换主题复验。断言口径：答题模式 `listenToggle` 4 项里应为 **0**（4 个篇章原文按钮）+ `materials` 4；解析模式 `listenToggle` = 听力块数（8）、`srcOn` = 原文块总数（12）、`.pq .analysis-box` = 题数（55）。
  另有一个直接连**运行中 Electron（CET_DEBUG=1，CDP 9222）**的入口行为自检：`node scripts/qa-paper-transcript.mjs`，三个场景一次跑完（未交卷 0 / 交卷 8 / 解析入口 8）。

## 12. 听力音频管线（2026-09-15 补齐到 79/79）

`PaperSection.audioUrl` 一个字段，三种来源，前端都是 `<audio controls preload="none">`（`.ps-audio`）：

| 来源 | 路径 | 谁在用 | 说明 |
|---|---|---|---|
| 题库内置真题音频 | `/audio/<cet4\|6-yyyy_mm_n>.mp3` | 六级 2021_06 1/2、2021_12 1/2、2023_12_2 及其 variant（10 处） | **扩展名是 .mp3，其实是 M4A/AAC 容器**（`ftypM4A`），Chromium 嗅探内容照样播，别改名。听力训练页用的是同一份，零拷贝直接引用 |
| examcrafts 分段拼接 | `/audio/papers/<id>.mp3` | 61 套（原有） | `scripts/download-ec-audio.mjs` 下 `-A/-B/-C` → `scripts/merge-paper-audio.mjs` 字节拼接。**是「无答题停顿」的压缩版**：cet4-2026_06_1 全长 18.3min，懒笔记同卷 23.8min（题库版与懒笔记等长，28.1 vs 28.2min） |
| 懒笔记 HLS 抽 AAC | `/audio/papers/<id>.aac` | 2026_06 第1/2套 × 四级/六级（4 处，2026-09-15 新增） | ec 与题库都没有这几套。站点只给 m3u8，本机没 ffmpeg，于是纯 JS 抽流 |

**懒笔记抽流**（`scripts/lz-audio.mjs`）：听力页里 `listening.lazynote.cn/<lv>/<n>/index.m3u8` → 下载 TS 分段（缓存 `.qa/lazynote/audio/<n>/`）→ 这些 TS 是**纯音频单节目流**（PAT 里 `0x1000`=PMT、`0x100`=AAC ES）→ 按 PID 取 PES 负载、跳 PES 头 → 拼成 ADTS 流（顺带按帧长校验/重同步，返回帧数算时长）→ 写 `<id>.aac`。实测 44100Hz 立体声，23–27 分钟，Electron `canPlayType('audio/aac')='probably'`、`Audio` 加载 `readyState=1`。

- **落盘前必须校来源**：`coverage()`（整卷听力正文的 **5-gram 覆盖率**）——同卷 84–88%，异卷 0%，阈值 60%。别用 Dice（页面满是中文导航会被稀释到 26%，会误杀）。
- 一次性回填脚本 `scripts/fill-paper-audio.mjs`（dry-run / `--apply` / `--skip-fetch`）：按 `TARGETS` 表逐 section 写 `audioUrl`，**键序与 build-papers.mjs 一致（audioUrl 插在 `sourceSet` 之前）**，写盘前备份 `.qa/lazynote/papers.ts.bak-audio-<ts>`，末尾自带「引用文件是否都存在」自检。
- 体检：`scripts/audit-paper-audio.mjs`（每个听力 section 是否都有 audioUrl + 文件是否真实存在/过小）；同卷核对：`scripts/check-bank-audio-match.mjs`（题库 vs 整卷按**选项原文** Dice，实测 100% 才敢复用）。
- **`papers.ts` / `builtin-banks.ts` 可脚本化改写**：`JSON.stringify(JSON.parse(body), null, 2)` 与文件正文**逐字节相同**（已验证），所以补字段别手改，写脚本重序列化即可。
- 打包：新音频在 `public/audio/papers/` 下，dev 直接生效；**打包版要重跑 `npm run dist` 才会带进去**。
