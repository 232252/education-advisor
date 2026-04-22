#!/usr/bin/env python3
"""
run_supervisor_check.py - 督导检查快速执行器

用法：
  python3 run_supervisor_check.py

原理：
  1. Python快速扫描学生档案（<3秒）
  2. 生成快速报告
  3. Agent只需分析报告内容（不用自己扫描）
"""

import os
import sys
import json
import subprocess
from datetime import datetime

sys.path.insert(0, '${EAA_WORKSPACE:-./workspace}/scripts')

# 执行快速扫描
print("=" * 50)
print(f"督导快速检查 {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
print("=" * 50)

print("\n[1/3] 执行学生档案快速扫描...")
result = subprocess.run(
    ['python3', '${EAA_WORKSPACE:-./workspace}/scripts/supervisor_quick_scan.py'],
    capture_output=True, text=True
)
print(result.stdout)

print("\n[2/3] 执行数据核验...")
result = subprocess.run(
    ['python3', '${EAA_WORKSPACE:-./workspace}/scripts/validator_quick_check.py'],
    capture_output=True, text=True
)
print(result.stdout)

print("\n[3/3] 读取扫描结果...")
scan_file = '${EAA_WORKSPACE:-./workspace}/data_archive/agent_outputs/supervisor_quick_scan.json'
if os.path.exists(scan_file):
    with open(scan_file, 'r') as f:
        scan_data = json.load(f)
    
    print(f"\n📊 扫描结果：")
    print(f"  高风险：{scan_data['high_risk_count']}人 - {', '.join(scan_data['high_risk'])}")
    print(f"  中风险：{scan_data['medium_risk_count']}人")
    print(f"  今日更新：{len(scan_data['updated_today'])}人")
    print(f"  昨日更新：{len(scan_data['updated_yesterday'])}人")
else:
    print("  ⚠️ 扫描结果文件不存在")

print("\n" + "=" * 50)
print("快速检查完成，结果已写入归档文件")
print("=" * 50)
