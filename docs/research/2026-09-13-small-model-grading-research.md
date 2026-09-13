# 调研报告：小模型 / 低配设备改卷可行性与提准路线

> 日期：2026-09-13 ｜ 性质：**只调研，不实施**（本轮约束之一即"不动代码"，本文档为纯调研产出）
> 背景：当前批改走云端视觉大模型（整卷照片一次调用）。用户想探索：① 4B~9B 级小模型能否"真正改卷"；② 约束为**不动代码 / 结合项目 / 低配设备可用**；③ 不要求小模型全改——混合提准亦可；④ 是否存在模型以外的技术。
> **2026-09-13 二轮追加（同日）**：用户澄清目标硬件——家里电脑无独显、CPU 弱；学校电脑为 i3 三~六代或兆芯（国产 x86，性能弱且偶发死机）。**本地小模型路线（第四节 P1）作废**；成本不敏感（"大模型也就几块钱"），主线改为**云端大模型照用 + 叠加保底机制提准确率下限**，见第七节。
> 术语澄清：文中"小模型"= 参数量 4B~9B、可在消费级设备本地运行的模型（文本或视觉）；"QWK"= Quadratic Weighted Kappa，作文自动评分领域的标准一致性指标（与人工评分越接近越高，1.0 为满分）；"VL 模型"= 视觉语言模型（能直接看图）。
> 外部调研来源标注：**[官方]** / **[社区]** / **[论文]**；检索时间 2026-09-13。

---

## 0. 速览结论

1. **本项目的"改卷"是视觉任务，不是文本任务**——整卷照片 base64 直接喂视觉模型，无 OCR（`src/main/services/grading/grading-pipeline.ts:291-330`）。所以"小模型改卷"在本项目语境下 = **小 VL 模型**（Qwen3-VL 4B/8B、MiniCPM-V 4.5 8B、GLM-4.1V-9B 这类），纯文本 4B~9B 只有在前面加 OCR 转写层后才能参与。
2. **小模型本地批改的"唯一硬堵点"只有一行代码**：`buildOllamaModel` 把所有 Ollama 模型硬编码 `input: ['text']`（`src/main/services/pi-ai/model-utils.ts:29-42`），导致本地模型永远过不了批改的 `isVisionModel` 校验、也不出现在批改模型下拉（`GradingModelConfig.tsx:52-54`）。Ollama 的 serve/下载/推荐模型基础设施**全部现成**（`src/main/services/ollama/`）。
3. **小模型"能改到什么水平"有文献锚点，但口径要认清**：英文文本作文评分（ASAP 基准）上 7B+LoRA 微调 ≈ QWK 0.77，接近 BERT 类传统方案 **[社区]**；中文 K12 手写整卷视觉批改无公开学术基准，商业方案（七天网络）自报主观题准确率 96% **[官方]**。**直接拿来全改主观题不现实；配"复核兜底 + 级联升级"则务实可用。**
4. **客观题现在也在花大模型的钱**：选择题 referenceAnswer（如 `1-5 BACDA`，`tests/main/grading-pipeline.test.ts:41-44`）完全可以"模型只转写、规则来判分"——这是**零模型判分**的非模型技术，客观题准确率可到 ~100%（仅剩读错字风险）。
5. **教师复核数据是现成的蒸馏金矿**：任务 JSON 里同时存了 AI 分与教师修正分（`<appData>/grading/tasks/<taskId>.json`，`src/shared/types/grading.ts:13-144`），天然构成 (卷面图, 量规, 金标分) 训练三元组——将来 QLoRA 蒸馏本地小批改模型的数据来源已经在了。
6. **低配设备现实**：8B 级 VL 模型 Q4 量化 ≈ 5-6GB 权重 + 视觉开销，8GB 显存 GPU 可流畅跑；纯 CPU 16GB 内存可跑但每份卷约 1-3 分钟（过夜批处理可接受）；4B 级再降一档 **[社区]**。
7. **推荐路线（详见第四节）**：P0 零改动先用云端小 VL 模型做对照实验 → P1 一行改动解锁本地 VL → P2 客观题规则化 + 置信度级联 → P3 用复核数据蒸馏本地专用批改模型。

---

## 一、代码现状盘点（批改管线）

### 1.1 数据流与调用点

