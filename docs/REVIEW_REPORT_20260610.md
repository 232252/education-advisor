# Education Advisor 项目审查报告

**审查时间**: 2026-06-10  
**审查范围**: 学生界面、成绩录入、全链路连通性、文字一致性  
**项目路径**: C:\Users\sq199\.qwenpaw\workspaces\default\coding_projects\1\ai-workstation

---

## 🔴 一、BUG（必须修复）

### 1. classId/class_id 字段不一致 ⚠️ 严重

| 位置 | 问题描述 |
|------|---------|
| `types/index.ts` EAAStudent | 使用 `class_id: string \| null` |
| `types/index.ts` StudentProfileData | 使用 `classId` (不存在，定义的是 classId) |
| `StudentProfile.tsx` ProfileTab | 混用 `form.classId` 和 `student.class_id` |

**影响**: 档案中的班级信息无法正确同步到 EAA 系统

**修复建议**:
```typescript
// types/index.ts 中 StudentProfileData 添加
classId?: string
```

**当前代码问题** (StudentProfile.tsx 第 457 行):
```typescript
value={(form.classId as string) ?? student.class_id ?? ''}
```

---

### 2. 档案字段 fatherName/motherName 未定义 ⚠️

| 问题位置 | 描述 |
|---------|------|
| `ProfileTab` 渲染字段 | 使用 `fatherName`, `fatherPhone`, `motherName`, `motherPhone` |
| `StudentProfileData` 类型 | 只定义了 `parentName`, `parentPhone` |

**影响**: 编辑家庭信息时字段无法正确保存

**修复建议**: 在 `types/index.ts` 的 `StudentProfileData` 中添加:
```typescript
fatherName?: string
fatherPhone?: string
motherName?: string
motherPhone?: string
```

---

### 3. 档案保存顺序错误 ⚠️

**位置**: `StudentProfile.tsx` `handleSave` 函数

**问题**: 先保存 profile，再设置班级。如果 profile 保存失败，班级设置不会执行，但用户可能已修改了班级。

**当前代码**:
```typescript
const result = await getAPI().profile.set(student.name, form)
if (!result.success) { ... return }
if (form.classId) {
  await getAPI().eaa.setStudentMeta({ name: student.name, classId: form.classId })
}
```

**建议**: 调换顺序，或使用事务确保原子性

---

### 4. Agent 状态标签硬编码 ⚠️

**位置**: `StudentProfile.tsx` AIAnalysisTab 组件 (~第 1862 行)

**问题**: 状态显示使用硬编码中文/英文，未使用 i18n

**当前代码**:
```typescript
{agent.status === 'idle' ? '待机' : agent.status === 'running' ? '运行中' : '错误'}
```

**建议**: 使用 `t('page.agents.status.idle')` 等翻译键

---

## 🟡 二、功能缺陷（建议补充）

### 1. 学业成绩批量导入缺失

**现状**: 只能逐个添加考试、手动输入分数  
**建议**: 支持 CSV/Excel 批量导入

### 2. 学生搜索功能弱

**现状**: 仅支持姓名/分组/角色搜索  
**建议**: 增加班级、学号、风险等级搜索

### 3. 成绩趋势图无数据时无提示

**位置**: `AcademicsTab` 趋势图区域  
**问题**: 无数据时显示空白，而非友好提示

### 4. 偏科分析功能单一

**现状**: 仅显示最强/最弱科目  
**建议**: 增加科目间差距预警、建议加强的科目

### 5. 事件与学业数据未关联

**现状**: 操行事件与学业成绩是两条独立的数据流  
**建议**: 允许在学业页面查看对应时段的操行事件

---

## 🟢 三、功能优化方向（可行优化）

### 1. 成绩录入交互优化

| 优化项 | 描述 |
|--------|------|
| 批量粘贴 | 支持从 Excel 粘贴多行成绩 |
| 一键填充 | 某科分数应用到全部考试 |
| 快速清空 | ��键清除某考试所有成绩 |

### 2. 事件列表增强

| 优化项 | 描述 |
|--------|------|
| 排序选项 | 按日期/分数/原因码排序 |
| 视图切换 | 卡片视图 ↔ 表格视图 |
| 批量撤销 | 选择多个事件批量撤销 |

### 3. 班级/分组管理界面

**现状**: 班级信息分散在 EAA 和档案中  
**建议**: 增加专门的班级管理页面，统一管理学生班级

### 4. 导入导出增强

- 支持按班级/分组筛选后导出
- 导出包含学业趋势图快照

---

## 🔵 四、链路连通性问题

### 1. EAA 元数据与档案系统割裂

| 数据 | 存储位置 | 问题 |
|------|---------|------|
| 班级 | EAA (class_id) + Profile (classId) | 两边可能不一致 |
| 分组 | EAA (groups) | 档案未同步 |
| 角色 | EAA (roles) | 档案未同步 |

**建议**: 在档案页面显示 EAA 元数据，并在修改时同步更新

### 2. 事件系统与学业数据无关联

**现状**: 操行事件 (EAA events) 与学业成绩 (profile.academicRecords) 独立存储  
**建议**: 在学业页面增加"同时期操行事件"区块

---

## 🟣 五、文字统一性问题

### 1. Agent 状态标签混排

| 位置 | 问题 |
|------|------|
| AIAnalysisTab | "待机" / "运行中" / "错误" 硬编码 |

**修复**: 使用 `page.agents.status.*` 翻译键

### 2. 硬编码文字（部分已使用 i18n）

| 位置 | 硬编码内容 |
|------|-----------|
| StudentsPage | "学生管理", "添加", "删除" |
| StudentProfile | "添加事件", "AI 分析", "分数变动" |

---

## 📋 六、修复优先级

### P0 (立即修复)
1. classId/class_id 字段统一
2. fatherName/motherName 字段补全
3. Agent 状态标签 i18n 化

### P1 (本周内)
4. 档案保存顺序调整
5. 趋势图空数据提示
6. 搜索功能增强

### P2 (规划中)
7. 批量导入导出
8. 班级管理界面
9. 事件-学业关联分析

---

*报告生成完毕 - 供项目方参考*