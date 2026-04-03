#!/usr/bin/env python3
"""
checkpoint_before_response.py - 响应前检查点

在生成任何回复之前，必须执行此检查：
1. 检查 inbox 目录是否有未保存的消息
2. 确保上一条用户消息已被写入 inbox
3. 验证关键数据是否已更新到档案

用法:
  python3 /root/.copaw/scripts/checkpoint_before_response.py --check-inbox --check-students

此脚本确保：
- 每次回复前都有数据保存检查
- 没有遗漏任何用户消息
"""

import json
import os
import sys
import argparse
from datetime import datetime, timedelta

INBOX_DIR = "/root/.openclaw/workspace/memory/queue/inbox"
STUDENTS_DIR = "/root/.copaw/students"
MEMORY_FILE = "/root/.openclaw/workspace/MEMORY.md"

def check_inbox():
    """检查 inbox 是否有未处理的消息"""
    if not os.path.exists(INBOX_DIR):
        return True, "Inbox 目录不存在，需要初始化"
    
    files = [f for f in os.listdir(INBOX_DIR) if f.endswith('.json')]
    pending = []
    for fname in files:
        fpath = os.path.join(INBOX_DIR, fname)
        with open(fpath, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if data.get('status') == 'pending':
            pending.append(f"{fname}: {data.get('message', '')[:50]}")
    
    if pending:
        return False, f"发现 {len(pending)} 条未保存消息:\n" + "\n".join(pending)
    return True, f"Inbox 清空 (共 {len(files)} 条已处理)"

def check_recent_updates():
    """检查是否有近期未更新的学生档案"""
    if not os.path.exists(STUDENTS_DIR):
        return True, "Students 目录不存在"
    
    issues = []
    cutoff = datetime.now() - timedelta(days=7)
    
    for fname in os.listdir(STUDENTS_DIR):
        if not fname.endswith('.md'):
            continue
        fpath = os.path.join(STUDENTS_DIR, fname)
        mtime = datetime.fromtimestamp(os.path.getmtime(fpath))
        
        # 检查文件是否在最近被更新过
        if mtime < cutoff:
            # 检查档案内容是否包含今日日期
            with open(fpath, 'r', encoding='utf-8') as f:
                content = f.read()
            today = datetime.now().strftime('%Y-%m-%d')
            if today not in content:
                issues.append(f"{fname} (最后更新: {mtime.strftime('%Y-%m-%d')})")
    
    if issues:
        return False, f"发现 {len(issues)} 个学生档案超过7天未更新且今日无记录"
    return True, "学生档案更新正常"

def verify_critical_data():
    """验证关键数据是否存在"""
    checks = [
        ("MEMORY.md", MEMORY_FILE),
        ("学生档案目录", STUDENTS_DIR),
        ("Inbox目录", INBOX_DIR),
    ]
    
    issues = []
    for name, path in checks:
        if not os.path.exists(path):
            issues.append(f"缺失: {name} ({path})")
    
    if issues:
        return False, ",\n".join(issues)
    return True, "关键数据验证通过"

def run_checkpoint(check_inbox_flag=True, check_students_flag=False):
    """运行所有检查"""
    print("=" * 50)
    print(f"检查点运行: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 50)
    
    results = []
    
    if check_inbox_flag:
        ok, msg = check_inbox()
        results.append(("Inbox检查", ok, msg))
        status = "✅" if ok else "❌"
        print(f"{status} Inbox: {msg}")
    
    if check_students_flag:
        ok, msg = check_recent_updates()
        results.append(("学生档案", ok, msg))
        status = "✅" if ok else "❌"
        print(f"{status} 学生档案: {msg}")
    
    ok, msg = verify_critical_data()
    results.append(("关键数据", ok, msg))
    status = "✅" if ok else "❌"
    print(f"{status} 关键数据: {msg}")
    
    print("=" * 50)
    
    failed = [r for r in results if not r[1]]
    if failed:
        print(f"❌ 检查失败: {len(failed)} 项")
        for name, ok, msg in failed:
            print(f"  - {name}: {msg}")
        return False
    else:
        print("✅ 所有检查通过")
        return True

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='响应前检查点')
    parser.add_argument('--check-inbox', action='store_true', help='检查 inbox')
    parser.add_argument('--check-students', action='store_true', help='检查学生档案')
    parser.add_argument('--strict', action='store_true', help='严格模式：失败时退出')
    
    args = parser.parse_args()
    
    # 默认检查
    if not (args.check_inbox or args.check_students):
        args.check_inbox = True
    
    ok = run_checkpoint(args.check_inbox, args.check_students)
    
    if not ok and args.strict:
        print("\n严格模式：检查失败，终止操作")
        sys.exit(1)
