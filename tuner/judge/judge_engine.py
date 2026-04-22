#!/usr/bin/env python3
"""
EAA Judge Engine - 多维度评估引擎
对标 DeepFinance 的 DeepFinanceJudgeEngine

评估每个Agent输出的质量，生成reward分数。

用法: python3 judge_engine.py <agent_output.json>
"""

import json
import sys
import os
import subprocess
from datetime import datetime, timedelta

# === 权重配置 ===
WEIGHTS = {
    "data_accuracy": 0.40,
    "analysis_sufficiency": 0.25,
    "presentation_quality": 0.15,
    "data_timeliness": 0.10,
    "tool_penalty": 0.10,
}

# 编造检测关键词
FABRICATED_KEYWORDS = [
    "出勤率", "作业完成率", "考试成绩", "课堂表现评分",
    "家长满意度", "违纪减少比例", "课堂参与度",
    "%的同学", "%学生", "提升%", "降低%",
]

# 已知真实数据（用于交叉验证）
KNOWN_FACTS = {
    "学生总数": 52,
    "事件总数": 167,
    "最高分": ("罗韫", 111.0),
    "最低分": ("王勇", 80.0),
}


def run_eaa(*args):
    """调用eaa CLI获取真实数据"""
    env = os.environ.copy()
    env["EAA_DATA_DIR"] = "/vol2/copaw-data/data"
    try:
        result = subprocess.run(
            ["eaa"] + list(args),
            capture_output=True, text=True, timeout=10, env=env
        )
        return result.stdout.strip()
    except Exception:
        return ""


def check_accuracy(output_str, output_data):
    """维度1：数据准确性"""
    score = 0.5  # 基础分
    issues = []

    # 检查编造数据
    fabricated = [kw for kw in FABRICATED_KEYWORDS if kw in output_str]
    if fabricated:
        score -= 0.3 * len(fabricated)
        issues.append("疑似编造: " + ", ".join(fabricated))

    # 检查学生总数
    for fact_name, fact_val in KNOWN_FACTS.items():
        if fact_name in output_str:
            if isinstance(fact_val, int) and str(fact_val) not in output_str:
                # 可能不一致
                pass

    # 检查数据来源标注
    has_source = any(kw in output_str for kw in ["eaa", "CLI", "飞书", "学生档案", "Bitable"])
    if has_source:
        score += 0.2
    else:
        issues.append("未标注数据来源")
        score -= 0.1

    return max(0, min(1, score)), issues


def check_sufficiency(output_str, output_data):
    """维度2：分析充分性"""
    score = 0.0
    issues = []

    # 是否提到了风险分级
    if any(kw in output_str for kw in ["高风险", "中风险", "低风险"]):
        score += 0.25

    # 是否有具体学生名字
    import re
    names_found = len(re.findall(r'[\u4e00-\u9fff]{2,4}', output_str))
    if names_found > 5:
        score += 0.25
    elif names_found > 0:
        score += 0.1
    else:
        issues.append("未提及具体学生")

    # 是否有建议
    if any(kw in output_str for kw in ["建议", "关注", "谈话", "跟进"]):
        score += 0.25
    else:
        issues.append("无具体建议")

    # 是否有事件分析
    if any(kw in output_str for kw in ["事件", "扣分", "违纪", "加分"]):
        score += 0.25
    else:
        issues.append("无事件分析")

    return max(0, min(1, score)), issues


def check_presentation(output_str, output_data):
    """维度3：呈现质量"""
    score = 0.0
    issues = []

    # 有分节结构
    if any(kw in output_str for kw in ["##", "---", "|", "━"]):
        score += 0.25
    else:
        issues.append("缺少结构化格式")

    # 无技术术语
    tech_terms = ["JSON", "Cron", "Agent", "CLI", "API", "Git", "cron", "payload"]
    found_tech = [t for t in tech_terms if t in output_str]
    if not found_tech:
        score += 0.25
    else:
        issues.append("包含技术术语: " + ", ".join(found_tech[:3]))

    # 只有学生相关内容
    system_terms = ["系统优化", "升级", "部署", "模块联动", "编译"]
    found_sys = [t for t in system_terms if t in output_str]
    if not found_sys:
        score += 0.25
    else:
        issues.append("包含系统技术内容")

    # 长度适中
    if 100 < len(output_str) < 5000:
        score += 0.25
    elif len(output_str) >= 5000:
        issues.append("内容过长")
    else:
        issues.append("内容过少")

    return max(0, min(1, score)), issues


