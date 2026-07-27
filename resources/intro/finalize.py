#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1. Generate SRT subtitle file
2. Burn subtitles into both videos
3. Copy personal version to public/ for the Welcome page
4. Update WelcomePage to use new video
5. Update main intro.mp4 alias
"""
import subprocess
import shutil
from pathlib import Path

BASE = Path(r"C:\Users\sq199\Documents\GitHub\education-advisor\resources\intro")
SCENES = BASE / "scenes"
PUBLIC = Path(r"C:\Users\sq199\Documents\GitHub\education-advisor\src\renderer\public")
WELCOME_DIR = Path(r"C:\Users\sq199\Documents\GitHub\education-advisor\src\renderer\pages\Welcome")
FONT = r"C\:/Windows/Fonts/msyhbd.ttc"

# === SRT timing (与配音 78s 对齐) ===
# 单位: 秒
SUBTITLES = [
    # (start, end, text)
    (0.0, 4.5, "晚上十一点，办公桌前还亮着灯。"),
    (4.5, 8.0, "一摞记录本，三个未回的家长群，"),
    (8.0, 11.5, "一份明早要交的周报。"),
    (11.5, 16.0, "在中国，每一位高中班主任，"),
    (16.0, 20.5, "每周要花八到十二个小时，"),
    (20.5, 25.0, "埋在表格、记录、家校沟通里。"),
    (25.0, 28.5, "Education Advisor，"),
    (28.5, 32.5, "是一台桌面端的教育操作系统，"),
    (32.5, 36.5, "让十八个 Agent 替你分担。"),
    (36.5, 40.5, "打开应用，在对话里输入一句话："),
    (40.5, 44.0, "Alice，作业，加两分。"),
    (44.0, 49.5, "Class Monitor Agent 立刻解析成结构化事件，"),
    (49.5, 52.5, "写入本地事件库。"),
    (52.5, 58.0, "点开仪表盘，柱状图、趋势线、风险分布实时呈现，"),
    (58.0, 62.0, "每一条数据都可追溯到原始事件。"),
    (62.0, 66.5, "隐私面板里，所有学生姓名在送往大模型之前，"),
    (66.5, 70.0, "先被替换成 S_017 这样的编号；"),
    (70.0, 73.5, "每一次调用，都记录在审计日志里，"),
    (73.5, 78.0, "AES-256 加密，永不可篡改。"),
]


def fmt_time(t: float) -> str:
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = t % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}".replace(".", ",")


def write_srt(path: Path, subs, offset=0.0):
    lines = []
    for i, (start, end, text) in enumerate(subs, 1):
        s = max(0, start + offset)
        e = max(s + 0.5, end + offset)
        lines.append(str(i))
        lines.append(f"{fmt_time(s)} --> {fmt_time(e)}")
        lines.append(text)
        lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")
    print(f"  SRT: {path.name} ({len(subs)} cues)")


def burn_subtitles(in_mp4: Path, out_mp4: Path, srt: Path):
    # force_style: FontName,FontSize,PrimaryColour,Outline,Shadow
    # PrimaryColour &H00FFFFFF (white), OutlineColour &H00000000 (black)
    style = (
        "FontName=Microsoft YaHei,"
        "FontSize=44,"
        "PrimaryColour=&H00FFFFFF,"
        "OutlineColour=&H00000000,"
        "BackColour=&H80000000,"
        "BorderStyle=4,"
        "Outline=2,"
        "Shadow=0,"
        "Alignment=2,"  # bottom center
        "MarginV=80"
    )
    # escape path for ffmpeg subtitles filter: backslashes and colons
    srt_escaped = str(srt).replace("\\", "\\\\").replace(":", "\\:")
    vf = f"subtitles='{srt_escaped}':force_style='{style}'"
    cmd = [
        "ffmpeg", "-y", "-i", str(in_mp4),
        "-vf", vf,
        "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
        "-c:a", "copy",
        "-movflags", "+faststart",
        str(out_mp4),
    ]
    print(f"  Burning subtitles → {out_mp4.name} ... ", end="", flush=True)
    r = subprocess.run(cmd, capture_output=True, encoding="utf-8", errors="ignore")
    if out_mp4.exists() and out_mp4.stat().st_size > 1000:
        print(f"OK {out_mp4.stat().st_size/1024/1024:.1f}MB")
    else:
        print(f"FAILED: {r.stderr[-400:] if r.stderr else 'unknown'}")


# === Generate SRT files ===
print("Generating subtitle files...")
srt_personal = BASE / "subs_personal.srt"
srt_contest = BASE / "subs_contest.srt"
# Personal: subtitles start at 0
write_srt(srt_personal, SUBTITLES, offset=0.0)
# Contest: opening is 5s silent, so offset subtitles by 5s
write_srt(srt_contest, SUBTITLES, offset=5.0)

# === Burn subtitles into both videos ===
print("\nBurning subtitles...")
burn_subtitles(BASE / "intro_personal.mp4", BASE / "intro_personal_sub.mp4", srt_personal)
burn_subtitles(BASE / "intro_contest.mp4", BASE / "intro_contest_sub.mp4", srt_contest)

# === Copy to public/ for the Welcome page ===
print("\nCopying to public/...")
PUBLIC.mkdir(parents=True, exist_ok=True)
shutil.copy(BASE / "intro_personal_sub.mp4", PUBLIC / "intro.mp4")
print(f"  Copied intro_personal_sub.mp4 → {PUBLIC / 'intro.mp4'}")
# Also save the contest version
shutil.copy(BASE / "intro_contest_sub.mp4", PUBLIC / "intro_contest.mp4")
print(f"  Copied intro_contest_sub.mp4 → {PUBLIC / 'intro_contest.mp4'}")

# === Re-export poster (frame at 8s) ===
print("\nRegenerating poster...")
intro_path = PUBLIC / "intro.mp4"
poster_path = BASE / "poster.jpg"
subprocess.run([
    "ffmpeg", "-y", "-ss", "8", "-i", str(intro_path),
    "-frames:v", "1", "-q:v", "2", "-vf", "scale=1280:-1",
    str(poster_path),
], capture_output=True)
print(f"  Poster: {poster_path} ({poster_path.stat().st_size//1024}KB)")

print("\nDone.")
