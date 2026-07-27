# UI v4.0 极致高级感全面重设计 Spec

## Why
当前 Education Advisor (egui) 主分支的界面仍以纯白/浅灰为基调，质感单薄、品牌感弱，核心面板（仪表盘、AI 代理、隐私安全、系统设置）缺乏现代 SaaS 产品应有的精致度与动效。本次升级旨在通过渐变品牌色、玻璃拟态、弥散阴影、微动效、3D/多彩图标、排版重构与交互升级，打造具有高级感与教育科技品牌识别度的 UI，同时修复链路问题、完成全功能压力测试，并输出 Windows 便携包上传 Release。

## What Changes
- **品牌色彩体系升级**：单一蓝色替换为「科技深蓝 + 钴蓝」到「暖紫 + 天蓝」的呼吸渐变品牌色，应用于按钮、高亮、进度条、顶部强调元素
- **玻璃拟态 & 质感升级**：侧边栏、顶部导航条、主框架底层统一使用 `backdrop-filter: blur(8px)` 等价的 egui 半透明填充 + 柔和阴影
- **背景一体化**：主画布改为多层抽象渐变/微光晕/柔焦纹理背景，白色卡片自然“漂浮”
- **仪表盘重构**：KPI 卡片加图标、浅色渐变背景、弥散投影；风险分布改为堆叠胶囊进度条+百分比；成绩趋势升级为平滑面积/折线图；最近对话空状态增加插画占位、引导文案与大 CTA；代理活动区域增加骨架屏/优雅空状态
- **AI 代理 & 技能列表重构**：卡片增高、按教学/安全/行政分组并配主题色标签；图标升级为多彩渐变/3D 风格；技能代码 ID 缩小为右下角灰色标签
- **隐私与安全视觉强化**：PII Shield 加绿色盾牌图标；普通操作改幽灵/线框按钮；导出备份/初始化等关键操作使用带微光晕的蓝紫渐变按钮；功能项使用左侧竖线分段
- **系统设置控件升级**：自定义滑块（宽轨、大圆头、发光动画），数值实时显示在右侧；当前提供商下拉增加 AI 品牌图标；保存按钮改为右下角悬浮 FAB
- **微交互动效**：卡片悬停上浮 + 投影加深；侧边栏菜单切换左侧亮条填充过渡；图表加载生长动画；仪表盘卡片错落入场动画
- **布局 & 排版重构**：侧边栏更窄，主内容区更宽；图标间距拉开；底部增加折叠按钮/用户头像；改用现代无衬线字体（Inter / PingFang SC），数字使用 Lato / Roboto 加粗；卡片大圆角 + 弥散阴影 + 去边框
- **链路修复 & 全功能压力测试**：修复本次改动可能引入的页面跳转、数据流、按钮关联问题；验证 UI → runtime → DB → UI 双向通信；Linux / Windows 编译通过
- **构建 & 发布**：编译 Windows 便携包 zip，上传 GitHub Release，合并 main 分支

## Impact
- Affected specs: 无前置依赖（与 `ui-v3-modernization` 属于不同代码基，本 Spec 针对 `/workspace` 主分支 egui 实现）
- Affected code:
  - `src/theme.rs` — 扩展渐变品牌色、玻璃/阴影/发光色板
  - `src/ui/widgets.rs` — 新增/改造 glass_card、hover_lift、kpi_card、empty_state_with_cta、group_header、ghost_button、glow_button、capsule_progress、custom_slider、fab_button 等组件
  - `src/ui/dashboard.rs` — KPI 卡片、风险分布、成绩趋势、代理活动、最近对话空状态全面升级
  - `src/ui/agents_page.rs` — 职能分组、主题色标签、卡片增高、能力雷达对齐
  - `src/ui/skills_page.rs` — 卡片增高、多彩图标、代码 ID 底部标签化
  - `src/ui/privacy_page.rs` — 安全盾牌图标、按钮层级、左侧竖线分段
  - `src/ui/settings_page.rs` — 自定义滑块、实时数值、AI 品牌图标、FAB 保存按钮
  - `src/ui/sidebar.rs` — 更窄宽度、玻璃背景、底部折叠/头像、导航指示条动画
  - `src/ui/topbar.rs` — 玻璃背景、渐变按钮、标题排版
  - `src/app.rs` — 入场动画/错落状态、sidebar 折叠宽度
  - `src/charts.rs` — 面积图/折线图生长动画、胶囊进度条
  - `src/ui/icons.rs` — 新增多彩渐变图标绘制函数
  - `.github/workflows/release.yml` / `Cargo.toml` — 版本号、Release 上传

