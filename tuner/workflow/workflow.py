#!/usr/bin/env python3
"""
EAA Workflow - Agent工作流定义
对标 DeepFinance 的 run_deep_finance

定义每个Agent的标准化工作流程：
1. 两阶段工作法（先规划再执行）
2. 工具调用统计
3. 输出格式规范化
"""

import json
import subprocess
import os
from datetime import datetime

EAA_DATA_DIR = "/vol2/copaw-data/data"
OUTPUT_DIR = "/root/.copaw/data_archive/agent_outputs"


def eaa(*args):
    """调用eaa CLI"""
    env = os.environ.copy()
    env["EAA_DATA_DIR"] = EAA_DATA_DIR
    result = subprocess.run(["eaa"] + list(args), capture_output=True, text=True, timeout=10, env=env)
    return result.stdout.strip()


class WorkflowOutput:
    """工作流输出"""
    def __init__(self, agent_name, data, tool_calls=0):
        self.agent = agent_name
        self.data = data
        self.tool_calls = tool_calls
        self.timestamp = datetime.now().isoformat()

    def save(self):
        """保存到标准输出位置"""
        filepath = os.path.join(OUTPUT_DIR, f"{self.agent}.json")
        output = {
            "date": datetime.now().strftime("%Y-%m-%d"),
            "agent": self.agent,
            "timestamp": self.timestamp,
            "tool_calls": self.tool_calls,
            "data_source": "eaa CLI",
            **self.data,
        }
        with open(filepath, "w") as f:
            json.dump(output, f, ensure_ascii=False, indent=2)
        return filepath


# ============================================================
# 各Agent工作流定义
# ============================================================

def run_supervisor_evening():
    """督导复盘工作流（对标 DeepFinance 的 run_deep_finance）"""
    tool_calls = 0

    # === 第一阶段：信息收集（先大纲后调研）===
    # 大纲：检查全班52人风险等级

    # Step 1: 获取排行
    ranking_raw = eaa("ranking", "52")
    tool_calls += 1
    ranking = []
    for line in ranking_raw.split("\n")[2:]:  # 跳过表头
        parts = line.split()
        if len(parts) >= 3:
            ranking.append({"rank": parts[0], "name": parts[1], "score": parts[2]})

    # Step 2: 获取近7天事件
    today = datetime.now().strftime("%Y-%m-%d")
    week_ago = (datetime.now().__class__.__subclasses__()[0](datetime.now().timestamp() - 7*86400)).strftime("%Y-%m-%d") if False else ""
    import datetime as dt
    week_ago = (dt.datetime.now() - dt.timedelta(days=7)).strftime("%Y-%m-%d")
    events_raw = eaa("range", week_ago, today, "--limit", "200")
    tool_calls += 1

    # Step 3: 获取统计
    stats_raw = eaa("stats")
    tool_calls += 1

    # === 第二阶段：深度分析 ===
    risk_categories = {"高风险": [], "中风险": [], "低风险": []}

    for student in ranking:
        try:
            score = float(student["score"])
        except (ValueError, KeyError):
            continue

        if score < 85:
            risk_categories["高风险"].append(student["name"])
        elif score <= 93:
            risk_categories["中风险"].append(student["name"])
        else:
            risk_categories["低风险"].append(student["name"])

    result = {
        "risk_stats": {
            "high": len(risk_categories["高风险"]),
            "medium": len(risk_categories["中风险"]),
            "low": len(risk_categories["低风险"]),
            "total": len(ranking),
        },
        "high_risk_students": risk_categories["高风险"],
        "medium_risk_students": risk_categories["中风险"],
        "ranking_top5": ranking[:5],
        "ranking_bottom5": ranking[-5:] if len(ranking) >= 5 else ranking,
    }

    output = WorkflowOutput("governor_evening", result, tool_calls)
    return output.save()


def run_morning_push():
    """早间推送工作流"""
    tool_calls = 0

    # Step 1: 全班排行
    ranking_raw = eaa("ranking", "52")
    tool_calls += 1
    ranking = []
    for line in ranking_raw.split("\n")[2:]:
        parts = line.split()
        if len(parts) >= 3:
            ranking.append({"name": parts[1], "score": parts[2]})

    # Step 2: 近7天事件
    import datetime as dt
    today = dt.datetime.now().strftime("%Y-%m-%d")
    week_ago = (dt.datetime.now() - dt.timedelta(days=7)).strftime("%Y-%m-%d")
    events_raw = eaa("range", week_ago, today, "--limit", "100")
    tool_calls += 1

    # Step 3: 末位学生
    bottom = [s for s in ranking if float(s.get("score", 100)) < 90]

    # Step 4: 中高风险学生
    at_risk = [s for s in ranking if float(s.get("score", 100)) <= 93]

    result = {
        "total_students": len(ranking),
        "at_risk_students": at_risk,
        "bottom_students": bottom,
        "recent_events_count": len([l for l in events_raw.split("\n") if l.strip() and not l.startswith("-") and not l.startswith("2026")]),
    }

    output = WorkflowOutput("main_morning", result, tool_calls)
    return output.save()


if __name__ == "__main__":
    import sys
    workflow = sys.argv[1] if len(sys.argv) > 1 else "supervisor_evening"

    if workflow == "supervisor_evening":
        path = run_supervisor_evening()
        print("OK: governor_evening saved to " + path)
    elif workflow == "morning_push":
        path = run_morning_push()
        print("OK: main_morning saved to " + path)
    else:
        print("Usage: python3 workflow.py [supervisor_evening|morning_push]")
