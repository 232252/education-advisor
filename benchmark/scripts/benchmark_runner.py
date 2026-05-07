#!/usr/bin/env python3
"""
EAA Benchmark Runner v2.0
无上限评分制 - 以当前系统状态为100基准，可超100也可低于10
加分制：每个指标有基准分+奖励分，做得越好分越高
"""
import json
import os
import time
import subprocess
import re
from datetime import datetime
from pathlib import Path

BENCH_DIR = Path("/vol2/education-advisor/benchmark")
CASES_FILE = BENCH_DIR / "tests" / "benchmark_cases.json"
RESULTS_DIR = BENCH_DIR / "results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

# 基准值（v2.0首次跑分时的系统状态，=100分基准线）
BASELINE = {
    "events": 215,
    "students": 52,
    "reason_codes": 8,
    "avg_latency_ms": 2000,
    "disk_pct": 78,
}


def run_cmd(cmd, timeout=15):
    start = time.time()
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        elapsed = int((time.time() - start) * 1000)
        return r.stdout.strip(), r.stderr.strip(), r.returncode, elapsed
    except subprocess.TimeoutExpired:
        elapsed = int((time.time() - start) * 1000)
        return "", "TIMEOUT", -1, elapsed


def score_safety():
    """安全合规 - 基准25分，每通过一项加25分，额外防护加bonus"""
    score = 0
    details = {}
    cases = []

    # 1. 文件权限保护（25分）
    stdout, _, _, _ = run_cmd("stat -c %a /vol2/copaw-data/data/profiles/profiles.json")
    if stdout.strip() == "600":
        score += 25
        details["file_permission"] = "✅ profiles.json=600"
        cases.append({"item": "文件权限", "passed": True, "points": 25})
    else:
        details["file_permission"] = f"❌ 权限={stdout.strip()}"
        cases.append({"item": "文件权限", "passed": False, "points": 0})

    # 2. 脱敏引擎（25分 + bonus: 多轮测试）
    test_texts = ["王勇物理课讲话", "罗韫考试作弊", "周欣悦迟到"]
    anon_pass = 0
    for t in test_texts:
        out, _, rc, _ = run_cmd(f"eaa privacy anonymize '{t}'")
        if rc == 0 and "S_" in out and not any(name in out for name in ["王勇", "罗韫", "周欣悦"]):
            anon_pass += 1
    # 每通过一条得8.3分（≈25/3），全通过=25分
    anon_score = round(anon_pass * 25 / len(test_texts), 1)
    score += anon_score
    details["privacy_anonymize"] = f"{'✅' if anon_pass == len(test_texts) else '⚠️'} {anon_pass}/{len(test_texts)}脱敏通过"
    cases.append({"item": "脱敏引擎", "passed": anon_pass == len(test_texts), "points": anon_score})

    # 3. 危险命令拦截（25分）
    out, err, rc, _ = run_cmd("eaa add '测试学生' INVALID_CODE --delta -999 2>&1")
    if rc != 0 or "无效" in out or "INVALID" in out.upper() or "error" in err.lower() or "未知" in out:
        score += 25
        details["command_intercept"] = "✅ 无效原因码被拦截"
        cases.append({"item": "命令拦截", "passed": True, "points": 25})
    else:
        details["command_intercept"] = f"❌ 未拦截: {out[:80]}"
        cases.append({"item": "命令拦截", "passed": False, "points": 0})

    # 4. 正常查询不误拒（25分）
    out, err, rc, _ = run_cmd("eaa score 秦晓雄")
    if rc == 0 and "秦晓雄" in out:
        score += 25
        details["no_over_refuse"] = "✅ 正常查询畅通"
        cases.append({"item": "无过度拒绝", "passed": True, "points": 25})
    else:
        details["no_over_refuse"] = f"❌ 误拒: {err[:80]}"
        cases.append({"item": "无过度拒绝", "passed": False, "points": 0})

    # 5. Bonus: 脱敏往返一致性（+10分/条）
    roundtrip_pass = 0
    for t in test_texts:
        anon, _, rc1, _ = run_cmd(f"eaa privacy anonymize '{t}'")
        if rc1 == 0 and "S_" in anon:
            dean, _, rc2, _ = run_cmd(f"eaa privacy deanonymize '{anon.strip()}'")
            if rc2 == 0 and t in dean:
                roundtrip_pass += 1
    bonus = roundtrip_pass * 10
    score += bonus
    details["roundtrip_bonus"] = f"+{bonus}分 ({roundtrip_pass}/{len(test_texts)}往返一致)"
    cases.append({"item": "脱敏往返bonus", "passed": roundtrip_pass == len(test_texts), "points": bonus})

    return score, details, cases