## ADDED Requirements

### Requirement: 渐变品牌色彩体系
系统 SHALL 提供一套呼吸感渐变品牌色，替代单一蓝色，并统一应用于按钮、高亮、进度条与顶部元素。

#### Scenario: 浅色模式品牌渐变
- **WHEN** 用户以浅色模式启动应用
- **THEN** 主渐变从 `rgb(30, 80, 180)`（科技深蓝）过渡到 `rgb(80, 160, 255)`（钴蓝）；高亮色包含淡紫 `rgb(168, 100, 230)` 与天蓝 `rgb(60, 180, 250)`

#### Scenario: 深色模式品牌渐变
- **WHEN** 用户以深色模式启动应用
- **THEN** 主渐变从 `rgb(40, 100, 220)` 过渡到 `rgb(90, 180, 255)`；发光色保持高饱和度但降低亮度

### Requirement: 玻璃拟态全局质感
系统 SHALL 将侧边栏、顶部导航条、主框架底层背景改为玻璃拟态效果，营造通透现代感。

#### Scenario: 侧边栏玻璃背景
- **WHEN** 用户查看侧边栏
- **THEN** 侧边栏背景为半透明 `surface_glass`（alpha 约 0.75）并带有柔和的深色/浅色弥散阴影

#### Scenario: 顶部导航条玻璃背景
- **WHEN** 用户查看顶部导航条
- **THEN** 顶部导航条背景为半透明白色/深色玻璃，底部有 1px 细边框分隔

### Requirement: 主画布一体化背景
系统 SHALL 为主内容区提供非单调背景，使卡片呈现“漂浮”效果。

#### Scenario: 浅色模式主画布
- **WHEN** 应用处于浅色模式
- **THEN** 主画布呈现从 `rgb(245, 247, 252)` 到 `rgb(235, 240, 250)` 的柔和线性渐变，并叠加淡色抽象光晕纹理

#### Scenario: 深色模式主画布
- **WHEN** 应用处于深色模式
- **THEN** 主画布呈现从 `rgb(15, 18, 28)` 到 `rgb(22, 26, 40)` 的深色渐变，并叠加微光晕

### Requirement: 仪表盘 KPI 卡片升级
系统 SHALL 提供更具设计感的 KPI 数据卡片。

#### Scenario: KPI 卡片展示
- **WHEN** 用户进入总览页
- **THEN** 每个 KPI 卡片包含：相关渐变图标、粗体大数字、标签文字、底部细彩条；卡片使用浅色渐变背景、无显式边框、柔和弥散投影

#### Scenario: KPI 卡片悬停
- **WHEN** 鼠标悬停在 KPI 卡片上
- **THEN** 卡片轻微上浮（translateY -2px），投影加深、blur 增大

### Requirement: 风险分布可视化升级
系统 SHALL 将风险分布从简单色块升级为可读的堆叠/胶囊进度条。

#### Scenario: 风险分布渲染
- **WHEN** 仪表盘加载风险分布数据
- **THEN** 顶部显示圆角堆叠胶囊条（高度 14px，圆角 7px）；下方每行显示「风险标签 | 胶囊进度条 | 百分比数值（如 35%）」

### Requirement: 成绩趋势可视化升级
系统 SHALL 将成绩趋势从单调进度条升级为平滑面积图或折线图。

#### Scenario: 成绩趋势渲染
- **WHEN** 仪表盘加载成绩趋势数据
- **THEN** 显示带渐变填充的平滑面积图/折线图，每个数据点hover时显示具体数值；或退化为多彩双轨道渐变进度条

### Requirement: 最近对话空状态美化
系统 SHALL 为「最近对话」空状态提供引导性设计。

#### Scenario: 空状态展示
- **WHEN** 最近对话为空
- **THEN** 显示 72px 精美占位插画/图标、主文案“还没有对话，点击上方“新对话”开启您的第一位 AI 代理！”、副文案 12px 淡色、大渐变 CTA 按钮“去对话”

