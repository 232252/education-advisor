# UI v3.0 现代化全面升级 Spec

## Why
v0.2.0 已完成基础玻璃拟态 + 靛蓝紫色彩体系，但仍有以下不足：
- 背景单调，缺少渐变/纹理主画布，卡片没有"漂浮感"
- 仪表盘图表仍为简单进度条，缺乏可视化冲击力（无折线图、面积图）
- AI 代理列表未按职能分组，视觉区分度不够
- 缺少微交互动效（卡片悬停上浮、侧边栏导航填充动画、图表生长动画、错落入场动画）
- 设置页滑块缺少发光效果和实时数值反馈
- 空状态区域引导性不足

## What Changes
- **背景一体化**：主画布添加极简渐变背景（从 bg_gradient_from 到 bg_gradient_to 的径向/线性渐变），让白色卡片自然"漂浮"
- **仪表盘图表升级**：风险分布改为胶囊进度条+百分比；成绩趋势改为多色渐变双轨道进度条；代理活动增加优雅空状态提示
- **AI 代理职能分组**：按教学/安全/行政分类，使用不同主题色标签（淡紫/橙红/青蓝），增加视觉区分
- **微交互动效**：卡片悬停投影加深+轻微上浮；侧边栏活跃指示条填充过渡；仪表盘 KPI 卡片错落入场动画；图表数据加载时生长动画
- **设置页优化**：滑块实时数值显示在右侧，保存按钮改为 FAB 悬浮样式
- **链路全面压力测试**：验证所有按钮可点击、页面跳转正确、数据流完整
- **编译 Windows 便携版并上传 Release**

## Impact
- Affected specs: 无前置 spec 依赖
- Affected code:
  - `src/theme.rs` — 背景渐变色扩展
  - `src/ui/style.rs` — 新增 hover_lift 容器样式、slider 发光样式
  - `src/ui/widgets.rs` — 新增 grouped_section 组件、capsule_progress 组件
  - `src/ui/dashboard.rs` — 图表升级、KPI 错落布局、空状态美化
  - `src/ui/agents_page.rs` — 职能分组、主题色标签
  - `src/ui/sidebar.rs` — 导航填充动画优化
  - `src/ui/settings_page.rs` — 滑块数值显示、FAB 保存按钮
  - `src/app.rs` — 入场动画状态管理
  - 其余页面（chat, toast, privacy, skills 等）— 微调对齐新风格

## ADDED Requirements

### Requirement: 渐变主画布背景
系统 SHALL 在应用主内容区提供从 `bg_gradient_from` 到 `bg_gradient_to` 的线性渐变背景，使白色卡片呈现"漂浮"效果。

#### Scenario: 浅色模式背景渲染
- **WHEN** 用户以浅色模式启动应用
- **THEN** 主画布背景呈现从 `rgb(248,250,253)` 到 `rgb(241,245,251)` 的垂直线性渐变

#### Scenario: 深色模式背景渲染
- **WHEN** 用户以深色模式启动应用
- **THEN** 主画布背景呈现从 `rgb(10,12,20)` 到 `rgb(17,21,35)` 的垂直线性渐变

### Requirement: 仪表盘可视化升级
系统 SHALL 提供增强的数据可视化组件：
1. **风险分布**：顶部堆叠条形图（圆角胶囊状，高度 14px）+ 底部每行胶囊进度条 + 右侧百分比数值
2. **成绩趋势**：双轨道渐变进度条（前景 accent 色，背景 accent_dim），右侧显示具体分数
3. **代理活动**：水平条形图带紫色渐变，空状态显示优雅的占位提示（含图标+描述文字）

#### Scenario: 风险分布百分比显示
- **WHEN** 仪表盘加载风险分布数据
- **THEN** 每个风险级别行显示：标签 | 胶囊进度条 | 百分比数值（如 "35%"）

#### Scenario: 成绩趋势双轨道显示
- **WHEN** 仪表盘加载成绩趋势数据
- **THEN** 每个成绩项显示：标签 | 双轨道渐变进度条 | 分数值

### Requirement: AI 代理职能分组
系统 SHALL 将 18 个 AI 代理按职能分为 3 组：
- **教学组**（淡紫色底 badge）：tutor, curriculum, assessment, counseling
- **安全组**（橙红色底 badge）：attendance, discipline, safety, risk
- **行政组**（青蓝色底 badge）：enrollment, scheduling, reporting, parent_comm

#### Scenario: 代理列表分组展示
- **WHEN** 用户进入 AI 代理页面
- **THEN** 代理按职能分组展示，每组有彩色标题栏，每个代理卡片带有对应组的主题色小标签

### Requirement: 微交互动效
系统 SHALL 提供以下微交互效果：

#### Scenario: 卡片悬停上浮
- **WHEN** 鼠标悬停在 KPI 卡片 / 代理卡片 / 技能卡片上
- **THEN** 卡片投影加深（shadow alpha 从 0.06 → 0.15）、偏移增大（4px → 8px）、blur 增大（32 → 48）

#### Scenario: 侧边栏导航指示条动画
- **WHEN** 用户点击侧边栏切换页面
- **THEN** 左侧活跃指示条平滑过渡到新位置（通过颜色变化实现视觉填充效果）

#### Scenario: 仪表盘 KPI 错落入场
- **WHEN** 用户进入总览页面
- **THEN** 4 个 KPI 卡片依次延迟 0.08s 出现（通过 opacity/位移模拟）

#### Scenario: 图表生长动画
- **WHEN** 仪表盘图表数据加载完成
- **THEN** 进度条从 0 生长到目标值（progress_bar 自身动画）

### Requirement: 设置页控件升级
系统 SHALL 在设置页提供增强的控件交互：

#### Scenario: 滑块实时数值显示
- **WHEN** 用户拖动温度/迭代次数滑块
- **THEN** 滑块右侧实时显示当前数值（如 "0.4"、"8"）

#### Scenario: FAB 保存按钮
- **WHEN** 用户在设置页底部
- **THEN** 保存按钮以渐变全宽样式固定在内容区底部，视觉权重高于其他操作

### Requirement: 全链路压力测试
系统 SHALL 通过编译验证所有功能链路完整：
- 所有按钮可点击且消息关联正确
- 所有页面跳转（Navigate 消息）正常工作
- 数据流：UI → runtime → DB → UI 双向通信无误
- Linux release 编译通过
- Windows x86_64-pc-windows-msvc 交叉编译通过
- Windows 便携版 zip 打包完成
- GitHub Release v0.3.0 上传成功

## MODIFIED Requirements

### Requirement: 空状态设计（修改自 v0.2.0）
空状态组件 SHALL 进一步增强：
- 图标尺寸从 64px 增大到 72px
- 消息文字从 15px 增大到 16px，增加副标题说明（12px text_faint）
- CTA 按钮使用 grad_button 样式而非 primary_button

### Requirement: Toast 通知（修改自 v0.2.0）
Toast 通知 SHALL 增加入场动画：
- 新 Toast 出现时从右侧滑入（初始 offset_x = 50px，动画至 0px）
- 配合已有的淡出动画形成完整的生命周期
