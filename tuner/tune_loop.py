#!/usr/bin/env python3
"""
EAA Tune Loop - 持续优化循环
对标 DeepFinance 的 tune() 入口

每天自动运行：
1. 评估所有Agent输出
2. 汇总评分
3. 生成改进建议
4. 反馈到Agent prompt

用法: python3 tune_loop.py
"""

import json
import os
import sys
from datetime import datetime

sys.path.insert(0, "/root/.copaw/tuner/judge")
from judge_engine import evaluate

OUTPUT_DIR = "/root/.copaw/data_archive/agent_outputs"
REPORT_DIR = "/root/.copaw/tuner/reports"


def tune():
    """主优化循环"""
    os.makedirs(REPORT_DIR, exist_ok=True)

    results = []
    today = datetime.now().strftime("%Y-%m-%d")

    # 扫描所有Agent输出文件
    for filename in os.listdir(OUTPUT_DIR):
        if not filename.endswith(".json"):
            continue

        filepath = os.path.join(OUTPUT_DIR, filename)

        # 只评估今天或最近的文件
        try:
            with open(filepath) as f:
                data = json.load(f)
            # 跳过格式不同的旧文件
            if isinstance(data, dict) and ("date" in data or "推送时间" in data):
                result = evaluate(filepath)
                result["filename"] = filename
                results.append(result)
        except Exception:
            continue

    # 生成汇总报告
    report = {
        "date": today,
        "eval_time": datetime.now().isoformat(),
        "total_evaluated": len(results),
        "results": results,
    }

    # 评分统计
    if results:
        rewards = [r["reward"] for r in results if "reward" in r]
        report["avg_reward"] = round(sum(rewards) / len(rewards), 3) if rewards else 0
        report["grade_distribution"] = {
            "A": sum(1 for r in results if r.get("grade") == "A"),
            "B": sum(1 for r in results if r.get("grade") == "B"),
            "C": sum(1 for r in results if r.get("grade") == "C"),
            "D": sum(1 for r in results if r.get("grade") == "D"),
        }

    # 保存报告
    report_path = os.path.join(REPORT_DIR, f"tune_{today}.json")
    with open(report_path, "w") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    # 输出摘要
    print("=" * 50)
    print("EAA Tune Loop 每日评估报告")
    print("=" * 50)
    print("日期: " + today)
    print("评估文件数: " + str(len(results)))

    if results:
        print("平均分: " + str(report["avg_reward"]))
        print("等级分布: " + json.dumps(report["grade_distribution"], ensure_ascii=False))
        print("")

        for r in sorted(results, key=lambda x: x.get("reward", 0)):
            grade = r.get("grade", "?")
            reward = r.get("reward", 0)
            name = r.get("file", "?")[:30]
            print("  [" + grade + "] " + name + " - " + str(reward))

    print("")
    print("报告已保存: " + report_path)

    return report


if __name__ == "__main__":
    tune()
