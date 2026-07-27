#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Build opening/closing card IMAGES using PIL (handles Chinese natively),
then convert each PNG to a 30fps mp4 with ffmpeg.
"""
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

BASE = Path(r"C:\Users\sq199\Documents\GitHub\education-advisor\resources\intro")
SCENES = BASE / "scenes"
SCENES.mkdir(parents=True, exist_ok=True)

W, H = 1920, 1080
FONT = r"C:\Windows\Fonts\msyh.ttc"
FONTB = r"C:\Windows\Fonts\msyhbd.ttc"

BG = (10, 14, 26)        # #0a0e1a
WHITE = (255, 255, 255)
GRAY = (229, 231, 235)
DGRAY = (156, 163, 175)
BLUE = (59, 130, 246)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONTB if bold else FONT, size)


def center_text(draw, text, y, fnt, fill):
    bbox = draw.textbbox((0, 0), text, font=fnt)
    w = bbox[2] - bbox[0]
    draw.text(((W - w) // 2, y), text, font=fnt, fill=fill)


def render_card(out_png: Path, lines: list) -> None:
    """lines: list of (text, font_size, bold, y_offset, color)"""
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    for text, size, bold, y, color in lines:
        center_text(d, text, y, font(size, bold), color)
    img.save(out_png, "PNG", optimize=True)
    print(f"  PNG: {out_png.name}")


def png_to_mp4(png: Path, duration: int) -> None:
    mp4 = png.with_suffix(".mp4")
    cmd = [
        "ffmpeg", "-y", "-loop", "1", "-i", str(png),
        "-t", str(duration),
        "-vf", "scale=1920:1080:flags=lanczos,format=yuv420p",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p", "-r", "30",
        str(mp4),
    ]
    r = subprocess.run(cmd, capture_output=True, encoding="utf-8", errors="ignore")
    if mp4.exists() and mp4.stat().st_size > 1000:
        print(f"  MP4: {mp4.name} {mp4.stat().st_size/1024/1024:.2f}MB")
    else:
        print(f"  MP4 FAILED: {r.stderr[-300:] if r.stderr else 'unknown'}")


# === S0 竞赛版开屏卡 (5s) ===
print("S0 竞赛版开屏卡")
png = SCENES / "S0_opening_contest.png"
render_card(png, [
    ("九 龙 高 级 中 学", 88, True, 340, WHITE),
    ("邵  奇",            72, True, 480, WHITE),
    ("教 育 开 源 项 目  ·  参 赛 作 品", 28, False, 600, DGRAY),
    ("Education Advisor", 20, False, 720, BLUE),
])
png_to_mp4(png, 5)

# === S0 个人版开屏卡 (5s) ===
print("S0 个人版开屏卡")
png = SCENES / "S0_opening_personal.png"
render_card(png, [
    ("Education Advisor", 72, True, 480, WHITE),
    ("教 育 操 作 系 统",   28, False, 600, DGRAY),
])
png_to_mp4(png, 5)

# === S8 竞赛版落版 (6s) ===
print("S8 竞赛版落版")
png = SCENES / "S8_closing_contest.png"
render_card(png, [
    ("Education Advisor", 64, True, 320, WHITE),
    ("让 老 师 回 到 讲 台", 42, False, 430, GRAY),
    ("github.com/232252/education-advisor", 24, False, 520, DGRAY),
])
png_to_mp4(png, 6)

# === S8 个人版落版 (11s) ===
print("S8 个人版落版")
png = SCENES / "S8_closing_personal.png"
render_card(png, [
    ("Education Advisor", 64, True, 240, WHITE),
    ("让 老 师 回 到 讲 台", 42, False, 340, GRAY),
    ("github.com/232252/education-advisor", 24, False, 430, DGRAY),
    ("邵  奇", 36, True, 520, WHITE),
    ("九 龙 高 级 中 学  ·  物 理 教 师", 22, False, 580, GRAY),
    ("开 源 项 目   ·   教 育 实 践 应 用", 20, False, 625, DGRAY),
    ("本 地 优 先   ·   隐 私 保 护   ·   可 审 计", 20, False, 665, DGRAY),
])
png_to_mp4(png, 11)

print("\nAll cards generated.")
