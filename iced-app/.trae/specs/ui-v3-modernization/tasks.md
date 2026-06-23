# Tasks

- [ ] Task 1: 升级主画布背景为渐变效果
  - [ ] 1.1 修改 `src/app.rs` 的 view() 函数，在主内容区 container 上应用 bg_gradient_from → bg_gradient_to 的背景色
  - [ ] 1.2 使用 iced 的 Background::Gradient 或直接用 surface_glass 作为底层，上层卡片保持透明/半透明以呈现漂浮感
  - [ ] 1.3 验证浅色/深色两种模式下渐变背景渲染正确

- [ ] Task 2: 仪表盘图表可视化升级
  - [ ] 2.1 风险分布：堆叠条改为圆角胶囊状（height 14px, radius 7px），每行右侧添加百分比数值 text
  - [ ] 2.2 成绩趋势：升级为双轨道进度条（前景 accent 渐变 + 背景 accent_dim），右侧显示分数值
  - [ ] 2.3 代理活动：空状态从简单文字改为精美占位（图标+描述+副标题）
  - [ ] 2.4 KPI 卡片布局微调：增加 12px 垂直间距，确保错落入场时有呼吸空间

- [ ] Task 3: AI 代理职能分组与视觉区分
  - [ ] 3.1 在 agents_page.rs 中定义分组数据结构（教学/安全/行政三组及对应代理 ID 列表）
  - [ ] 3.2 每组使用不同主题色的 section 标题栏（教学=purple, 安全=danger/warning, 行政=cyan/info）
  - [ ] 3.3 每个代理卡片右上角增加组别小标签（pill badge，对应组颜色淡底）
  - [ ] 3.4 组间间距加大（24px），组内卡片间距保持 14px

- [ ] Task 4: 微交互动效实现
  - [ ] 4.1 在 style.rs 中新增 hover_lift() 容器样式函数（悬停时 shadow 加深+偏移增大）
  - [ ] 4.2 KPI 卡片 / 代理卡片 / 技能卡片使用 hover_lift 替代普通 card 样式
  - [ ] 4.3 侧边栏活跃指示条：active 状态时增加宽度过渡（3px → 5px，或颜色加深）
  - [ ] 4.4 Toast 入场动画：新 toast 初始位置 offset，通过现有 fade-out 动画框架扩展

- [ ] Task 5: 设置页控件与 FAB 优化
  - [ ] 5.1 温度滑块：标签(60px) + slider(Fill) + 数值显示(45px, accent 色粗体)
  - [ ] 5.2 迭代次数滑块：标签(100px) + slider(Fill) + 数值显示(45px)
  - [ ] 5.3 保存按钮：使用 grad_button 样式，width Fill，固定在 scrollable 内容底部
  - [ ] 5.4 当前提供商 pick_list 前增加 🤖 图标（已有，确认保留）

- [ ] Task 6: 全局风格对齐与细节打磨
  - [ ] 6.1 空状态组件增强：图标 72px、消息 16px、副标题 12px、CTA 用 grad_button
  - [ ] 6.2 chat 页面气泡确认圆角和渐变发送按钮（已实现，验证无回归）
  - [ ] 6.3 privacy 页面 feature_card 和 grad_button 确认一致（已实现，验证无回归）
  - [ ] 6.4 skills 页面代码 ID 底部标签确认一致（已实现，验证无回归）

- [ ] Task 7: 编译验证（Linux + Windows）
  - [ ] 7.1 运行 `CARGO_BUILD_JOBS=1 cargo check` 确认零 error
  - [ ] 7.2 运行 `CARGO_BUILD_JOBS=1 cargo build --release` Linux release 构建
  - [ ] 7.3 运行 `CARGO_BUILD_JOBS=1 cargo xwin build --release --target x86_64-pc-windows-msvc` Windows 构建

- [ ] Task 8: 打包便携版并上传 Release
  - [ ] 8.1 将 Windows exe 复制到 dist/ 并打包 zip
  - [ ] 8.2 Git commit 所有变更到 main 分支
  - [ ] 8.3 创建 v0.3.0 tag 并推送到 origin
  - [ ] 8.4 创建 GitHub Release 上传便携包（含完整 changelog）

# Task Dependencies
- [Task 2] depends on [Task 1] (图表升级依赖背景渐变完成后的视觉效果)
- [Task 3] is independent (可并行)
- [Task 4] depends on [Task 1] (动效依赖整体样式基础)
- [Task 5] is independent (可并行)
- [Task 6] depends on [Task 2, 3, 4, 5] (全局对齐需各模块完成后统一)
- [Task 7] depends on [Task 1-6] (全部代码完成后编译)
- [Task 8] depends on [Task 7] (编译成功后打包)
