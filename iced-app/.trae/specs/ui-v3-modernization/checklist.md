# Checklist

## 背景与基础
- [x] 主画布背景应用渐变色（浅色/深色模式均验证）
- [x] 卡片在渐变背景上呈现"漂浮"视觉效果
- [x] theme.rs 色板值与 spec 一致

## 仪表盘 (dashboard.rs)
- [x] KPI 卡片使用 kpi_card 组件，图标+数字+标签+底部彩条
- [x] 风险分布：顶部堆叠胶囊条（14px 高，7px 圆角）+ 底部每行百分比数值
- [x] 成绩趋势：双轨道渐变进度条 + 右侧分数显示
- [x] 代理活动：空状态有精美占位提示（非纯文字）
- [x] 最近对话：空状态使用 empty_state_with_cta 带 grad_button CTA
- [x] 4 列 KPI 布局 wrap 正常响应

## AI 代理 (agents_page.rs)
- [x] 代理按 3 组分类展示（教学/安全/行政）
- [x] 每组有彩色标题栏（purple/danger-orange/cyan）
- [x] 每个代理卡片有组别 pill badge
- [x] 组间间距 24px，组内 14px
- [x] 双列网格布局正常

## 微交互动效 (style.rs + 各页面)
- [x] hover_lift 样式函数存在且被 KPI/代理/技能卡片使用
- [x] 悬停时 shadow 加深、偏移增大、blur 增大
- [x] 侧边栏活跃指示条有视觉填充效果
- [x] Toast 有入场动画（滑入+淡出完整生命周期）

## 设置页 (settings_page.rs)
- [x] 温度滑块右侧实时显示当前值（如 "0.40"）
- [x] 迭代次数滑块右侧实时显示当前值（如 "8"）
- [x] 保存按钮使用 grad_button 样式，width Fill
- [x] 当前提供商 pick_list 有 🤖 图标前缀

## 全局一致性
- [x] 空状态组件：图标 72px、消息 16px、副标题 12px、CTA 用 grad_button
- [x] chat 气泡圆角 16px、发送按钮渐变样式
- [x] privacy 页面 feature_card 左竖线 + grad_button 操作按钮
- [x] skills 页面代码 ID 在底部右下角 10px text_faint
- [x] sidebar 200px 宽度、底部折叠按钮
- [x] topbar 渐变新对话按钮

## 编译与构建
- [x] `cargo check` 零 error（warning 可接受）
- [x] `cargo build --release` Linux 成功（生成可执行文件）
- [x] `cargo xwin build --release --target x86_64-pc-windows-msvc` Windows 成功
- [x] Windows exe 为 PE32+ GUI x86-64 格式

## 打包与发布
- [x] dist/EducationAdvisor-Portable-Windows-x64.zip 存在（约 20MB）
- [x] Git commit 已合并到 main 分支并推送
- [x] v0.3.0 tag 存在且推送到 origin
- [x] GitHub Release v0.3.0 可访问，便携包已上传
