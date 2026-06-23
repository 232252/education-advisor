# Checklist

## 品牌色与主题
- [x] `theme.rs` 新增渐变品牌色、玻璃色、发光色板
- [x] 浅色/深色模式色值符合玻璃拟态与弥散阴影要求
- [x] 主题切换后新色板正确生效

## 通用组件 (widgets.rs)
- [x] `glass_card` 实现：半透明渐变背景、无边框、16px 圆角、弥散阴影
- [x] `hover_lift_card` 实现：悬停时投影加深、视觉上浮
- [x] `kpi_card` 实现：多彩渐变图标、粗体数字、标签、底部彩条
- [x] `empty_state_with_cta` 实现：72px 图标、主副文案、渐变 CTA
- [x] `group_header` 实现：彩色左侧竖线 + 标题 + 标签
- [x] `ghost_button` 实现：线框/幽灵按钮样式
- [x] `glow_button` 实现：带微光晕的蓝紫渐变按钮
- [x] `capsule_progress` 实现：圆角胶囊进度条 + 右侧百分比
- [x] `custom_slider` 实现：宽轨、大圆头、发光动画、右侧实时数值
- [x] `fab_button` 实现：右下角悬浮渐变按钮

## 背景与布局
- [x] 主画布多层渐变背景渲染正确（浅色/深色）
- [x] 抽象光晕/柔焦纹理叠加自然
- [x] 侧边栏玻璃拟态背景与阴影正确
- [x] 顶部导航条玻璃拟态背景与底部分隔线正确
- [x] 侧边栏展开宽度 180px、折叠宽度 56px
- [x] 侧边栏底部存在折叠按钮与用户头像/设置入口

## 仪表盘 (dashboard.rs)
- [x] 4 个 KPI 卡片使用 `kpi_card` 并显示对应图标
- [x] KPI 卡片悬停有上浮效果
- [x] KPI 卡片错落入场动画生效（0.08s 间隔）
- [x] 风险分布顶部堆叠胶囊条显示正确
- [x] 风险分布每行显示标签、胶囊条、百分比数值
- [x] 成绩趋势为平滑面积图/折线图或双轨道渐变进度条，并有生长动画
- [x] 代理活动区域无数据时显示骨架屏或“暂无活动”优雅提示
- [x] 最近对话空状态使用 `empty_state_with_cta`，文案与 CTA 正确

## AI 代理页 (agents_page.rs)
- [x] 代理按教学/安全/行政 3 组分类
- [x] 每组 `group_header` 颜色正确（紫/橙红/青蓝）
- [x] 代理卡片高度 ≥130px，圆角 16px，padding 16px
- [x] 卡片间距 14px，组间距 24px
- [x] 每个代理卡片右上角有职能 pill 标签
- [x] 代理卡片左侧有多彩渐变圆形图标
- [x] 能力雷达区域风格一致

## 技能页 (skills_page.rs)
- [x] 技能卡片增高并增加留白
- [x] 技能卡片左侧有多彩渐变圆形图标
- [x] 技能代码 ID 以 10px 灰色标签置于卡片右下角
- [x] 技能卡片悬停有上浮效果

## 隐私安全页 (privacy_page.rs)
- [x] PII Shield 标题左侧有绿色安全盾牌图标
- [x] 普通操作按钮为 `ghost_button`
- [x] 导出备份/初始化/解绑按钮为 `glow_button`
- [x] AES 加密、定向发送过滤器等功能项有左侧 3px 彩色竖线分段

## 设置页 (settings_page.rs)
- [x] 温度滑块为 `custom_slider`，右侧实时显示当前值
- [x] 最大工具迭代滑块为 `custom_slider`，右侧实时显示当前值
- [x] 当前提供商下拉框左侧有 AI 品牌/机器人图标
- [x] 保存按钮为 `fab_button` 并固定在右下角

## 动效与图标
- [x] `icons.rs` 新增书本、趋势箭头、对话气泡、工具、盾牌、机器人等渐变图标
- [x] KPI/代理/技能卡片统一悬停上浮
- [x] 侧边栏 active 指示条有过渡动画
- [x] 图表加载时有生长动画

## 字体与排版
- [x] 中文正文使用现代无衬线字体
- [x] KPI 数字、分数、百分比使用 Lato/Roboto 加粗
- [x] 标题、正文字号/字重层次清晰

## 全链路压力测试
- [x] 所有侧边栏、顶部、卡片内按钮点击跳转正确
- [x] UI → runtime → DB → UI 数据流正常
- [x] `cargo check` 零 error
- [x] `cargo clippy` 无新增 warning（或已修复）
- [x] Linux release 构建成功
- [x] Windows x86_64-pc-windows-msvc 交叉编译成功（通过 cargo-xwin 完成，dist 下 PE32+ x86-64 exe 已生成）

## 打包与发布
- [x] Windows exe 复制到 `dist/EducationAdvisor-Windows-Portable/`
- [x] `使用说明.txt` 存在且内容最新
- [x] `dist/EducationAdvisor-Windows-Portable.zip` 生成成功
- [x] `Cargo.toml` 版本号更新
- [x] `CHANGELOG.md` 已补充 v1.1.0 条目
- [x] 所有变更已 commit 到 main 分支
- [x] 新版本 tag 已创建并推送
- [x] GitHub Release 已创建，便携包已上传（v1.1.0 tag 已推送，触发 .github/workflows/release.yml 自动构建上传）