def check_timeliness(output_str, output_data):
    """维度4：数据时效性"""
    score = 0.5
    issues = []
    today = datetime.now().strftime("%Y-%m-%d")

    # 检查是否包含今日日期
    if today in output_str:
        score += 0.3
    else:
        issues.append("未包含今日日期")

    # 检查是否引用了旧数据
    three_days_ago = (datetime.now() - timedelta(days=3)).strftime("%Y-%m-%d")
    week_ago = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")

    if week_ago in output_str and today not in output_str:
        score -= 0.3
        issues.append("仅引用7天前旧数据")

    return max(0, min(1, score)), issues


def check_tool_usage(output_data):
    """维度5：工具调用惩罚"""
    output_str = json.dumps(output_data, ensure_ascii=False)
    score = 0.0

    # 检查是否调用了eaa CLI（通过输出中的数据特征判断）
    eaa_indicators = ["evt_", "reason_code", "score_delta", "entity_id"]
    found = sum(1 for ind in eaa_indicators if ind in output_str)

    if found >= 2:
        score = 1.0  # ≥3次工具调用，无惩罚
    elif found >= 1:
        score = 0.5  # 1-2次
    else:
        score = 0.0  # 0次，最大惩罚

    return score, []


def evaluate(filepath):
    """主评估函数"""
    # 读取输出
    try:
        with open(filepath) as f:
            raw = f.read()
        data = json.loads(raw)
    except Exception as e:
        return {"reward": 0.0, "error": str(e), "file": filepath}

    output_str = json.dumps(data, ensure_ascii=False) if isinstance(data, dict) else str(data)

    # 运行5个维度评估
    results = {}
    all_issues = []

    checks = [
        ("data_accuracy", lambda: check_accuracy(output_str, data)),
        ("analysis_sufficiency", lambda: check_sufficiency(output_str, data)),
        ("presentation_quality", lambda: check_presentation(output_str, data)),
        ("data_timeliness", lambda: check_timeliness(output_str, data)),
        ("tool_penalty", lambda: check_tool_usage(data)),
    ]

    for name, check_fn in checks:
        score, issues = check_fn()
        results[name] = {"score": round(score, 2), "issues": issues}
        all_issues.extend(issues)

    # 计算加权总分
    reward = sum(results[k]["score"] * WEIGHTS[k] for k in WEIGHTS)

    return {
        "file": os.path.basename(filepath),
        "eval_time": datetime.now().isoformat(),
        "reward": round(reward, 3),
        "scores": results,
        "issues": all_issues,
        "grade": "A" if reward >= 0.8 else "B" if reward >= 0.6 else "C" if reward >= 0.4 else "D",
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python3 judge_engine.py <agent_output.json>")
        sys.exit(1)

    result = evaluate(sys.argv[1])
    grade = result["grade"]
    reward = result["reward"]

    print("=" * 50)
    print("EAA Judge Engine 评估报告")
    print("=" * 50)
    print("文件: " + result["file"])
    print("总分: " + str(reward) + " (" + grade + ")")
    print("")

    for dim, info in result["scores"].items():
        status = "OK" if not info["issues"] else "WARN"
        print("  " + dim + ": " + str(info["score"]) + " [" + status + "]")
        for issue in info["issues"]:
            print("    - " + issue)

    if result["issues"]:
        print("")
        print("需改进项:")
        for issue in result["issues"]:
            print("  ! " + issue)