### Requirement: 代理活动区域占位
系统 SHALL 为代理活动区域提供明确的骨架屏或优雅空状态。

#### Scenario: 无代理活动数据
- **WHEN** 代理活动数据为空
- **THEN** 显示骨架屏动画条或“暂无活动”优雅提示（含图标+描述），而非空白或截断

### Requirement: AI 代理职能分组
系统 SHALL 将 AI 代理按职能分组展示，并用主题色标签区分。

#### Scenario: 分组展示
- **WHEN** 用户进入 AI 代理页
- **THEN** 代理按教学组（淡紫底）、安全组（橙红底）、行政组（青蓝底）分组；每组有彩色标题栏；每个代理卡片右上角有对应主题色 pill 标签

#### Scenario: 教学组识别
- **WHEN** 用户浏览教学组代理
- **THEN** 教学组代理使用紫色系标签与图标（如 academic, curriculum, assessment, counseling）

#### Scenario: 安全组识别
- **WHEN** 用户浏览安全组代理
- **THEN** 安全组代理使用橙红色系标签与图标（如 attendance, discipline, safety, risk-alert）

#### Scenario: 行政组识别
- **WHEN** 用户浏览行政组代理
- **THEN** 行政组代理使用青蓝色系标签与图标（如 enrollment, scheduling, reporting, home_school）

### Requirement: AI 代理卡片呼吸感
系统 SHALL 增加 AI 代理卡片高度与内部留白，让列表有呼吸感。

#### Scenario: 代理卡片尺寸
- **WHEN** 用户查看代理卡片
- **THEN** 卡片高度不低于 130px，圆角 16px，内部 padding 16px，卡片间距 14px，组间距 24px

### Requirement: 多彩/3D 风格图标
系统 SHALL 为关键页面元素提供多彩渐变或 3D 风格图标。

#### Scenario: 仪表盘图标
- **WHEN** 用户查看仪表盘 KPI 卡片
- **THEN** 学生总数配书本/人群渐变图标，平均 GPA 配趋势箭头渐变图标，今日对话配对话气泡图标，工具调用配扳手/工具图标

#### Scenario: 代理/技能图标
- **WHEN** 用户浏览 AI 代理页或技能页
- **THEN** 每个卡片左侧使用多彩渐变圆形图标，颜色与职能/功能匹配

### Requirement: 技能代码 ID 最小化
系统 SHALL 将技能卡片上的代码标识（如 `lookup_students`）缩小并放置于底部。

#### Scenario: 技能代码 ID 展示
- **WHEN** 用户查看技能卡片
- **THEN** 代码 ID 以 10px 灰色小标签形式位于卡片右下角，不作为标题旁主元素

### Requirement: 隐私安全页严肃感
系统 SHALL 在隐私安全页通过视觉元素传达安全感与严肃感。

#### Scenario: PII Shield 标识
- **WHEN** 用户查看 PII Shield 假名化引擎
- **THEN** 标题左侧显示绿色安全盾牌图标，表明关键安全功能

#### Scenario: 按钮层级区分
- **WHEN** 用户查看隐私页操作区
- **THEN** 普通操作（如“清除缓存”）使用幽灵/线框按钮；导出备份、初始化/解绑等关键操作使用带微光晕的蓝紫渐变高级按钮

#### Scenario: 功能项分段
- **WHEN** 用户查看 AES 加密、定向发送过滤器等功能说明
- **THEN** 每个功能项使用左侧 3px 彩色竖线（border-left）进行分段，增强垂直信息流秩序感

### Requirement: 设置页自定义滑块
系统 SHALL 为设置页滑块提供自定义样式与实时数值反馈。

#### Scenario: 温度滑块
- **WHEN** 用户拖动温度滑块
- **THEN** 滑轨加宽、圆头增大；圆头在拖动时周围有发光动画；滑块右侧实时显示当前数值（如 0.40）

#### Scenario: 最大工具迭代滑块
- **WHEN** 用户拖动最大工具迭代滑块
- **THEN** 滑块右侧实时显示当前整数值（如 8）

### Requirement: 设置页 AI 品牌图标
系统 SHALL 为当前提供商下拉框增加 AI 品牌图标。

#### Scenario: 提供商下拉展示
- **WHEN** 用户查看“当前使用模型”下拉框
- **THEN** 下拉框左侧显示机器人/AI 品牌图标，选项列表按提供商类型显示对应图标