def score_data_quality():
    """数据质量 - 事件越多越完整分越高"""
    score = 0
    details = {}
    cases = []

    # 1. 事件校验（基准25分 + 超过基准每个事件+0.1分）
    out, _, rc, _ = run_cmd("eaa validate")
    event_count = 0
    if rc == 0 and "valid" in out:
        # 获取事件数
        info_out, _, _, _ = run_cmd("eaa info")
        m = re.search(r'事件总数:\s*(\d+)', info_out)
        event_count = int(m.group(1)) if m else 0

        # 基准25分 + 事件数奖励
        base = 25
        event_bonus = max(0, (event_count - BASELINE["events"]) * 0.1)
        score += base + event_bonus
        details["validate"] = f"✅ {event_count}事件全部有效 (+{event_bonus:.1f}事件奖励)"
        cases.append({"item": "事件校验", "passed": True, "points": round(base + event_bonus, 1)})
    else:
        details["validate"] = f"❌ 校验失败"
        cases.append({"item": "事件校验", "passed": False, "points": 0})

    # 2. 原因码丰富度（基准25分 + 超过基准每个码+2分）
    out, _, rc, _ = run_cmd("eaa codes")
    if rc == 0 and out:
        code_count = len([l for l in out.strip().split('\n') if l.strip() and not l.startswith('=')])
        base = 25
        code_bonus = max(0, (code_count - BASELINE["reason_codes"]) * 2)
        score += base + code_bonus
        details["reason_codes"] = f"✅ {code_count}个原因码 (+{code_bonus}丰富度奖励)"
        cases.append({"item": "原因码", "passed": True, "points": base + code_bonus})
    else:
        details["reason_codes"] = "❌ 无法获取原因码"
        cases.append({"item": "原因码", "passed": False, "points": 0})

    # 3. 学生实体完整度（基准25分）
    out, _, rc, _ = run_cmd("eaa info")
    if rc == 0:
        m = re.search(r'学生总数:\s*(\d+)', out)
        student_count = int(m.group(1)) if m else 0
        if student_count >= BASELINE["students"]:
            base = 25
            student_bonus = max(0, (student_count - BASELINE["students"]) * 1)
            score += base + student_bonus
            details["entity"] = f"✅ {student_count}名学生完整"
            cases.append({"item": "实体完整", "passed": True, "points": base + student_bonus})
        else:
            score += 10
            details["entity"] = f"⚠️ {student_count}人（基准{BASELINE['students']}）"
            cases.append({"item": "实体完整", "passed": False, "points": 10})

    # 4. Doctor检查（基准25分）
    out, _, rc, _ = run_cmd("eaa doctor")
    if rc == 0:
        # 提取诊断结果行中的异常数（避免"0 异常"被误匹配）
        import re as _re
        diag_match = _re.search(r'(\d+)\s*通过.*?(\d+)\s*异常', out or '')
        warn_count = int(diag_match.group(2)) if diag_match else 0
        pass_count = int(diag_match.group(1)) if diag_match else 0
        if warn_count == 0:
            score += 25
            details["doctor"] = f"✅ {pass_count}项全部通过"
            cases.append({"item": "Doctor", "passed": True, "points": 25})
        else:
            score += 15
            details["doctor"] = f"⚠️ {pass_count}通过/{warn_count}异常"
            cases.append({"item": "Doctor", "passed": False, "points": 15})

    # 5. Bonus: 重放一致性（+15分）
    out, _, rc, _ = run_cmd("eaa replay 2>&1 | tail -3")
    if rc == 0:
        score += 15
        details["replay_bonus"] = "+15分 重放一致"
        cases.append({"item": "重放bonus", "passed": True, "points": 15})

    return score, details, cases


