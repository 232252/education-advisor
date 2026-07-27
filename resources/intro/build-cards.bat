@echo off
REM Build opening/closing cards using ffmpeg drawtext with Chinese font
REM 直接 cmd 跑，绕开 PowerShell 字符串处理问题

set BASE=C:\Users\sq199\Documents\GitHub\education-advisor\resources\intro
set SCENES=%BASE%\scenes

echo Building S0_opening_contest (5s)...
ffmpeg -y -f lavfi -i "color=c=#0a0e1a:s=1920x1080:d=5:r=30" -vf "drawtext=fontfile='C\:/Windows/Fonts/msyh.ttc':text='九 龙 高 级 中 学':fontcolor=white:fontsize=88:x=(w-text_w)/2:y=340,drawtext=fontfile='C\:/Windows/Fonts/msyhbd.ttc':text='邵  奇':fontcolor=white:fontsize=72:x=(w-text_w)/2:y=480,drawtext=fontfile='C\:/Windows/Fonts/msyh.ttc':text='教 育 开 源 项 目  ·  参 赛 作 品':fontcolor=#9CA3AF:fontsize=28:x=(w-text_w)/2:y=600,drawtext=fontfile='C\:/Windows/Fonts/msyh.ttc':text='Education Advisor':fontcolor=#3B82F6:fontsize=20:x=(w-text_w)/2:y=720" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -r 30 "%SCENES%\S0_opening_contest.mp4" 2>nul
if exist "%SCENES%\S0_opening_contest.mp4" (echo OK) else (echo FAILED)

echo Building S0_opening_personal (5s)...
ffmpeg -y -f lavfi -i "color=c=#0a0e1a:s=1920x1080:d=5:r=30" -vf "drawtext=fontfile='C\:/Windows/Fonts/msyhbd.ttc':text='Education Advisor':fontcolor=white:fontsize=72:x=(w-text_w)/2:y=480,drawtext=fontfile='C\:/Windows/Fonts/msyh.ttc':text='教 育 操 作 系 统':fontcolor=#9CA3AF:fontsize=28:x=(w-text_w)/2:y=600" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -r 30 "%SCENES%\S0_opening_personal.mp4" 2>nul
if exist "%SCENES%\S0_opening_personal.mp4" (echo OK) else (echo FAILED)

echo Building S8_closing_contest (6s)...
ffmpeg -y -f lavfi -i "color=c=#0a0e1a:s=1920x1080:d=6:r=30" -vf "drawtext=fontfile='C\:/Windows/Fonts/msyhbd.ttc':text='Education Advisor':fontcolor=white:fontsize=64:x=(w-text_w)/2:y=320,drawtext=fontfile='C\:/Windows/Fonts/msyh.ttc':text='让 老 师 回 到 讲 台':fontcolor=#E5E7EB:fontsize=42:x=(w-text_w)/2:y=430,drawtext=fontfile='C\:/Windows/Fonts/msyh.ttc':text='github.com/232252/education-advisor':fontcolor=#9CA3AF:fontsize=24:x=(w-text_w)/2:y=520" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -r 30 "%SCENES%\S8_closing_contest.mp4" 2>nul
if exist "%SCENES%\S8_closing_contest.mp4" (echo OK) else (echo FAILED)

echo Building S8_closing_personal (11s)...
ffmpeg -y -f lavfi -i "color=c=#0a0e1a:s=1920x1080:d=11:r=30" -vf "drawtext=fontfile='C\:/Windows/Fonts/msyhbd.ttc':text='Education Advisor':fontcolor=white:fontsize=64:x=(w-text_w)/2:y=240,drawtext=fontfile='C\:/Windows/Fonts/msyh.ttc':text='让 老 师 回 到 讲 台':fontcolor=#E5E7EB:fontsize=42:x=(w-text_w)/2:y=340,drawtext=fontfile='C\:/Windows/Fonts/msyh.ttc':text='github.com/232252/education-advisor':fontcolor=#9CA3AF:fontsize=24:x=(w-text_w)/2:y=430,drawtext=fontfile='C\:/Windows/Fonts/msyh.ttc':text='邵  奇':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=520,drawtext=fontfile='C\:/Windows/Fonts/msyh.ttc':text='九 龙 高 级 中 学  ·  物 理 教 师':fontcolor=#D1D5DB:fontsize=22:x=(w-text_w)/2:y=580,drawtext=fontfile='C\:/Windows/Fonts/msyh.ttc':text='开 源 项 目   ·   教 育 实 践 应 用':fontcolor=#9CA3AF:fontsize=20:x=(w-text_w)/2:y=625,drawtext=fontfile='C\:/Windows/Fonts/msyh.ttc':text='本 地 优 先   ·   隐 私 保 护   ·   可 审 计':fontcolor=#9CA3AF:fontsize=20:x=(w-text_w)/2:y=665" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -r 30 "%SCENES%\S8_closing_personal.mp4" 2>nul
if exist "%SCENES%\S8_closing_personal.mp4" (echo OK) else (echo FAILED)

echo All done.