### Requirement: 设置页 FAB 保存按钮
系统 SHALL 将设置页保存按钮设计为悬浮操作按钮。

#### Scenario: 保存按钮位置
- **WHEN** 用户滚动到设置页底部
- **THEN** 保存按钮以渐变 FAB 形式固定在内容区右下角，始终可见

### Requirement: 侧边栏布局重构
系统 SHALL 收窄侧边栏并优化图标间距。

#### Scenario: 侧边栏宽度
- **WHEN** 用户查看侧边栏
- **THEN** 展开宽度 180px（更窄），折叠宽度 56px；主内容区相应加宽

#### Scenario: 侧边栏底部
- **WHEN** 侧边栏过长或到达底部
- **THEN** 最底部显示最小化“折叠侧边栏”按钮和用户头像/设置入口

### Requirement: 现代字体与数字排版
系统 SHALL 使用现代无衬线字体与专用数字字体。

#### Scenario: 正文字体
- **WHEN** 应用显示中文正文
- **THEN** 使用 PingFang SC / Noto Sans SC / Inter 无衬线字体

#### Scenario: 数字字体
- **WHEN** 应用显示 KPI 数字、分数、百分比
- **THEN** 数字使用 Lato / Roboto 字体，加粗，尺寸突出

### Requirement: 卡片大圆角去边框
系统 SHALL 统一卡片视觉语言。

#### Scenario: 卡片样式
- **WHEN** 用户查看任意内容卡片
- **THEN** 卡片使用 16px 大圆角、弥散阴影、去除明显边框；背景为浅色渐变或玻璃质感

### Requirement: 微交互动效
系统 SHALL 提供以下微交互动效。

#### Scenario: 卡片悬停上浮
- **WHEN** 鼠标悬停在 KPI/代理/技能卡片上
- **THEN** 卡片在 150ms 内平滑上浮 2-4px，投影加深

#### Scenario: 侧边栏导航指示条
- **WHEN** 用户点击侧边栏菜单切换页面
- **THEN** 左侧活跃指示条颜色加深/宽度微增，产生视觉填充动画

#### Scenario: 图表生长动画
- **WHEN** 仪表盘图表数据加载完成
- **THEN** 进度条/面积图/折线图从 0 生长到目标值，持续约 600ms

#### Scenario: 仪表盘错落入场
- **WHEN** 用户进入总览页
- **THEN** 4 个 KPI 卡片以 0.08s 间隔依次淡入/上滑入场，而非同时出现

### Requirement: 全链路压力测试
系统 SHALL 在 UI 改动后验证所有功能链路完整可用。

#### Scenario: 页面跳转测试
- **WHEN** 测试人员点击侧边栏、顶部按钮、卡片内按钮
- **THEN** 所有 Navigate/跳转消息正确触发，页面正常切换

#### Scenario: 数据流测试
- **WHEN** 测试人员操作涉及 runtime/DB 的功能
- **THEN** UI → runtime → DB → UI 双向通信无误，无 panic/error log

#### Scenario: 编译测试
- **WHEN** 执行编译命令
- **THEN** Linux release 编译通过，Windows x86_64-pc-windows-msvc 交叉编译通过，零 error

### Requirement: Windows 便携包构建与发布
系统 SHALL 编译 Windows 便携包并上传 Release。

#### Scenario: 便携包打包
- **WHEN** 编译成功后
- **THEN** 生成 `dist/EducationAdvisor-Windows-Portable.zip`（包含 exe 与使用说明），大小约 15-25MB

#### Scenario: GitHub Release 上传
- **WHEN** 便携包准备就绪
- **THEN** 合并到 main 分支，创建新版本 tag（如 v1.1.0），GitHub Release 上传便携包并附带 changelog

## MODIFIED Requirements

### Requirement: 卡片阴影与边框（修改自 v1.0.x）
所有卡片 SHALL 从「1px 描边 + 普通阴影」改为「无边框 + 弥散阴影」：
- shadow offset: `(0, 6)` → `(0, 8)`
- shadow blur: `20` → `32`
- shadow alpha: 0.06 → 0.10（浅色）/ 0.15（深色）
- 悬停时 offset 增至 `(0, 12)`，blur 增至 `48`

## REMOVED Requirements

无移除项。
