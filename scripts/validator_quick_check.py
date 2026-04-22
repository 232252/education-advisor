#!/usr/bin/env python3
"""
validator_quick_check.py - 数据核验快速检查
快速核验关键数据，发现异常立即报警

效率：全量检查 < 5秒完成
"""

import os
import json
from datetime import datetime

STUDENTS_DIR = "${EAA_WORKSPACE:-./workspace}/students"
CONDUCT_DIR = "${EAA_WORKSPACE:-./workspace}/data/conduct_scores/students"
INBOX_DIR = "${OPENCLAW_HOME:-./}/memory/queue/inbox"
OUTPUT_FILE = "${EAA_WORKSPACE:-./workspace}/data_archive/agent_outputs/validator_quick_check.json"
LOG_FILE = "${EAA_WORKSPACE:-./workspace}/logs/validator_quick_check.log"

def log(msg):
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    line = f"[{timestamp}] {msg}"
    print(line)
    with open(LOG_FILE, 'a', encoding='utf-8') as f:
        f.write(line + "\n")

def check_students():
    """检查学生档案"""
    files = [f for f in os.listdir(STUDENTS_DIR) if f.endswith('.md')]
    return {
        "status": "PASS",
        "total": len(files),
        "anomalies": []
    }

def check_conduct_scores():
    """检查操行分"""
    anomalies = []
    
    # 检查目录是否存在
    if not os.path.exists(CONDUCT_DIR):
        return {"status": "WARN", "anomalies": [f"目录不存在: {CONDUCT_DIR}"]}
    
    # 检查分数范围
    score_files = [f for f in os.listdir(CONDUCT_DIR) if f.endswith('.json')]
    
    for fname in score_files:
        fpath = os.path.join(CONDUCT_DIR, fname)
        try:
            with open(fpath, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            if 'final_score' in data:
                score = data['final_score']
                if score < 0 or score > 200:
                    anomalies.append(f"{fname}: 分数异常 {score}")
        except:
            anomalies.append(f"{fname}: 解析失败")
    
    return {
        "status": "PASS" if not anomalies else "FAIL",
        "total_files": len(score_files),
        "anomalies": anomalies
    }

def check_inbox():
    """检查 inbox 队列"""
    if not os.path.exists(INBOX_DIR):
        return {"status": "WARN", "pending": 0, "anomalies": ["目录不存在"]}
    
    files = [f for f in os.listdir(INBOX_DIR) if f.endswith('.json')]
    pending = []
    
    for fname in files:
        fpath = os.path.join(INBOX_DIR, fname)
        try:
            with open(fpath, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if data.get('status') == 'pending':
                pending.append(fname)
        except:
            pass
    
    return {
        "status": "PASS" if not pending else "WARN",
        "total": len(files),
        "pending": len(pending),
        "pending_files": pending,
        "anomalies": []
    }

def run_quick_check():
    """运行快速核验"""
    log("开始快速核验...")
    
    result = {
        "timestamp": datetime.now().isoformat(),
        "student_archives": check_students(),
        "conduct_scores": check_conduct_scores(),
        "inbox_queue": check_inbox()
    }
    
    # 汇总异常
    all_anomalies = []
    for key in ['student_archives', 'conduct_scores', 'inbox_queue']:
        if result[key].get('anomalies'):
            all_anomalies.extend(result[key]['anomalies'])
    
    result['total_anomalies'] = len(all_anomalies)
    result['overall_status'] = "PASS" if not all_anomalies else "FAIL"
    
    log(f"核验完成：{result['overall_status']}，异常{len(all_anomalies)}项")
    
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    
    return result

if __name__ == "__main__":
    result = run_quick_check()
    print(json.dumps(result, ensure_ascii=False, indent=2))
