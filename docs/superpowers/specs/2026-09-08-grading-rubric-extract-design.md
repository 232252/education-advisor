# R175 — 量规「从样卷识别」：视觉模型抽取题目结构 设计文档

**日期**：2026-09-08
**状态**：已批准（计划经 /plan 审批通过后落地）
**目标**：`RubricEditor` 增加「从样卷识别」入口——教师选 1~8 张样卷/答案页照片，主进程一次视觉模型调用，抽取出题名/满分/参考答案草稿预填编辑器，教师从「录入者」变「校对者」。

---

## 0. 调研结论摘要（为什么做这个）

**用户痛点**：新建批改任务时量规（题目+满分+参考答案）纯手工录入，是最重的一步。

**业界对照**：

| 产品 | 做法 |
|---|---|
| Gradescope | 上传试卷模板 → 自动生成 outline，教师在线调分值 |
| 国内拍照批改类（作业帮/学而思等） | 拍照 → OCR 拆题 → 自动切题 |
| 本项目（改造前） | 全手动逐题录入 |

**调研过的四个方案**（A→D 为建议落地顺序，本轮只做 A）：

- **A. 视觉模型从样卷照片抽量规**（本轮）——教师手里一定有纸质样卷，拍照比找电子版更自然，对标 Gradescope/国内产品的关键一步。顺手让 AI 按题生成参考答案草稿（照录答案页或 AI 自答）。
- B. 粘贴试卷文本生成量规（无视觉模型时的降级路径，后续轮）。
- C. 题库/量规模板库复用（跨任务沉淀，后续轮）。
- D. 从历史考试反解量规（依赖学业侧数据联通，后续轮）。

---

## 1. 核心设计决策

1. **无状态抽取，不落任务存储**：样卷图片只读不拷贝（`grading/files/<taskId>/` 是答卷目录，不混入样卷）；调用不需要 taskId——新建弹窗里任务尚不存在也能用。renderer 经 `pickFiles`（复用 `lib/dialog.ts`）取路径，新 IPC `grading:extract-rubric` 传路径数组，返回题目草稿后即弃。
2. **单次调用、无流式、无进度事件、无 abort UI**：非批量作业，按钮文案切换（域内惯例：布尔 state + 文案切换，无 spinner）。
3. **模型沿用批改配置**：`resolveGradingModelIds`（settings.grading → 高质量 → 默认）+ `isVisionModel` 强校验 + `apiKeyFor`——前两者已从 `grading-pipeline.ts` 导出，`apiKeyFor` 目前私有，改为 export 复用。非视觉模型/无 key 的报错文案与 `startGrading` 同风格。
4. **maxTokens**：`EXTRACT_MAX_TOKENS = 8192`（题目+参考答案草稿输出比单份批改长，4096 可能截断），实际取 `Math.min(8192, model.maxTokens || 8192)`——仓库无 8192 先例，须按模型上限钳制（compaction-helper 已有 `model.maxTokens` 用法先例）。
5. **prompt 规则**（中文 system，同批改风格，纯函数 `buildRubricExtractPrompt()`）：
   - 角色「试卷结构识别助手」，只输出 JSON；从图片提取题目结构，**不抄录学生作答**；
   - 粒度：按卷面**最高层级题号**（一、二、三…或 1、2、3…）作一条量规题——「一、选择题（每小题 5 分，共 10 小题）」为一条，小题明细并入题名/参考答案；跨页题目合并；教师可再手动拆分；
   - `fullMark`：卷面标注优先，「每小题 x 分 × n 题」自行算总，无标注时合理估计；解析层钳制到 (0, 1000]，非法/缺失默认 10（同「添加题目」默认）；
   - `referenceAnswer`：图中含参考答案页/评分标准则**照录**；否则**自行给出答题要点草稿**，尾部加「（AI 草稿，请核对后删此标注）」作为教师确认钩子（照录的不加）——零类型改动即区分可信度，忘删对批改 prompt 影响可忽略；
   - 严格 JSON：`{"questions":[{"title":"…","fullMark":50,"referenceAnswer":"…"}]}`。
