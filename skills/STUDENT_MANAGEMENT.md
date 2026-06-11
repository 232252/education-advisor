---
name: STUDENT_MANAGEMENT
description: EAA 学生管理工具完全指南 — 24 个 function-call 工具 (16 EAA + 6 file + 2 utility) 的参数、调用示例与使用场景。所有 EAA 数据操作必须通过这些工具, 禁止直接编辑 events.json / entities.json / profiles/*.json。
---

# EAA 学生管理工具完全指南

> **重要**: 你运行在 Electron 桌面应用里, **不是 shell**。所有数据操作必须通过 function-call 工具, **不是** shell 命令。
> 看到老文档里的 `eaa score 张三` 这种命令行, 实际对应的是 `eaa_score({name: "张三"})` 这种 JSON 函数调用。

---

## 一、学生查询工具 (10 个, 只读)

### 1.1 查单个学生分数/风险
```json
eaa_score({ name: "张三" })
```
返回: 当前分数、风险等级、累计事件数、最近事件日期。

### 1.2 查单个学生完整事件时间线
```json
eaa_history({ name: "张三" })
```

### 1.3 按关键词搜索事件
```json
eaa_search({ query: "讲话", limit: 20 })
```
支持双引号精确匹配: `query: '"物理课"'` 找只含"物理课"的事件。

### 1.4 列出所有学生
```json
eaa_list_students({})
```

### 1.5 操行分排行榜
```json
eaa_ranking({ n: 10 })
```

### 1.6 整体统计
```json
eaa_stats({})
```

### 1.7 列出可用原因码 (加分/扣分清单)
```json
eaa_codes({})
```
> **添加事件前必先调用此工具**! 拿到 reason_code 列表再选合适的。

### 1.8 周期摘要
```json
eaa_summary({ since: "2025-09-01", until: "2025-12-31" })
```

### 1.9 日期范围事件
```json
eaa_range({ start: "2025-12-01", end: "2025-12-15", limit: 100 })
```

---

## 二、学生档案工具 (2 个)

### 2.1 读取扩展档案 (联系方式/家庭/健康/在校/奖惩/备注)
```json
eaa_profile_get({ name: "张三" })
// 或指定字段:
eaa_profile_get({ name: "张三", fields: ["phone", "fatherName", "fatherPhone"] })
```

### 2.2 更新扩展档案字段
```json
eaa_profile_set({
  name: "张三",
  fields: {
    phone: "13800138000",
    fatherName: "张大明",
    fatherPhone: "13900139000",
    bloodType: "A",
    isBoarding: true
  }
})
```

**可写字段白名单** (30 个, 不在列表里的字段会被静默忽略):

| 字段 | 类型 | 字段 | 类型 |
|:-----|:-----|:-----|:-----|
| idCard | string | phone | string |
| gender | string ("男"/"女") | email | string |
| birthDate | string (YYYY-MM-DD) | address | string |
| politicalStatus | string | parentName | string |
| ethnicity | string | parentPhone | string |
| householdRegister | string | fatherName | string |
| currentAddress | string | fatherPhone | string |
| isBoarding | boolean | motherName | string |
| isOnlyChild | boolean | motherPhone | string |
| emergencyContactName | string | enrollmentDate | string |
| emergencyContactPhone | string | classId | string |
| emergencyContactRelation | string | comments | string |
| medicalHistory | string | classRank | number |
| economicStatus | string | gradeRank | number |
| awards | string[] (JSON 数组或换行分隔) | attendanceRate | number |
| customSubjects | string[] | | |

---

## 三、学业成绩工具 (2 个)

### 3.1 读取所有考试记录
```json
eaa_academic_get({ name: "张三" })
```

### 3.2 录入 1 场考试成绩 (9 科目 1 次搞定)
```json
eaa_academic_add({
  name: "张三",
  examType: "期中",        // 周考/月考/期中/期末/模拟考/平时测试/随堂测验
  examName: "2024-2025 高二上学期期中",
  subjects: {              // 9 科目一次写完, 缺考用 null
    "语文": 94,
    "数学": 98.5,
    "英语": 83.5,
    "物理": 76,
    "化学": 81,
    "生物": 79,
    "政治": 88,
    "历史": 92,
    "地理": 85
  },
  date: "2025-11-12",
  notes: "高二五班统一考试"
})
```

### 3.3 批量录入 (新工具, 解决 52 学生场景)
```json
eaa_bulk_add_academics({
  examType: "期中",
  examName: "高二半期考试",
  date: "2025-11-12",
  records: [
    { name: "张三", subjects: {"语文":94,"数学":98.5,...} },
    { name: "李四", subjects: {"语文":88,"数学":91,...} }
  ]
})
```

---

## 四、操行事件写入工具 (3 个, 含 bulk)

### 4.1 添加 1 条事件
```json
eaa_add_event({
  student_name: "张三",
  reason_code: "SPEAK_IN_CLASS",   // 先 eaa_codes 查
  delta: -2,                        // -10~+10
  note: "物理课讲话",
  tags: "物理,高二5班"             // 逗号分隔
})
```

### 4.2 撤销事件
```json
eaa_revert_event({ event_id: "evt_00001", reason: "误记" })
```

### 4.3 批量添加事件 (新工具)
```json
eaa_bulk_add_events({
  events: [
    { student_name: "张三", reason_code: "LATE", delta: -2, note: "周一迟到" },
    { student_name: "李四", reason_code: "LATE", delta: -2, note: "周一迟到" }
  ]
})
```

---

## 五、学生管理 (2 个, 含 bulk)

### 5.1 注册 1 名学生
```json
eaa_add_student({ name: "王五" })
```

### 5.2 批量注册 (新工具, 解决 52 学生场景)
```json
eaa_bulk_add_students({
  names: ["王五", "赵六", "孙七", "周八", ...]   // 一次最多 200 个
})
```

---

## 六、文件工具 (6 个)

```json
read_file({ path: "C:\\data\\students.csv" })
read_excel({ path: "C:\\data\\grades.xlsx", sheet: "Sheet1", maxRows: 100 })
list_dir({ path: "C:\\data" })
write_file({ path: "C:\\out\\report.md", content: "..." })
write_excel({ path: "C:\\out\\report.xlsx", sheets: [{name:"数据", headers:["姓名","分数"], rows:[["张三","94"]]}] })
write_csv({ path: "C:\\out\\report.csv", headers: ["姓名","分数"], rows: [["张三","94"]], encoding: "utf-8-sig" })
```

---

## 七、实用工具 (2 个)

```json
get_current_time({ timezone: "Asia/Shanghai" })   // 当前时间/星期/是否工作日
calculate({ expression: "(94+98+88+76+81+79+88+92+85)/9" })
```

---

## 八、典型场景工作流

### 场景 1: 用户给 1 个 Excel, 要录入 52 学生 × 9 科目的成绩

```
1. read_excel({ path: "C:\\Users\\teacher\\grades.xlsx" })
   → 解析返回的文本, 识别"姓名"列和 9 个科目列
2. 提取 52 个学生名 (跳过缺考 0 分行)
3. eaa_bulk_add_students({ names: [...] })           // 一次注册
4. eaa_bulk_add_academics({                          // 一次录入
     examType: "期中",
     examName: "高二半期考试",
     date: "2025-11-12",
     records: [ {name, subjects}, ... ]              // 52 条
   })
5. 输出: "已为 52 名学生录入高二半期考试成绩"
```

**对比**: 旧 API 要 52+52=104 次调用; 新 bulk 工具 2 次搞定。

### 场景 2: 用户问"分析张三这学期的表现"

```
1. eaa_score({ name: "张三" })                      → 操行分
2. eaa_history({ name: "张三", limit: 50 })         → 事件时间线
3. eaa_academic_get({ name: "张三" })               → 学业成绩
4. eaa_profile_get({ name: "张三" })                → 扩展档案
(4 个工具并行调用, 拿到完整上下文后再分析)
```

---

## 九、注意事项

1. **添加事件前先 `eaa_codes()`** — 拿到可用原因码列表再选, 避免传错的 code
2. **缺考用 `null` 不是 0** — `eaa_academic_add` 的 subjects 字段, 0 表示 0 分, null 表示缺考
3. **delta 范围 [-10, +10]** — 超出会被 Rust 拒绝
4. **隐私字段** — phone/email/address/parent_phone 等 PII 字段在写入时会自动过隐私引擎脱敏, 无需手动处理
5. **写入用 bulk, 查询用并行** — 大量写入用 bulk_*_*, 大量查询用一次 prompt 里调多个 eaa_*

---

## 十、自省 (self-aware) 工具

| 工具 | 作用 |
|:-----|:-----|
| `eaa_list_agents()` | 列出所有 18 个 agent 的 id/name/role |
| `eaa_list_skills()` | 列出可用 skills |
| `eaa_list_models()` | 列出可用 AI 模型 (provider/model) |
| `eaa_get_own_history({ limit: 10 })` | 查自己过去的执行记录 |
| `eaa_get_own_soul()` | 读自己的 SOUL.md |
| `eaa_get_own_config()` | 读自己的 capabilities / model_tier |
| `eaa_list_cron_tasks()` | 列出定时任务 |

**鼓励**: 不确定"我能不能做 X"时, 先调用 `eaa_list_agents()` 查同事, 或 `eaa_get_own_config()` 查自己。