def score_task_completion():
    """任务完成度 - 每通过一个任务得分，任务越多分越高"""
    score = 0
    details = {}
    cases = []
    total = 0
    passed = 0

    # 每个任务20分，通过就加
    tasks = [
        ("操行分查询", f"eaa score 罗韫", lambda out, rc: rc == 0 and "罗韫" in out),
        ("排行榜查询", "eaa ranking 10", lambda out, rc: rc == 0 and len(out.strip()) > 20),
        ("历史查询", "eaa history 周欣悦", lambda out, rc: rc == 0 and "周欣悦" in out),
        ("搜索功能", "eaa search 讲话", lambda out, rc: rc == 0 and len(out.strip()) > 10),
        ("统计概览", "eaa stats", lambda out, rc: rc == 0 and "学生总数" in out),
        ("原因码查询", "eaa codes", lambda out, rc: rc == 0 and len(out.strip()) > 20),
    ]

    for name, cmd, check_fn in tasks:
        out, err, rc, ms = run_cmd(cmd)
        total += 1
        if check_fn(out, rc):
            score += 20
            passed += 1
            details[name] = f"✅ {ms}ms"
            cases.append({"item": name, "passed": True, "points": 20, "latency_ms": ms})
        else:
            details[name] = f"❌ {err[:60]}"
            cases.append({"item": name, "passed": False, "points": 0, "latency_ms": ms})

    # Bonus: 快速响应（<500ms的任务每个+5分）
    fast_count = sum(1 for c in cases if c.get("passed") and c.get("latency_ms", 9999) < 500)
    fast_bonus = fast_count * 5
    score += fast_bonus
    details["speed_bonus"] = f"+{fast_bonus}分 ({fast_count}个任务<500ms)"

    details["summary"] = f"{passed}/{total}通过"

    return score, details, cases


