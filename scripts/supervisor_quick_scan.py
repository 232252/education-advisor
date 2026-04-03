#!/usr/bin/env python3
"""
supervisor_quick_scan.py - 督导快速扫描脚本
快速扫描学生档案，生成风险报告，供 AI Agent 分析

效率：52个档案 < 3秒完成
"""

import os
import json
from datetime import datetime, timedelta

STUDENTS_DIR = "/root/.copaw/students"
OUTPUT_FILE = "/root/.copaw/data_archive/agent_outputs/supervisor_quick_scan.json"
LOG_FILE = "/root/.copaw/logs/supervisor_quick_scan.log"

def log(msg):
    """写日志"""
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    line = f"[{timestamp}] {msg}"
    print(line)
    with open(LOG_FILE, 'a', encoding='utf-8') as f:
        f.write(line + "\n")

def scan_students():
    """快速扫描所有学生档案"""
    log("开始扫描学生档案...")
    
    today = datetime.now()
    today_str = today.strftime('%Y-%m-%d')
    yesterday_str = (today - timedelta(days=1)).strftime('%Y-%m-%d')
    
    high_risk = []
    medium_risk = []
    updated_today = []
    updated_yesterday = []
    all_students = []
    
    files = [f for f in os.listdir(STUDENTS_DIR) if f.endswith('.md')]
    log(f"找到 {len(files)} 个学生档案")
    
    for fname in files:
        name = fname.replace('.md', '')
        fpath = os.path.join(STUDENTS_DIR, fname)
        
        # 获取修改时间
        mtime = datetime.fromtimestamp(os.path.getmtime(fpath))
        mtime_str = mtime.strftime('%Y-%m-%d')
        
        if mtime_str == today_str:
            updated_today.append(name)
        elif mtime_str == yesterday_str:
            updated_yesterday.append(name)
        
        # 读取内容
        with open(fpath, 'r', encoding='utf-8') as f:
            content = f.read()
        
        all_students.append({
            "name": name,
            "file": fname,
            "updated": mtime_str,
            "content_length": len(content)
        })
        
        # 检查风险等级
        if '🔴' in content or '高风险' in content:
            high_risk.append(name)
        elif '🟡' in content or '中风险' in content:
            medium_risk.append(name)
    
    result = {
        "timestamp": today.isoformat(),
        "total_students": len(files),
        "high_risk": high_risk,
        "high_risk_count": len(high_risk),
        "medium_risk": medium_risk,
        "medium_risk_count": len(medium_risk),
        "updated_today": updated_today,
        "updated_yesterday": updated_yesterday,
        "all_students_count": len(all_students),
        "scan_duration": "fast_python_scan"
    }
    
    log(f"扫描完成：高风险{len(high_risk)}人，中风险{len(medium_risk)}人")
    
    # 写入输出文件
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    
    log(f"结果已写入：{OUTPUT_FILE}")
    
    return result

if __name__ == "__main__":
    result = scan_students()
    print(json.dumps(result, ensure_ascii=False, indent=2))
