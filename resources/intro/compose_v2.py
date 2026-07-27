#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Compose two final videos:
  - intro_contest.mp4   (5s opening + content + 6s closing)  ~78s
  - intro_personal.mp4  (content + 11s closing)               ~78s

Also generate an SRT subtitle file and burn it in.
"""
import subprocess
from pathlib import Path

BASE = Path(r"C:\Users\sq199\Documents\GitHub\education-advisor\resources\intro")
SCENES = BASE / "scenes"
AUDIO = BASE / "audio"


def run(cmd, desc=""):
    r = subprocess.run(cmd, capture_output=True, encoding="utf-8", errors="ignore")
    if r.returncode != 0 and r.stderr:
        print(f"[WARN] {desc}: {r.stderr[-400:]}")
    return r


def compose(out: Path, video_inputs: list, xfade_offsets: list, voice: Path, music: Path, title=None) -> None:
    """
    video_inputs: list of Path (the scene mp4s in order)
    xfade_offsets: list of floats, length = len(video_inputs)-1
      offset[i] = time in the i-th video where the crossfade to (i+1) starts
    """
    n = len(video_inputs)
    if len(xfade_offsets) != n - 1:
        raise ValueError("xfade_offsets must have length n-1")

    # Build filter_complex
    # labels: v0 v1 v2 ... vn-1 (from inputs), intermediate v01 v012 ... vout
    fc = []
    prev = "0:v"
    for i in range(n - 1):
        cur = f"{i+1}:v"
        out_label = f"v{i}{i+1}" if i < n - 2 else "vout"
        fc.append(f"[{prev}][{cur}]xfade=transition=fade:duration=0.5:offset={xfade_offsets[i]}[{out_label}]")
        prev = out_label
    # Audio: voice + music
    fc.append(f"[{n}:a]volume=0.95,aresample=44100[voice]")
    fc.append(f"[{n+1}:a]volume=0.28,aresample=44100[music]")
    fc.append(f"[voice][music]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]")
    filter_complex = ";\n".join(fc)

    cmd = ["ffmpeg", "-y"]
    for v in video_inputs:
        cmd.extend(["-i", str(v)])
    cmd.extend(["-i", str(voice), "-i", str(music)])
    cmd.extend(["-filter_complex", filter_complex])
    cmd.extend(["-map", "[vout]", "-map", "[aout]"])
    cmd.extend(["-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p"])
    cmd.extend(["-c:a", "aac", "-b:a", "192k", "-ar", "44100"])
    cmd.extend(["-movflags", "+faststart"])
    cmd.extend(["-t", "78"])
    cmd.append(str(out))

    print(f"Composing {out.name} ... ", end="", flush=True)
    run(cmd, out.name)
    if out.exists() and out.stat().st_size > 1000:
        print(f"OK {out.stat().st_size/1024/1024:.1f}MB")
    else:
        print("FAILED")


voice = AUDIO / "voiceover.mp3"
music = AUDIO / "background_loop.mp3"

# === Personal version: 7 content scenes + 11s closing ===
# 7×10s + 1s extra for S7 (11s) = 71s, with 6 crossfades × 0.5s = 68s
# + 11s personal closing = 79s (slight over, trimmed to 78)
personal_videos = [
    SCENES / "S1_hook.mp4",
    SCENES / "S2_intro.mp4",
    SCENES / "S3_record.mp4",
    SCENES / "S4_weekly.mp4",
    SCENES / "S5_privacy.mp4",
    SCENES / "S6_daily.mp4",
    SCENES / "S7_closing.mp4",
    SCENES / "S8_closing_personal.mp4",
]
# offsets: each video plays until offset+0.5 of the next
# S1(10) - 0.5 = 9.5; S2(10) - 0.5 = 19; ... S6(10) - 0.5 = 57; S7(11) - 0.5 = 66.5
personal_offsets = [9.5, 19, 28.5, 38, 47.5, 57, 66.5]
compose(BASE / "intro_personal.mp4", personal_videos, personal_offsets, voice, music)

# === Contest version: 5s opening + 7 content + 6s closing ===
contest_videos = [
    SCENES / "S0_opening_contest.mp4",
    SCENES / "S1_hook.mp4",
    SCENES / "S2_intro.mp4",
    SCENES / "S3_record.mp4",
    SCENES / "S4_weekly.mp4",
    SCENES / "S5_privacy.mp4",
    SCENES / "S6_daily.mp4",
    SCENES / "S7_closing.mp4",
    SCENES / "S8_closing_contest.mp4",
]
# opening(5) - 0.5 = 4.5; S1(10) - 0.5 = 14; S2(10) - 0.5 = 23.5; S3(10) - 0.5 = 33;
# S4(10) - 0.5 = 42.5; S5(10) - 0.5 = 52; S6(10) - 0.5 = 61.5; S7(11) - 0.5 = 71
contest_offsets = [4.5, 14, 23.5, 33, 42.5, 52, 61.5, 71]
compose(BASE / "intro_contest.mp4", contest_videos, contest_offsets, voice, music)

print("\nBoth versions generated.")