6. **解析防御照抄 `parseGradeResponse` 分层**（纯函数 `parseRubricExtractResponse()`）：剥代码围栏 → 截首尾大括号 → `JSON.parse` → `parseJsonWithRepair` 兜底；title trim 空/非字符串丢弃、按 title 去重（保留首个，防模型重复输出）、fullMark 非有限数→10、越界钳制；questions 缺失或全无效 → 抛「未识别出题目」。
7. **服务端文件校验**：扩展名白名单 `.jpg/.jpeg/.png/.webp/.bmp`（同 `ALLOWED_IMAGE_EXTS`）、单张 ≤25MB（同 `MAX_FILE_BYTES`，常量在 grading-service 私有——在 rubric-extract 内定义同值常量并注释对齐，不跨文件导出私有常量）、张数 1~8（`MAX_EXTRACT_IMAGES = 8`，防 token 爆炸）、`stat.isFile()` 校验。

---

## 2. 文件改动清单

**新增（2）**

- `src/main/services/grading/rubric-extract.ts`：常量（EXTRACT_MAX_TOKENS/MAX_EXTRACT_IMAGES/白名单/大小上限）+ 纯函数 `buildRubricExtractPrompt`、`parseRubricExtractResponse`（导出供测试）+ 编排 `extractRubricFromImages(paths: string[]): Promise<ExtractedRubricQuestion[]>`（校验→读图 base64→completeSimple→解析）。文件头注释说明与批改管线的关系。
- `tests/main/rubric-extract.test.ts`：照 `grading-pipeline.test.ts` 风格——vi.hoisted mock electron `app.getPath` + mock settings/keystore/grading-service 依赖；只测纯函数（不测编排 IO，与先例一致）；中文 it 描述。

**修改（8）**

- `src/shared/ipc-channels.ts`：+`IPC_GRADING_EXTRACT_RUBRIC = 'grading:extract-rubric'`（带注释：样卷识别→量规草稿，无状态不落盘）。
- `src/shared/api/grading.ts`：+导出类型 `ExtractedRubricQuestion { title: string; fullMark: number; referenceAnswer?: string }`（IPC 契约层类型，不进 types/grading.ts 任务模型——非持久化实体）+ `GradingAPI` 加 `extractRubric(paths: string[]): Promise<GradingResult<ExtractedRubricQuestion[]>>`（标 `[w]`，注释说明走视觉模型）。
- `src/main/preload/api/grading.ts`：+一行 invoke 实现。
- `src/main/ipc/grading-handlers.ts`：+handler——轻校验（数组、每项非空字符串、长度 1~8），深校验（扩展名/大小/存在）在 service，符合现有分层注释。
- `src/main/services/grading/grading-pipeline.ts`：仅把 `apiKeyFor` 改为 export（供 rubric-extract 复用），无行为变化。
- `src/renderer/pages/Grading/components/RubricEditor.tsx`：核心 UI——
  - 操作行加「从样卷识别」按钮（与「+ 添加题目」并排，secondary 样式，`title` 提示可含答案页）；
  - 状态机 `idle → picking → extracting → (done|error)`：extracting 时按钮换文案「识别中…」并 disabled；成功即组装 `RubricQuestion[]`（id 沿 `nextQuestionId` 规则、order 顺排、referenceAnswer trim）整体替换 value；
  - **覆盖确认用域内两段式内联惯例**（同 TaskDetail.confirmDelete，不引 useConfirmAction）：已有题目时首次点击显示内联确认条「识别结果将覆盖现有 {n} 道题」+ [继续][取消]；
  - 失败错误内联显示在按钮下方（红色小字），不走页面顶部反馈条——弹窗 overlay 会盖住页面级错误条，内联更可靠；
  - 只读态不出现入口（RubricEditor 本就只在可编辑态渲染）；本地复制 IMAGE_FILTERS 常量（域内 PapersTable 同款，注释对齐）。
