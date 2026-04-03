#!/usr/bin/env python3
"""
save_inbox.py - 强制信息保存脚本
每当收到用户消息时，立即调用此脚本保存到 inbox

用法:
  python3 save_inbox.py --message "消息内容" --source "feishu"

此脚本确保：
1. 收到信息立即写入磁盘（不等待 session 结束）
2. 写入 memory/queue/inbox/
3. 每条消息独立一个文件（时间戳命名）
4. 不覆盖，只追加新文件
"""

import json
import os
import sys
import argparse
from datetime import datetime

# 自动检测项目根目录
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
INBOX_DIR = os.path.join(PROJECT_ROOT, "workspace/memory/queue/inbox")

os.makedirs(INBOX_DIR, exist_ok=True)

def save_to_inbox(message: str, source: str = "unknown", sender: str = "unknown", metadata: dict = None):
    """保存消息到 inbox 目录"""
    timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S_%f")
    filename = f"{timestamp}.json"
    filepath = os.path.join(INBOX_DIR, filename)
    
    data = {
        "timestamp": datetime.now().isoformat(),
        "source": source,
        "sender": sender,
        "message": message,
        "metadata": metadata or {},
        "status": "pending"
    }
    
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    print(f"SAVED: {filepath}")
    return filepath

def consolidate_inbox():
    """合并 inbox 到 MEMORY.md"""
    memory_file = os.path.join(PROJECT_ROOT, "MEMORY.md")
    inbox_files = sorted([f for f in os.listdir(INBOX_DIR) if f.endswith('.json')])
    
    if not inbox_files:
        print("No pending inbox files")
        return
    
    consolidated = []
    for fname in inbox_files:
        fpath = os.path.join(INBOX_DIR, fname)
        with open(fpath, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        if data.get('status') == 'pending':
            entry = f"\n## INBOX: {data['timestamp']} [{data['source']}]\n"
            entry += f"- **来源**: {data['sender']}\n"
            entry += f"- **消息**: {data['message'][:500]}\n"
            consolidated.append(entry)
            
            data['status'] = 'consolidated'
            with open(fpath, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
    
    if consolidated:
        with open(memory_file, 'a', encoding='utf-8') as f:
            f.write("\n\n".join(consolidated))
        print(f"Consolidated {len(consolidated)} entries to MEMORY.md")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='保存消息到 inbox')
    parser.add_argument('--message', '-m', help='消息内容')
    parser.add_argument('--source', '-s', default='feishu', help='来源')
    parser.add_argument('--sender', '-d', default='unknown', help='发送者')
    parser.add_argument('--consolidate', '-c', action='store_true', help='合并 inbox 到 MEMORY.md')
    parser.add_argument('--metadata', help='额外元数据 (JSON 字符串)')
    
    args = parser.parse_args()
    
    if args.consolidate:
        consolidate_inbox()
    elif args.message:
        metadata = json.loads(args.metadata) if args.metadata else {}
        filepath = save_to_inbox(args.message, args.source, args.sender, metadata)
        print(f"OK: {filepath}")
    else:
        print("Error: --message is required unless --consolidate is specified")
        sys.exit(1)