| 环节 | 位置 | 要点 |
|---|---|---|
| 输入 | `grading-service.ts:29-33` | 纸卷扫描件/照片，jpg/png/webp/bmp，≤25MB/份，≤300 份/任务；无 OCR，原图 base64 直喂 |
| 批改 | `grading-pipeline.ts:291-330` `gradePaperOnce` | **每份卷一次整卷视觉调用**，全部页图 + 全量量规拼进 system prompt，严格 JSON 输出，maxTokens 4096 |
| 抽量规 | `rubric-extract.ts:148-214` | 1~8 张样卷照 → 题目/满分/参考答案草稿，单次调用 |
| 认人 | `identify-papers.ts:114-209` | 读首页姓名/编号与花名册匹配，maxTokens 256 |
| 解析 | `grading-pipeline.ts:140-221` | 四层容错（剥围栏→截取→parse→修复），未知题丢弃、分数钳制、同题去重 |
| 存储 | `<appData>/grading/tasks/*.json` | AI 结果 + 教师复核共存；发布后经 `publish.ts` 落学业管线 |
| 兜底 | `shared/grading-helpers.ts:11-22` | 生效分 = 教师覆盖 > AI 分；**人工复核是最终正确率机制** |

### 1.2 模型与成本现状

| 机制 | 位置 | 现状 |
|---|---|---|
| 模型解析 | `grading-pipeline.ts:72-84` | settings.grading 显式配置 → highQualityModel → defaultModel；启动前 `isVisionModel` 硬校验 |
| 调用层 | vendored `@earendil-works/pi-ai` `completeSimple` | 默认云端 API（anthropic/openai/deepseek/zai/kimi 等）；**无 temperature 配置** |
| 本地推理 | `services/ollama/*`、`constants.ts:6-10` | OpenAI-compatible（127.0.0.1:11434/v1）适配层**齐全**，但推荐模型全是文本（qwen3:1.7b/4b 等） |
| **硬堵点** | `services/pi-ai/model-utils.ts:29-42` | `buildOllamaModel` 硬编码 `input: ['text']` → 本地模型 `supportsImage=false`，进不了批改 |
| 成本优化 | `grading-pipeline.ts:313-319` | 仅 prompt cache（`cacheRetention:'short'` + `sessionId: grading:<taskId>`），同任务量规复用 |
| 并发 | `grading-pipeline.ts:427-481` | 逐份串行，无并发、无批改专用重试 |
| 可参考的既有资产 | `services/agent-model-selector.ts:64-222` | agent 对话链路已有 high_quality/low_cost 双 tier 路由（含按 Ollama 参数规模选模）——批改不走它，但级联路由的选模逻辑可借用 |

### 1.3 Prompt 工程现状（对照外部提准技术的缺口）

| 外部技术 | 本项目现状 |
|---|---|
| 量规分解（rubric 拆成可勾选条目） | ✅ 部分有：量规按大题拆 + `presetMarks` 预设评分点（`grading-helpers.ts:44-57`） |
| 锚点卷 few-shot（标杆答卷进 prompt） | ❌ 无（prompt 只有输出格式样例） |
| CoT / 自洽（多次采样取一致） | ❌ 无（单次调用，仅要求 `evidence` 一句引用） |
| 按题拆分调用 | ❌ 无（整卷一把梭） |
| 置信度信号 / 级联升级 | ❌ 无（失败仅标 failed 待重试，`grading-pipeline.ts:355-361`） |
| 保守给分规则 | ✅ 有（"字迹不清保守给分并说明"，`grading-pipeline.ts:120-130`） |

---

## 二、外部调研：小模型改卷的真实水平

### 2.1 文本类批改（学术基准，供能力锚点）

