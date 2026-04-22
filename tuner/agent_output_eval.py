#!/usr/bin/env python3
"""Agent输出质量评估脚本"""
import json, sys, os
from datetime import datetime

FABRICATED = ["出勤率", "作业完成率", "考试成绩", "课堂表现评分", "家长满意度", "违纪减少比例"]

def evaluate(filepath):
    r = {"file": filepath, "eval_time": datetime.now().isoformat(), "score": 0, "max": 5, "issues": []}
    try:
        with open(filepath) as f:
            data = json.load(f)
        r["score"] += 1
    except Exception:
        r["issues"].append("JSON解析失败")
        return r
    
    s = json.dumps(data, ensure_ascii=False)
    if any(k in str(data) for k in ["date", "agent"]):
        r["score"] += 1
    else:
        r["issues"].append("缺少date/agent字段")

    if any(k in s for k in ["eaa", "飞书", "CLI", "学生档案"]):
        r["score"] += 1
    else:
        r["issues"].append("未标注数据来源")

    fab = [k for k in FABRICATED if k in s]
    if not fab:
        r["score"] += 1
    else:
        r["issues"].append("疑似编造: " + str(fab))

    if len(s) > 50:
        r["score"] += 1
    else:
        r["issues"].append("内容过少")

    return r

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python3 agent_output_eval.py <file>")
        sys.exit(1)
    r = evaluate(sys.argv[1])
    name = os.path.basename(sys.argv[1])
    if r["issues"]:
        print("Warning: " + name + ": " + str(r["score"]) + "/" + str(r["max"]))
        for i in r["issues"]:
            print("  - " + i)
    else:
        print("OK: " + name + ": " + str(r["score"]) + "/" + str(r["max"]))