- `src/renderer/i18n/zh.json` + `en.json`（同步，~6 新键 + 2 处改文案）：
  - 新：`rubric.fromPaper`「从样卷识别」、`rubric.extracting`「识别中…」、`rubric.extractFailed`「识别失败」、`rubric.extractConfirm`「识别结果将覆盖现有 {n} 道题」、`rubric.extractGo`「继续」、`rubric.fromPaperTitle`「选择样卷照片（可多选，含答案页更佳）」；
  - 改：`page.grading.emptyDesc` →「新建任务后，拍一张样卷即可自动生成题目与评分标准，再上传班级试卷开始 AI 批改」；`rubric.empty` →「还没有题目，可从样卷识别或手动添加」；
  - 死键守卫：所有新键在 RubricEditor 中以字面量使用；`tr()` 花括号插值 `{n}`。
- `docs/features/GRADING.md`：使用流程节插入「从样卷识别量规」小节 + 常见问题补一条（识别粒度按大题、AI 答案草稿须核对）。

**联动检查**

- `tests/renderer/helpers/window-api.ts`：window.api 测试 mock——若 grading 域是显式方法列表需补 `extractRubric`（实现时核对）。

---

## 3. 测试计划（tests/main/rubric-extract.test.ts）

- `buildRubricExtractPrompt`：含 JSON 契约、最高层级题号规则、答案照录/自答规则、不抄作答规则；
- `parseRubricExtractResponse`：标准 JSON；围栏+前后噪声；散文包裹（截大括号）；fullMark 非法→默认 10、越界钳制 (0,1000]；title 空/非字符串丢弃；同 title 去重保留首个；缺 questions/全无效→抛错；referenceAnswer 非字符串→undefined。
- 既有门禁自动覆盖：`ipc-channels.test.ts`（通道唯一性）、`i18n-completeness.test.ts`（zh/en 同步+死键）、`doc:check`（services 计数+1 → 必须先跑 `npm run doc:stats` 重写 ARCHITECTURE.md 统计块）、`ipc:contract`（通道契约）。

---

## 4. 验证门禁与提交

门禁全跑（CI 串行，早步失败会掩盖后步，本地须全绿）：`npm run typecheck` → `lint` → `test` → `build` → `doc:stats` 后 `doc:check` → `ipc:contract`。

提交两笔：
1. `docs: R175 设计文档 — 量规从样卷识别`（本文档）
2. `feat(grading): R175 — 量规「从样卷识别」:视觉模型抽题目结构`

**精确 add 本次文件**（工作区有并行会话未提交修改：agents.user.yaml、Markdown.tsx、useDashboardActions.ts 等，一律不碰不提交）。

---

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| 视觉模型漏题/分值错 | 教师校对为流程一环；量规满分合计实时展示辅助核对；草稿可改可删 |
| AI 自答参考答案出错 | 尾注「AI 草稿」确认钩子强制教师过目；UI 提示语说明草稿性质 |
| 8 图 token 压力/输出截断 | 张数上限 8 + maxTokens 钳制模型上限 + 三层 JSON 解析兜底 |
| 模型不支持视觉/key 失效 | 复用批改同款明确报错，内联显示，可改配置后重试 |
| 大小题粒度不合预期 | prompt 按最高层级题号 + 文档写明，教师可手动拆分再保存 |
| 弹窗内错误不可见 | 错误内联在 RubricEditor，不依赖页面顶部条 |

---

## 6. 明确不做（本轮）

- 不做 PDF 直接解析（引依赖重，后续单独轮）；
- 不做粘贴文本生成量规（方案 B，后续轮）；
- 不做识别过程 abort UI（单次调用时长可控）；
- 不做 answerSource 持久化字段（尾注钩子替代）；
- 不动 presetMarks；
- 不做模板库/考试反解（方案 C/D）。
