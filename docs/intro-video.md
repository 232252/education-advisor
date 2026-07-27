# 项目介绍视频 · intro.mp4

> 70 秒，1920×1080，H.264 + AAC，44 MB。

## 用途

挂在 `src/renderer/pages/Welcome/WelcomePage.tsx`，应用首次启动时自动播放。
侧边栏 "🎬 介绍" 入口可随时重看。

## 素材结构

```
resources/intro/
├── script.md                # 中文旁白脚本 + 分镜表
├── intro.mp4                # 最终视频（44MB / 68.5s / 1080p）
├── poster.jpg               # 5s 时刻截帧，1280×720（可做海报）
├── audio/
│   ├── voiceover.mp3        # 沉稳高管音色 TTS，68.26s
│   ├── background.mp3       # 轻钢琴 ambient，26s（原始）
│   └── background_loop.mp3  # 循环 + 淡入淡出到 69.93s
├── scenes/                  # 7 段 2K 场景图（2752×1536）+ 7 段 10s 微动 mp4
└── preview/                 # 抽帧预览（5s/25s/45s/60s）
```

## 重建方法

```powershell
# 1. 出图：编辑 image prompts 后跑 image_synthesize
# 2. 配音：编辑 script.md 旁白后跑 synthesize_speech
# 3. 配乐：编辑 prompt 后跑 batch_text_to_music
# 4. 渲染 7 段 Ken Burns 微动视频：
powershell resources/intro/render-scenes.ps1
# 5. 拼接 + 混流：
powershell resources/intro/compose.ps1
```

## 视频生成额度说明

视频生成（image-to-video）走独立计费池，2026-07-23 用完后自动降级为
ffmpeg Ken Burns（zoompan 推拉镜头）方案。质感略低于原生 AI 视频但完全
够产品介绍用。如果需要更高动态，充值后可重跑 `batch_image_to_video`。

## 主页集成

- **路由**：`/` 和 `/welcome` 都指向 `WelcomePage`（全屏视频，独立于 MainLayout）
- **资产路径**：`src/renderer/public/intro.mp4`（Vite public，dev/build 通用）
- **生产环境**：dist/renderer/intro.mp4 由 `app://` 协议处理器自动服务（无需改 main 进程）
- **导航**：侧边栏新增 🎬 "介绍" 入口（i18n: `nav.welcome`）

## 待优化

- 视频生成额度恢复后，可重做 6-7 段 AI 微动视频替换 Ken Burns 推拉
- 配音速度 0.95 偏慢，可调 1.0 试更紧凑
- S7 收尾画面时长 11.5s，可视节奏再调