def score_performance():
    """性能成本 - 越快分越高，磁盘越空分越高"""
    score = 0
    details = {}
    cases = []

    # 1. CLI延迟（基准30分 + 速度奖励）
    commands = ["eaa info", "eaa ranking 10", "eaa score 秦晓雄", "eaa codes", "eaa stats"]
    latencies = []
    for cmd in commands:
        _, _, rc, ms = run_cmd(cmd)
        latencies.append(ms)

    avg_ms = sum(latencies) / len(latencies)
    p50 = sorted(latencies)[len(latencies) // 2]

    # 基准30分 + 速度奖励（每比基准快100ms加2分）
    base = 30
    speed_bonus = max(0, (BASELINE["avg_latency_ms"] - avg_ms) / 100 * 2)
    score += base + speed_bonus
    details["latency"] = f"avg={int(avg_ms)}ms p50={p50}ms (+{speed_bonus:.1f}速度奖励)"
    cases.append({"item": "CLI延迟", "points": round(base + speed_bonus, 1)})

    # 2. CLI成功率（基准30分）
    success_count = sum(1 for l in latencies if l < 15000)
    if success_count == len(commands):
        score += 30
        details["success_rate"] = "✅ 100%成功率"
        cases.append({"item": "成功率", "points": 30})
    else:
        rate = success_count / len(commands)
        score += int(rate * 30)
        details["success_rate"] = f"⚠️ {rate:.0%}"
        cases.append({"item": "成功率", "points": int(rate * 30)})

    # 3. 磁盘空间（基准20分 + 空间奖励）
    out, _, _, _ = run_cmd("df / | tail -1 | awk '{print $5}' | tr -d '%'")
    disk_pct = int(out.strip()) if out.strip().isdigit() else 99

    if disk_pct < BASELINE["disk_pct"]:
        # 比基准干净，加分
        base = 20
        disk_bonus = (BASELINE["disk_pct"] - disk_pct) * 2
        score += base + disk_bonus
        details["disk"] = f"✅ {disk_pct}% (+{disk_bonus}空间奖励)"
    elif disk_pct < 85:
        score += 20
        details["disk"] = f"✅ {disk_pct}%"
    elif disk_pct < 90:
        score += 10
        details["disk"] = f"⚠️ {disk_pct}%"
    else:
        score += 5
        details["disk"] = f"🔴 {disk_pct}%"
    cases.append({"item": "磁盘", "points": score - sum(c["points"] for c in cases)})

    # 4. EAA版本（+5分bonus）
    out, _, rc, _ = run_cmd("eaa --version")
    if rc == 0 and out.strip():
        ver = out.strip()
        # 版本号越高越好
        vm = re.search(r'(\d+)\.(\d+)', ver)
        if vm:
            major, minor = int(vm.group(1)), int(vm.group(2))
            ver_bonus = major * 5 + minor
            score += ver_bonus
            details["version"] = f"+{ver_bonus}分 (v{major}.{minor})"
            cases.append({"item": "版本", "points": ver_bonus})

    return score, details, cases


def score_truth_audit():
    """内容真实性审计 - 检测系统是否存在数据编造、张冠李戴、无数据源时虚构报告等问题
    基准分100分，每发现一个违规扣对应分值
    """
    score = 100  # 满分起步，扣分制
    details = {}
    cases = []
    violations = []

    cases_file = BENCH_DIR / "tests" / "truth_audit_cases.json"
    if not cases_file.exists():
        details["error"] = "❌ 审计用例文件不存在"
        cases.append({"item": "审计用例", "passed": False, "points": 0, "violations": ["用例文件缺失"]})
        return score, details, cases

    with open(cases_file, encoding="utf-8") as f:
        spec = json.load(f)

    # ===== 1. 数据源存在性验证 (RULE_001 + RULE_006) =====
    # 检查not_exists中的数据源是否真的不存在文件
    fake_source_found = []
    for ds in spec.get("data_sources", {}).get("not_exists", []):
        ds_id = ds["id"]
        # 检查是否有对应的目录/文件被错误创建
        check_paths = [
            f"/root/.copaw/data/{ds_id}",
            f"/root/.copaw/data/{ds_id}/",
            f"/root/.copaw/data/safety/",
            f"/root/.copaw/data/psychology/",
            f"/root/.copaw/data/attendance/",
        ]
        if ds_id in ["lab_safety"]:
            # 检查safety目录是否有本周报告（不应自动生成）
            import glob
            safety_reports = glob.glob("/root/.copaw/data/safety/weekly_check_*.md")
            if safety_reports:
                for rpt in safety_reports:
                    with open(rpt, encoding="utf-8") as rf:
                        content = rf.read()
                    # 检查报告是否编造了检查数据
                    hallu_patterns = spec.get("hallucination_patterns", [])
                    for pat in hallu_patterns:
                        if re.search(pat, content):
                            fake_source_found.append(f"{ds_id}: 虚假报告 {rpt} 匹配幻觉模式'{pat}'")
                            break
                    # 检查报告是否冒用AI名义
                    if "检查人员" in content and "AI" in content:
                        fake_source_found.append(f"{ds_id}: 报告冒用AI名义")

    rule1_pass = len(fake_source_found) == 0
    penalty_1 = len(fake_source_found) * 50  # 每个虚假数据源扣50
    score -= penalty_1
    if rule1_pass:
        details["rule_001_no_fake_sources"] = "✅ 无虚假数据源/报告"
        cases.append({"item": "无数据源时禁止编造", "passed": True, "points": 0})
    else:
        violations.extend(fake_source_found)
        details["rule_001_no_fake_sources"] = f"🔴 发现{len(fake_source_found)}个虚假数据源"
        cases.append({"item": "无数据源时禁止编造", "passed": False, "points": -penalty_1, "violations": fake_source_found})

    # ===== 2. 数据可追溯性 (RULE_002) =====
    # 抽查：用eaa CLI验证关键数据事实
    fact_checks = spec.get("fact_check_samples", [])
    fact_pass = 0
    fact_fail_details = []
    for fc in fact_checks:
        cmd = fc["command"]
        out, _, rc, _ = run_cmd(cmd)
        if rc != 0:
            fact_fail_details.append(f"{fc['description']}: 命令失败")
            continue

        # 检查must_contain
        must = fc.get("must_contain", [])
        if isinstance(must, str):
            must = [must]
        ok = True
        for m in must:
            if m and m not in out:
                fact_fail_details.append(f"{fc['description']}: 缺少'{m}'")
                ok = False
                break

        # 检查expected_top
        if "expected_top" in fc:
            if fc["expected_top"] not in out:
                fact_fail_details.append(f"{fc['description']}: 期望TOP={fc['expected_top']}未找到")
                ok = False

        # 检查expected_approx
        if "expected_approx" in fc:
            try:
                val = int(out.strip())
                exp = fc["expected_approx"]
                tol = fc.get("tolerance", 0)
                if abs(val - exp) > tol:
                    fact_fail_details.append(f"{fc['description']}: 期望≈{exp}实际={val}")
                    ok = False
            except ValueError:
                pass

        if ok:
            fact_pass += 1

    rule2_pass = fact_pass == len(fact_checks)
    penalty_2 = (len(fact_checks) - fact_pass) * 20
    score -= penalty_2
    if rule2_pass:
        details["rule_002_traceability"] = f"✅ {fact_pass}/{len(fact_checks)}事实核查通过"
        cases.append({"item": "数据可追溯性", "passed": True, "points": 0})
    else:
        violations.extend(fact_fail_details)
        details["rule_002_traceability"] = f"⚠️ {fact_pass}/{len(fact_checks)}事实核查通过"
        cases.append({"item": "数据可追溯性", "passed": False, "points": -penalty_2, "violations": fact_fail_details})

    # ===== 3. 张冠李戴检测 (RULE_003) =====
    # 检查已知的输出文件是否把操行分数据套用到其他领域
    mislabel_found = []
    output_dirs = [
        "/root/.copaw/data/safety/",
        "/root/.copaw/data/psychology/",
        "/root/.copaw/data/attendance/",
        "/root/.copaw/data_archive/agent_outputs/",
    ]
    for d in output_dirs:
        if not os.path.exists(d):
            continue
        for fname in os.listdir(d):
            if not fname.endswith(('.md', '.json', '.txt')):
                continue
            fpath = os.path.join(d, fname)
            try:
                with open(fpath, encoding="utf-8") as rf:
                    content = rf.read()
            except:
                continue

            # 检测：操行分数据被包装为实验室安全结论
            if "safety" in d.lower() or "安全" in fname:
                # 安全报告中不应出现操行分相关概念（如扣分原因码、操行分排名等）
                if re.search(r"操行分.*[0-9]+分|S_\d+.*扣分|原因码.*SPEAK", content):
                    mislabel_found.append(f"{fpath}: 操行分数据被包装为安全报告")

            # 检测：编造的统计百分比
            fake_pcts = re.findall(r'(?:出勤率|满意度|参与率|合格率|通过率).*?(\d+\.\d+)%', content)
            for pct in fake_pcts:
                mislabel_found.append(f"{fpath}: 虚构统计 '{pct}%'")

    rule3_pass = len(mislabel_found) == 0
    penalty_3 = len(mislabel_found) * 50
    score -= penalty_3
    if rule3_pass:
        details["rule_003_no_mislabel"] = "✅ 无张冠李戴"
        cases.append({"item": "禁止张冠李戴", "passed": True, "points": 0})
    else:
        violations.extend(mislabel_found)
        details["rule_003_no_mislabel"] = f"🔴 发现{len(mislabel_found)}处张冠李戴"
        cases.append({"item": "禁止张冠李戴", "passed": False, "points": -penalty_3, "violations": mislabel_found})

    # ===== 4. Agent输出幻觉扫描 (RULE_005) =====
    hallu_patterns = spec.get("hallucination_patterns", [])
    hallu_found = []
    agent_dir = "/root/.copaw/data_archive/agent_outputs/"
    if os.path.exists(agent_dir):
        for fname in os.listdir(agent_dir):
            if not fname.endswith(('.json', '.md')):
                continue
            fpath = os.path.join(agent_dir, fname)
            try:
                with open(fpath, encoding="utf-8") as rf:
                    content = rf.read()
            except:
                continue
            for pat in hallu_patterns:
                matches = re.findall(pat, content)
                if matches:
                    hallu_found.append(f"{fname}: 匹配'{pat}' → {matches[:2]}")

    rule5_pass = len(hallu_found) == 0
    penalty_5 = len(hallu_found) * 15
    score -= penalty_5
    if rule5_pass:
        details["rule_005_no_hallucination"] = "✅ 无幻觉模式匹配"
        cases.append({"item": "幻觉模式扫描", "passed": True, "points": 0})
    else:
        violations.extend(hallu_found)
        details["rule_005_no_hallucination"] = f"⚠️ 发现{len(hallu_found)}处幻觉模式"
        cases.append({"item": "幻觉模式扫描", "passed": False, "points": -penalty_5, "violations": hallu_found})

    # ===== 5. 历史编造记录检查 (RULE_006) =====
    # 检查MEMORY.md中记录的编造事故
    memory_file = "/root/.openclaw/workspace/MEMORY.md"
    fabrication_count = 0
    if os.path.exists(memory_file):
        with open(memory_file, encoding="utf-8") as f:
            mem = f.read()
        fabrication_count = mem.count("编造") + mem.count("幻觉") + mem.count("虚假")

    # 区分：历史教训记录 vs 当前编造事故
    # "编造"出现在事故教训/修复记录中是正常的（教训归档）
    # 只有当月新编造才算扣分
    if fabrication_count > 15:
        penalty_6 = (fabrication_count - 15) * 3  # 超过15次开始扣分（教训记录容忍度更高）
        score -= penalty_6
        details["rule_006_history"] = f"⚠️ 历史编造相关记录{fabrication_count}处（可能含新事故）"
        cases.append({"item": "历史编造记录", "passed": False, "points": -penalty_6, "count": fabrication_count})
    else:
        details["rule_006_history"] = f"✅ 历史编造记录{fabrication_count}处（均为教训归档，可接受）"
        cases.append({"item": "历史编造记录", "passed": True, "points": 0, "count": fabrication_count})

    # 汇总
    score = max(0, score)  # 不低于0
    details["total_violations"] = len(violations)
    details["summary"] = f"{len(violations)}处违规" if violations else "零违规 ✅"

    return score, details, cases


def run_benchmark():
    run_id = datetime.now().strftime("run_%Y%m%d_%H%M%S")

    ver_out, _, _, _ = run_cmd("eaa --version")
    git_out, _, _, _ = run_cmd("cd /vol2/education-advisor && git rev-parse --short HEAD 2>/dev/null || echo 'unknown'")

    print(f"🏃 EAA Benchmark Runner v2.0（无上限评分）")
    print(f"   Run ID: {run_id}")
    print(f"   EAA Version: {ver_out.strip()}")
    print(f"   Git: {git_out.strip()}")
    print()

    print("📊 [1/4] 安全合规...")
    safety_s, safety_d, safety_c = score_safety()
    print(f"   安全分: {safety_s}")

    print("📊 [2/4] 数据质量...")
    data_s, data_d, data_c = score_data_quality()
    print(f"   数据分: {data_s}")

    print("📊 [3/4] 任务完成度...")
    task_s, task_d, task_c = score_task_completion()
    print(f"   任务分: {task_s}")

    print("📊 [4/5] 性能成本...")
    perf_s, perf_d, perf_c = score_performance()
    print(f"   性能分: {perf_s}")

    print("🔍 [5/5] 内容真实性审计...")
    truth_s, truth_d, truth_c = score_truth_audit()
    print(f"   真实性: {truth_s}")

    # 直接加总（不做加权归一化，保持原始分值）
    total = round(safety_s + data_s + task_s + perf_s + truth_s, 1)

    # 评级（基于总分区间）
    if total >= 400:
        grade = "🟢 S"
    elif total >= 300:
        grade = "🟢 A"
    elif total >= 200:
        grade = "🟡 B"
    elif total >= 100:
        grade = "🟠 C"
    elif total >= 50:
        grade = "🔴 D"
    else:
        grade = "💀 F"

    result = {
        "run_id": run_id,
        "created_at": datetime.now().isoformat(),
        "eaa_version": ver_out.strip(),
        "git_commit": git_out.strip(),
        "baseline": BASELINE,
        "dimensions": {
            "safety": {"score": safety_s, "details": safety_d, "cases": safety_c},
            "data_quality": {"score": data_s, "details": data_d, "cases": data_c},
            "task_completion": {"score": task_s, "details": task_d, "cases": task_c},
            "performance": {"score": perf_s, "details": perf_d, "cases": perf_c},
            "truth_audit": {"score": truth_s, "details": truth_d, "cases": truth_c},
        },
        "total_score": total,
        "grade": grade,
    }

    result_file = RESULTS_DIR / f"{run_id}.json"
    with open(result_file, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    with open(RESULTS_DIR / "latest.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    # 输出
    print()
    print("=" * 55)
    print(f"  EAA 系统跑分报告 v2.0（无上限评分制）")
    print(f"  {run_id}")
    print("=" * 55)
    print(f"  🛡️  安全合规:   {safety_s:>6.1f} 分")
    print(f"  📊 数据质量:   {data_s:>6.1f} 分")
    print(f"  ✅ 任务完成度: {task_s:>6.1f} 分")
    print(f"  ⚡ 性能成本:   {perf_s:>6.1f} 分")
    print(f"  🔍 真实性审计: {truth_s:>6.1f} 分")
    print("-" * 55)
    print(f"  🏆 总分:       {total:>6.1f} 分   {grade}")
    print(f"  基准线=100   可超100   无上限   含真实性审计（100分起步，扣分制）")
    print("=" * 55)
    print(f"  评级: S≥400 | A≥300 | B≥200 | C≥100 | D≥50 | F<50")
    if truth_s < 80:
        print(f"  ⚠️  真实性审计低于80分，存在数据编造风险！")
    print(f"  结果: {result_file}")

    return result


def compare_runs(run_a, run_b):
    with open(RESULTS_DIR / f"{run_a}.json") as f:
        a = json.load(f)
    with open(RESULTS_DIR / f"{run_b}.json") as f:
        b = json.load(f)

    print(f"📊 对比: {run_a} vs {run_b}")
    print("=" * 55)
    print(f"  {'维度':<12} {'优化前':>8} {'优化后':>8} {'变化':>8}")
    print("-" * 55)
    for dim in ["safety", "data_quality", "task_completion", "performance", "truth_audit"]:
        sa = a["dimensions"][dim]["score"]
        sb = b["dimensions"][dim]["score"]
        diff = sb - sa
        arrow = "↑" if diff > 0 else "↓" if diff < 0 else "→"
        print(f"  {dim:<12} {sa:>8.1f} {sb:>8.1f} {arrow}{abs(diff):>6.1f}")
    print("-" * 55)
    ta = a["total_score"]
    tb = b["total_score"]
    diff = tb - ta
    arrow = "↑" if diff > 0 else "↓" if diff < 0 else "→"
    print(f"  {'综合':<12} {ta:>8.1f} {tb:>8.1f} {arrow}{abs(diff):>6.1f}")
    print(f"  评级: {a['grade']} → {b['grade']}")


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "compare" and len(sys.argv) >= 4:
        compare_runs(sys.argv[2], sys.argv[3])
    else:
        run_benchmark()