- **7B 微调后 ≈ 传统深度学习基线**：Kaggle AES 2.0（ASAP 衍生数据）上，Mistral-7B-Instruct + LoRA、仅约 3000 条训练数据即达 **QWK≈0.771** **[社区]**（[讨论帖](https://www.kaggle.com/competitions/learning-agency-lab-automated-essay-scoring-2/discussion/494935)）。
- **3B~8B 开源小模型评测**：LLaMA 3.2 3B 等五个开源模型的 AES 评测（Abujadallah et al. 2025）**[论文]**（[preprints.org](https://www.preprints.org/manuscript/202511.1429)）；LLaMA 序列微调策略研究 **[论文]**（[arXiv 2606.10327](https://arxiv.org/html/2606.10327v1)）；LLM 评分 + 语言特征融合可进一步提升 **[论文]**（[arXiv 2502.09497](https://arxiv.org/html/2502.09497v1)）。
- **"简单量规反而更好"**：RAND 对照实验发现基于简单量规的批改器打平或超过复杂 LLM 流水线 **[官方]**（[RAND 报告](https://www.rand.org/pubs/research_reports/RRA4618-1.html)）——对本项目的启示：别急着上复杂多阶段管线，把量规写清楚收益可能更大。

### 2.2 视觉批改（本项目实际形态）

可本地部署的候选小 VL 模型（均支持 llama.cpp/Ollama GGUF 路线）：

| 模型 | 参数 | 本地支持 | 备注 |
|---|---|---|---|
| Qwen3-VL | 2B / 4B / 8B | Ollama 官方库（`ollama.com/library/qwen3-vl`，需 0.3.10+，mmproj 视觉文件）**[官方]** | 教育阅卷是官方点名场景；CPU 也能跑 2B/4B 量化版 **[社区]** |
| MiniCPM-V 4.5 | 8B（Qwen3-8B 底座） | Ollama `openbmb/minicpm-v4.5` + 官方 GGUF/int4 **[官方]** | 显存效率与 prompt 处理速度口碑好（比同级 InternVL 快 3-4 倍）**[社区]** |
| GLM-4.1V-9B-Thinking | 9B | llama.cpp 已支持（GGUF 转换）**[社区]** | 10B 级里 28 项基准 23 项最优、18 项打平 Qwen2.5-VL-72B **[官方]**（[zai-org/GLM-V](https://github.com/zai-org/GLM-V)） |

### 2.3 低配设备现实（Q4 量化口径）

| 档位 | 配置 | 能跑什么 | 体感 |
|---|---|---|---|
| 入门 | 16GB 内存、纯 CPU | 4B VL（Q4）或 2B | 每份卷约 1-3 分钟；过夜批 50 份可行 |
| 主流 | 8GB 显存 GPU（如 3060/4060） | 8B VL（Q4，权重约 5-6GB + 视觉开销） | 每份卷约 10-30 秒 |
| 宽裕 | 12GB+ 显存 | 9B VL（Q4）+ 更长上下文 | 接近在线体验 |

数据来源：7-8B Q4 权重约 4.4-4.7GB、总需求 6-8GB；CPU 推理 3-10 tok/s 依赖内存带宽 **[社区]**（[LocalLLM.in](https://localllm.in/blog/ollama-vram-requirements-for-local-llms)、[r/LocalLLaMA CPU 基准](https://www.reddit.com/r/LocalLLaMA/comments/1p90zzi/cpuonly_llm_performance_ts_with_llamacpp/)、[llama.cpp 硬件讨论](https://github.com/ggml-org/llama.cpp/discussions/3847)）。注意：**多页整卷 = 大量视觉 token，上下文长度是隐藏门槛**，8GB 档建议限制单次页数或降分辨率。

### 2.4 国内生态参照（证明"小/本地模型改卷"是正在发生的行业方向）

- 阿里 **Qwen3-Learning**：基于 Qwen3、万亿级教育数据训练的学习场景专用模型，主打拍题答疑 + 作业批改 **[官方]**（[36氪报道](https://m.36kr.com/p/3579205293079430)）——印证"教育垂直微调小模型"路线。
- **七天网络**全科智批改：自报主观题/作文批阅准确率 96%、单题响应 0.3 秒 **[官方]**（[7net.cc](https://www.7net.cc/build/home/news/index.html)；自报口径，谨慎采信）。
- **阿里云 AI 阅卷**、希沃、希冀等整套方案均为"云端大模型 + 客观题规则判分"的混合架构 **[官方]**（[阿里云](https://www.aliyun.com/benefit/scene/aiyuejuan)）——与本文 P2 推荐同构。

---

## 三、"模型以外"的技术与提准技术清单

### 3.1 非模型技术（判分本身不靠 LLM）

| 技术 | 原理 | 与本项目的适配度 |
|---|---|---|
| **客观题规则判分** | 模型只负责"转写"学生答案（读图→文本），与 `referenceAnswer` 做字符串/归一化比对 | ★★★★★ 选择/填空题判分零模型、近 100% 准；转写比判分容易得多，小模型也能干好 |
| **OCR 前置** | PaddleOCR 3.0（PP-OCRv5）手写识别准确率较上代 +13%，官方有试卷批改方案 **[官方]**（[发布报道](https://news.sina.cn/ai/2025-05-29/detail-ineyfcye9740597.html)、[教育方案](https://blog.csdn.net/gitblog_00567/article/details/151003397)） | ★★★☆☆ 把"视觉批改"变成"文本批改"后，4B 文本模型即可参与、硬件门槛大降；代价是新增管线环节 + 版面/公式还原误差 |
| **嵌入检索相似卷** | 学生答案向量化 → kNN 检索历史已批答案 → 参考其分数 | ★★★☆☆ 学术线从 Mohler 2011 图对齐相似度到 BERT+Siamese（[Mohler ACL 2011](https://aclanthology.org/P11-1076.pdf)、[HyperGAT-BERT-RAS](https://www.preprints.org/manuscript/202604.1659)）一脉相承；适合做"辅助参考分/分歧检测"，不必单独承担判分 |
| **量规模板库** | 同类卷复用量规（R175 路线 B/C，`docs/superpowers/specs/2026-09-08-grading-rubric-extract-design.md`） | ★★★★☆ 省的是"抽量规"那次大模型调用与教师校对时间 |
| **缓存复用** | 同任务 prompt cache 已有；跨任务同类题缓存未做 | ★★★☆☆ 重复作业场景（同一张卷多次布置）收益明显 |

### 3.2 提准技术（prompt / 采样层，不动管线骨架）

| 技术 | 证据 | 落点 |
|---|---|---|
| **锚点卷 few-shot** | 在 prompt 里放不同分档的标杆答卷，"显著提升与人工评分一致性"，代价是 token 增加 **[社区]**（[Rubric-Based Evals](https://medium.com/@adnanmasood/rubric-based-evals-llm-as-a-judge-methodologies-and-empirical-validation-in-domain-context-71936b989e80)、[EDM 2024](https://educationaldatamining.org/edm2024/proceedings/2024.EDM-posters.75/index.html)） | `buildGradingPrompt`（`grading-pipeline.ts:99-132`）；标杆卷可从教师复核过的历史卷里挑 |
| **量规写清楚 > 流水线复杂化** | RAND "Simpler is Better" **[官方]** | 已有 presetMarks 机制是对的，继续把评分点写细 |
| **CoT + 自洽采样** | 先推理后打分、多次采样取一致 **[论文]**（[PRPER 2025](https://link.aps.org/doi/10.1103/PhysRevPhysEducRes.21.010126)） | 成本 ×N，适合只对主观题开、或作为级联里的"仲裁二审" |
| **级联路由（小模型先判 + 不确定升级）** | cheap-first、按置信度升级大模型是成熟模式，难点在置信度校准 **[论文/社区]**（[arXiv 2603.04445](https://arxiv.org/html/2603.04445v2)、[cascade routing 综述博客](https://tianpan.co/blog/2025/11/03/llm-routing-model-cascades)） | 本项目可用的置信信号：解析失败/缺题、自报"字迹不清"、分数贴临界、双评分歧 |

### 3.3 蒸馏（长线，把大模型能力"压"进小模型）

标准玩法（Distilling Step-by-Step，Google Research **[论文]**，[arXiv 2305.02301](https://arxiv.org/abs/2305.02301)）：大模型当老师产出"分数 + 评分理由" → 用理由作额外监督微调小模型 → 小模型以更少数据追平甚至超过老师。对本项目：**云端大模型批改 + 教师复核修正 = 天然教师信号**，攒够几百份复核卷即可 QLoRA 微调 Qwen3-VL-4B/8B，得到"本校本学科专用"批改小模型。综述参考：[KD 综述 arXiv 2402.13116](https://arxiv.org/html/2402.13116v3)、[LLM-as-a-Judge 综述](https://arxiv.org/html/2411.15594v6)。

---

## 四、结合项目的推荐路线

> 遵守本轮约束：P0 完全不动代码；P1 起列出改动量供后续拍板。

| 阶段 | 做什么 | 改动量 | 预期收益 / 验证方式 |
|---|---|---|---|
| **P0 对照实验**（现在就能做） | 设置→模型→批改模型里，把当前大模型换成**云端小 VL 模型**（builtinProviders 里已有的便宜档，如 zai/openai/deepseek 的 flash/mini 档 VL），拿一次真实作业双跑对照，在复核台人工比对差异率 | **零改动**（现有下拉即支持） | 直接回答"小模型到底差多少"——用本校卷子说话，比任何论文都准 |
| **P1 解锁本地 VL** | `buildOllamaModel` 对已知 VL 模型放开 `input:['text','image']`；推荐列表加 `qwen3-vl:8b` / `minicpm-v4.5` | ≈ 1-2 处小改（`model-utils.ts:29-42` + `recommended-models.ts`） | 8GB 显存/16GB 内存机器即可离线批改；隐私敏感场景（学生卷面不出校）价值大 |
| **P2a 客观题规则化** | VL 只转写答案文本，选择/填空由规则比对 `referenceAnswer` 判分；模型预算集中给主观题 | 中（管线加一层，需题型标记） | 客观题判分近 100% 准 + 成本大降；与行业方案（阿里云阅卷等）同构 |
| **P2b 级联 + 提准** | 本地/小模型先批 → 置信信号触发云端大模型复审；prompt 加锚点卷 few-shot | 中 | 小模型处理大多数"正常卷"，大模型只看疑难卷；锚点卷是文献里性价比最高的单项提准 |
| **P3 蒸馏专用小模型** | 攒教师复核数据 → QLoRA 微调 Qwen3-VL-4B/8B → 本地专用批改头 | 大（训练管线 + 评测集） | 终局形态：日常作业本地小模型全自动，准确率对齐"大模型+教师抽检" |

**验证基础设施（P0-P3 共用，建议尽早小规模搭）**：把若干个已复核任务整理成回归集（输入 = 卷面图 + 量规，金标 = 教师生效分），任何模型/改动都先跑回归集看逐题差异率。数据都在任务 JSON 里，只差一个对比脚本。

---

## 五、风险与局限

1. **小 VL 模型读手写的可靠性是最大不确定项**：文献基准（ASAP 等）全是打字文本；中文手写整卷 + 多页版面没有公开基准。P0 对照实验必须先做，且分"读错"（转写错）与"判错"（读对了判歪）两类统计——读错多则先上 OCR/换更强视觉前端，判错多则量规/锚点卷/级联有效。
2. **多页整卷的视觉 token 上下文**：低配设备上 8B 模型 + 多页高分辨率图可能爆上下文或骤降速度，需限制页数/分辨率（P1 实测项）。
3. **96% 之类行业数字是自报口径**，且其方案多为"客观题规则 + 主观题云端大模型 + 人工抽检"的混合体，不等于"小模型全改 96%"。
4. **级联的置信度校准难**（外部调研共识）：本项目宜用"可观测信号"（解析失败、缺题、双评分歧、自报不确定）这类廉价信号起步，不必先上概率校准。
5. **蒸馏的数据合规**：学生卷面属敏感数据，训练/微调只能用本地脱敏副本，不可上传第三方训练服务。

## 六、开放问题

1. P0 对照实验选哪个云端小 VL 模型做首测？（取决于 builtinProviders 现有目录与计费）
2. 客观题/主观题的题型标记放在量规哪一层（沿用 title 约定 vs 加显式字段）？——P2a 前需拍板。
3. 低配设备的下限目标定在哪：8GB 显存 GPU，还是必须兼容纯 CPU 16GB 内存？（决定 P1 推荐模型档位：8B vs 4B）
4. 蒸馏路线（P3）是否值得投入，取决于 P0/P2 阶段小模型与"大模型+复核"的差异率实测。

---

## 七、二轮追加：云端大模型批改的"保底"机制（09-13 同日，取代第四节本地路线）

### 7.0 前提修正

- **硬件事实否决本地推理**：无独显、弱 CPU（学校侧 i3 三~六代 / 兆芯）。第二节 P1（本地 VL）与 P3 的本地训练部分均不可行；**客观题规则判分（P2a）不受影响**——它是纯代码逻辑，零算力，任何机器都能跑。
- **成本不再是主要矛盾**：用户口径"大模型也就几块钱"，指整班一次批改的量级。因此保底机制可以放心用"多花 2~3 倍调用换可靠性"的思路。
- **目标重定义**：不是让便宜模型顶上，而是让**现在这个大模型的每一次给分更稳、翻车可被发现、且越用越准**。

### 7.1 外部证据：LLM 单次评分"不稳"是实证结论，多趟聚合是标准解法

| 证据 | 结论 | 来源 |
|---|---|---|
| **Rating Roulette（EMNLP 2025 Findings）** | LLM 裁判对同一输入多次打分结果漂移；**单次评测可能产生误导性结果**，小差异可能只是裁判方差 | **[论文]** [ACL](https://aclanthology.org/2025.findings-emnlp.1361.pdf) |
| 多采样 + 中位数/多数聚合 | 显著降方差提可靠性，工业界已有批量落地（T-Labs 生产实践） | **[社区]** [TR Labs](https://medium.com/tr-labs-ml-engineering-blog/batched-self-consistency-improves-llm-relevance-assessment-and-ranking-54713295f58f)、[Microsoft](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/evaluating-ai-agents-techniques-to-reduce-variance-and-boost-alignment-for-llm-j/4498571) |
| **裁判必须跨模型家族** | 同一家族（如全 GPT 系）互评的高一致是"家族内部一致性"假象，不等于判得准；异构集成才真正对冲偏差 | **[社区]** [tianpan.co](https://tianpan.co/blog/2026-06-03-the-llm-judge-ensemble-that-agreed-because-all-judges-were-the-same-family)、[orq.ai](https://orq.ai/blog/llm-juries-in-practice)、[arXiv 2510.11822](https://arxiv.org/html/2510.11822v1) |
| 分歧是信号不是噪声 | 双评分歧大的条目正是需要人工/仲裁介入的条目——可直接驱动复核优先级 | **[社区]** [Arize](https://arize.com/blog/measuring-human-llm-judge-alignment/) |

### 7.2 行业模板：高考网上阅卷的"双评 + 三评 + 仲裁"就是现成的保底设计

- **背靠背双评**：每题随机分发两位评卷员独立打分（互不知情）——教育部、多省现行制度 **[官方]**（[教育部](http://www.moe.gov.cn/jyb_xwfb/s5147/201206/t20120615_137820.html)、[新华网](https://www.news.cn/politics/2022-06/14/c_1128741496.htm)）。
- **分差阈值**：阈值内取平均分；超阈值自动三评；仍分歧交学科专家仲裁（终评）**[官方]**（[新华网 2026 评卷点](https://www.news.cn/politics/20260622/e0991b4b68cd4bbb8f3df09ba11c8d1c/c.html)）。北京理科阅卷阈值 ≈ **题目分值的 1/6**（[新京报](https://m.bjnews.com.cn/detail/155143991414237.html)）。
- **试评统一尺度**：正式评卷前抽卷试评、统一标准后清空重评（[中国科技网](https://www.stdaily.com/web/gdxw/2025-06/17/content_355692.html)）——对应 LLM 的"锚点卷校准"。
- **浙江已探索 AI 辅助质检**：保持人工"双评+仲裁"不变，AI 引擎做质检（[浙江省教育考试院](https://www.zjzs.net/attach/0/a3640bfb228848ad8822cda219ebe945.pdf)）——与本节方向互为镜像：他们是"人为主 + AI 查"，我们是"AI 为主 + 人仲裁"。

### 7.3 保底阶梯 L0→L4（全部只动调用层与数据层，不依赖任何本地算力）

> 落点都在 `grading-pipeline.ts` 的 `gradePaperOnce` / `resolveGradingModelIds` 一层，与第一节"最自然挂点"结论一致。

| 层级 | 机制 | 做法 | 成本 | 防什么 |
|---|---|---|---|---|
| **L0（现状）** | 单评 + 全量人工复核 | — | 1× | 已有兜底，但翻车要靠老师逐份看 |
| **L1 校验趟** | 第二趟不重批、只核对 | 给模型"量规 + 学生证据 + AI 已给分"，逐项问：有无漏题？分值是否越界？证据是否支撑？输出 accept/adjust | ~1.3× | 漏题、算术级错误、明显越界 |
| **L2 双评+仲裁（高考模式）** | 两个不同家族模型各评一次 | 逐题分差 ≤ 阈值（建议**满分 1/6**，20 分题 ±3）→ 取均值；超阈值 → 第三评取中位；仍分歧 → **标记高优复核顶到复核台最前**（教师=专家仲裁） | 2~3× | 单模型系统性偏松/偏严、随机漂移 |
| **L3 锚点试评（校准）** | 开批前先评 3~5 份标杆卷 | 从上次任务教师复核过的卷子里挑好/中/差，确认模型分与教师分对齐后，把"卷面图 + 教师分 + 一句理由"作为 few-shot 锚点注入整班 prompt | ≈0（多 3~5 次调用） | 尺度漂移；文献里性价比最高的单项提准（第一节 3.2 已引） |
| **L4 离线校准（越用越准）** | 发布后统计逐题偏差 | 每任务发布后算"AI 分 vs 教师生效分"逐题均值差；发现系统性偏差（如某题常年 +2）→ 下次同题量规注入校准指令或后处理修正 | 0 边际 | 长期、可统计的模型倾向 |
| **横切：客观题规则判分** | 模型转写 + 规则比对 | 选择/填空只让模型读答案文本，与 `referenceAnswer` 规则比对判分；省下的预算全给主观题开 L2 | 净省 | 客观题判分错误直接清零（只剩读错风险） |
| **横切：复核优先级排序** | 双评分差大的卷排最前 | 复核台按"分歧度"排序，老师时间花在刀刃上 | 0 | 老师复核漏看疑难卷 |

**实施顺序建议**：L2 + 横切两项是保底的核心（一次改动，翻车可发现）；L3/L4 是免维护的长期校准（数据已在任务 JSON 里躺着）；L1 是 L2 的廉价降级版，可作过渡。

### 7.4 对第四节路线表的修订

| 原条目 | 状态 |
|---|---|
| P0 云端小模型对照实验 | 保留但降级为可选项（成本已不敏感，意义缩小为"了解不同大模型差异"） |
| P1 解锁本地 VL | **作废**（硬件否决） |
| P2a 客观题规则化 | **保留**（零算力，不受硬件影响），并入 7.3 横切项 |
| P2b 级联+提准 | 演进为 7.3 的 L1~L4 保底阶梯（级联的"升级对象"从本地小模型改为云端更强模型/仲裁） |
| P3 蒸馏 | 长期搁置；教师复核数据照常积累（L4 校准直接受益，将来若有算力再谈微调） |

### 7.5 二轮开放问题

1. L2 的双评模型对选谁？（builtinProviders 里挑两个不同家族且都支持视觉的，如 zai + deepseek/kimi——具体待查各家的 VL 档位与价格）
2. 分差阈值按"满分 1/6 四舍五入"起步是否合适，还是按学科/题型让老师可配？
3. L3 锚点卷的选取要不要做成 UI（老师挑）还是自动选（按教师历史修正幅度挑分歧最大的几份）？

### 7.6 三轮修正（09-13 用户拍板）：不做双评，定位"完全交给 AI"

- **否决 L1/L2**：产品定位是**完全把批改交给 AI、最大限度减轻教师负担**；复核台（已上线）就是验证环节，不叠加模型层双评/校验趟。7.5 的开放问题 1、2 随之作废。
- **仍保留的零成本候选**（不增加调用次数、不增加教师工作量，将来做不做什么都不影响现状）：
  - 客观题规则判分（7.3 横切项）：省钱且把客观题判分错误清零；
  - 锚点卷校准（L3）：每任务多 3~5 次调用，可选；
  - 离线校准（L4）：纯统计，数据已在任务 JSON 里；
  - 复核台排序：把模型自报"字迹不清/漏题/未作答"的卷排最前，零额外调用。
- **诚实风险提示（记录在案）**：单评模式下唯一的保底就是"复核这一步实际发生"。若老师实际不看复核台，模型单次错误会直接进入发布成绩与学业数据。流程习惯上建议至少抽查排最前的几份；这是使用约定，不是代码问题。

