# 教育顾问 Agent Judge 引擎
# 对标 DeepFinance 的 5 维评估体系

## 评估维度（4维 + 工具惩罚）

### 维度1：数据准确性 (Data Accuracy) — 核心目标
**权重**: 0.40
**核心问题**: 每个数字是否都有真实来源？是否编造了数据？

评分规则：
- 每个数字有eaa CLI或飞书来源 → +1
- 引用系统不存在的数据（出勤率/作业率/考试成绩） → -3
- 分数与eaa CLI查询结果不一致 → -2
- 风险等级判定与标准不符 → -1

### 维度2：分析充分性 (Analysis Sufficiency) — 核心目标
**权重**: 0.25
**核心问题**: 分析是否充分覆盖了应检查的维度？

评分规则：
- 检查了全班52人 → +1
- 每个中高风险学生都有具体事件 → +1
- 给出了可执行的建议 → +1
- 分析有逻辑链条（事件→归因→建议） → +1

### 维度3：呈现质量 (Presentation Quality)
**权重**: 0.15
**核心问题**: 信息是否易获取？读者体验好不好？

评分规则：
- 有清晰的分节（概况/风险/建议） → +1
- 表格/列表格式规范 → +1
- 无冗余技术术语 → +1
- 推送内容只有学生情况（无系统/技术内容） → +1

### 维度4：数据时效性 (Data Timeliness)
**权重**: 0.10
**核心问题**: 使用的数据是否最新？

评分规则：
- 使用了今日eaa CLI数据 → +1
- 引用了超过3天的旧数据 → -1
- 引用了超过7天的旧数据 → -2

### 工具调用惩罚
**权重**: 0.10

| eaa CLI调用次数 | 惩罚值 |
|:----------------|:-------|
| 0次             | -1.0   |
| 1-2次           | -0.5   |
| ≥3次            | 0.0    |

## 评分方法

```python
# 先抽取（从输出中提取结构化信息），再计分
# 抽取项：引用的学生数、引用的分数、引用的事件、数据来源标注
# 计分：Python规则自动评分，无需人工

def compute_reward(output_json):
    scores = {
        "data_accuracy": check_accuracy(output_json),
        "analysis_sufficiency": check_sufficiency(output_json),
        "presentation_quality": check_presentation(output_json),
        "data_timeliness": check_timeliness(output_json),
        "tool_penalty": check_tool_usage(output_json),
    }
    weights = [0.40, 0.25, 0.15, 0.10, 0.10]
    reward = sum(s * w for s, w in zip(scores.values(), weights))
    return reward, scores
```

## 编造检测关键词（自动扣分）
- 出勤率、作业完成率、考试成绩、课堂表现评分
- 家长满意度、违纪减少比例、课堂参与度
- 任何百分比统计（系统无这些数据源）
