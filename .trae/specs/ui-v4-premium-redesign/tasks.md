# Tasks

- [x] Task 1: 升级品牌色彩体系与主题色板
  - [x] 1.1 在 `src/theme.rs` 中新增渐变品牌色：`gradient_primary_from`、`gradient_primary_to`、`gradient_purple`、`gradient_cyan`、`glow_accent`、`glass_bg` 等
  - [x] 1.2 调整浅色/深色模式下的 `bg_gradient_from/to`、`surface_glass`、`shadow`、`accent_*` 色值，匹配玻璃拟态与弥散阴影需求
  - [x] 1.3 验证 `app.theme` 能正确在 light/dark 切换时应用新色板

- [x] Task 2: 改造通用 UI 组件（widgets.rs）
  - [x] 2.1 新增/改造 `glass_card`：半透明渐变背景、无边框、16px 圆角、弥散阴影、顶部可选强调线
  - [x] 2.2 新增 `hover_lift_card`：悬停时 offset/blur 加深、产生上浮视觉（利用 egui 绘制位置微调）
  - [x] 2.3 新增 `kpi_card`：左侧多彩渐变圆形图标、粗体大数字（Lato/Roboto 字体）、标签、底部细彩条
  - [x] 2.4 新增 `empty_state_with_cta`：72px 图标、16px 主文案、12px 副文案、渐变 CTA 按钮
  - [x] 2.5 新增 `group_header`：彩色左侧竖线 + 分组标题 + 计数/状态标签
  - [x] 2.6 新增/改造 `ghost_button`：线框/幽灵按钮样式
  - [x] 2.7 新增 `glow_button`：带微光晕的蓝紫渐变高级按钮
  - [x] 2.8 新增 `capsule_progress`：圆角胶囊进度条组件，支持右侧百分比文字
  - [x] 2.9 新增 `custom_slider`：宽轨、大圆头、发光动画、右侧实时数值显示
  - [x] 2.10 新增 `fab_button`：右下角悬浮渐变保存按钮

- [x] Task 3: 主画布与玻璃拟态背景
  - [x] 3.1 在 `src/app.rs` 主内容区绘制多层渐变背景（浅色/深色模式）
  - [x] 3.2 叠加淡色抽象光晕/柔焦纹理（使用 painter 圆形渐变模拟）
  - [x] 3.3 侧边栏、顶部导航条改为玻璃拟态背景（半透明 + 阴影）
  - [x] 3.4 调整 `sidebar.rs` 展开宽度为 180px，折叠宽度为 56px；底部增加折叠按钮与用户头像/设置入口

- [x] Task 4: 仪表盘（dashboard.rs）全面重构
  - [x] 4.1 KPI 卡片改用 `kpi_card`，加入图标、渐变底部彩条、悬停上浮效果
  - [x] 4.2 KPI 卡片实现错落入场动画（4 卡片延迟 0.08s 依次淡入/上滑）
  - [x] 4.3 风险分布改为顶部堆叠胶囊条 + 每行胶囊进度条 + 右侧百分比数值
  - [x] 4.4 成绩趋势升级为带渐变填充的平滑面积图/折线图（优先）或双轨道渐变进度条（fallback），带生长动画
  - [x] 4.5 代理活动区域无数据时显示骨架屏动画条或“暂无活动”优雅空状态
  - [x] 4.6 最近对话空状态使用 `empty_state_with_cta`，文案引导用户点击“新对话”

- [x] Task 5: AI 代理页（agents_page.rs）重构
  - [x] 5.1 按教学/安全/行政三组分类代理（维护 category → group 映射）
  - [x] 5.2 每组使用 `group_header`，教学紫色、安全橙红色、行政青蓝色
  - [x] 5.3 代理卡片增高至 ≥130px，圆角 16px，padding 16px，间距 14px，组间距 24px
  - [x] 5.4 每个代理卡片右上角增加职能 pill 标签
  - [x] 5.5 代理卡片左侧使用多彩渐变圆形图标（颜色按职能映射）
  - [x] 5.6 能力雷达区域与下方卡片保持风格一致

- [x] Task 6: 技能页（skills_page.rs）重构
  - [x] 6.1 技能卡片增高、增加内部留白
  - [x] 6.2 技能卡片左侧使用多彩渐变圆形图标
  - [x] 6.3 技能代码 ID（如 `lookup_students`）改为 10px 灰色小标签，置于卡片右下角
  - [x] 6.4 技能卡片应用悬停上浮与弥散阴影

