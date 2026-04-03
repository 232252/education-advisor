# 学生管理技能 (Student Management Skill)

## 简介
- **功能**：学生档案管理、风险评估、谈话记录
- **使用场景**：收到学生信息、需要查询学生状态、更新学生档案
- **依赖工具**：read, write, edit, feishu_bitable_app_table_record

## 使用方法

### 1. 查询学生档案
```bash
# 直接读取学生档案文件
cat /data/students/张三.md
```

### 2. 更新学生档案
```python
# 使用 edit 工具更新档案
edit(file="students/张三.md", 
     old_string="旧内容",
     new_string="新内容")
```

### 3. 记录谈话
```python
# 调用 save_talk_record 函数
save_talk_record(
    student_name="张三",
    talk_type="纪律",
    content="今天谈话了上课讲话的问题",
    outcome="学生承诺改正"
)
```

## API 参数

| 参数 | 类型 | 必需 | 说明 |
|:-----|:-----|:----:|:-----|
| student_name | string | ✅ | 学生姓名 |
| talk_type | string | ✅ | 谈话类型：纪律/学业/心理/发展 |
| content | string | ✅ | 谈话内容摘要 |
| outcome | string | ❌ | 谈话结果 |

## 数据存储

学生档案位置：`/data/students/{姓名}.md`

档案格式：
```markdown
# 学生档案：{姓名}

## 基本信息
- **姓名**：
- **班级**：
- **风险等级**：

## 风险评估
| 维度 | 得分 | 说明 |
|:-----|:----:|:-----|
| 学业 | XX | |
| 纪律 | XX | |
| 心理 | XX | |
| 人际 | XX | |

## 督导记录
## 谈话记录
## 成绩记录
```

## 注意事项
1. 档案更新后自动同步到数据库
2. 风险评估由 supervisor Agent 自动计算
3. 谈话记录会自动推送给相关Agent