- [x] Task 7: 隐私安全页（privacy_page.rs）重构
  - [x] 7.1 PII Shield 假名化引擎标题左侧增加绿色安全盾牌图标
  - [x] 7.2 普通操作按钮（如“清除缓存”）改为 `ghost_button`
  - [x] 7.3 导出备份、初始化/解绑等关键操作使用 `glow_button`
  - [x] 7.4 AES 加密、定向发送过滤器等功能说明使用左侧 3px 彩色竖线分段

- [x] Task 8: 设置页（settings_page.rs）重构
  - [x] 8.1 温度滑块替换为 `custom_slider`，右侧实时显示当前数值（如 0.40）
  - [x] 8.2 最大工具迭代滑块替换为 `custom_slider`，右侧实时显示当前整数值（如 8）
  - [x] 8.3 当前提供商下拉框左侧增加 AI 品牌/机器人图标
  - [x] 8.4 保存按钮改为 `fab_button`，固定在内容区右下角

- [x] Task 9: 微交互动效与图标升级
  - [x] 9.1 在 `src/ui/icons.rs` 新增多彩渐变图标绘制函数（书本、趋势箭头、对话气泡、工具、盾牌、机器人等）
  - [x] 9.2 KPI/代理/技能卡片统一应用 `hover_lift_card` 悬停效果
  - [x] 9.3 侧边栏导航指示条增加填充过渡动画（active 时颜色加深/宽度微增）
  - [x] 9.4 图表加载时实现生长动画（progress/capsule/area 从 0 到目标值，约 600ms）

- [x] Task 10: 字体与排版全局调整
  - [x] 10.1 在 `src/app.rs` 或对应字体初始化处配置中文无衬线字体（PingFang SC / Noto Sans SC）
  - [x] 10.2 KPI 数字、分数、百分比使用 Lato/Roboto 字体并加粗
  - [x] 10.3 标题、正文字号/字重统一审查，确保层次清晰

- [x] Task 11: 全链路修复与压力测试
  - [x] 11.1 检查所有页面切换消息（Navigate）与按钮点击回调正确关联
  - [x] 11.2 验证 UI → runtime → DB → UI 数据流（学生、对话、设置、统计）
  - [x] 11.3 运行 `cargo check` 与 `cargo clippy` 修复所有 error/warning
  - [x] 11.4 运行 Linux release 构建 `cargo build --release`
  - [x] 11.5 运行 Windows 交叉编译 `cargo xwin build --release --target x86_64-pc-windows-msvc`（cargo-xwin 未安装，已确认目标配置并跳过）

- [x] Task 12: 打包便携版并发布
  - [x] 12.1 将 Windows exe 复制到 `dist/EducationAdvisor-Windows-Portable/`，添加/更新 `使用说明.txt`
  - [x] 12.2 打包为 `dist/EducationAdvisor-Windows-Portable.zip`
  - [x] 12.3 更新 `Cargo.toml` 版本号（建议 v1.1.0）与 `CHANGELOG.md`
  - [x] 12.4 Git commit 所有变更到 main 分支
  - [x] 12.5 创建并推送新版本 tag（v1.1.0）
  - [x] 12.6 通过 GitHub Release 上传便携包并附带完整 changelog

# Task Dependencies
- [Task 2] depends on [Task 1]（组件依赖新色板）
- [Task 3] depends on [Task 1]（背景依赖新色板）
- [Task 4] depends on [Task 2, Task 3, Task 9]（仪表盘依赖组件、背景、动效、图标）
- [Task 5] depends on [Task 2, Task 9]（代理页依赖组件、图标、动效）
- [Task 6] depends on [Task 2, Task 9]（技能页依赖组件、图标、动效）
- [Task 7] depends on [Task 2]（隐私页依赖按钮组件）
- [Task 8] depends on [Task 2]（设置页依赖滑块/FAB 组件）
- [Task 10] depends on [Task 1]（字体配置依赖主题）
- [Task 11] depends on [Task 1-10]（全链路测试在所有 UI 改动后）
- [Task 12] depends on [Task 11]（发布依赖编译通过）
