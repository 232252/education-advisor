#!/usr/bin/env python3
"""EAA CLI 扩展模块 - 学生档案查询 + 隐私脱敏"""

import json
import sys
import os
import re
from pathlib import Path
from datetime import datetime

DATA_DIR = os.environ.get('EAA_DATA_DIR', '/vol2/copaw-data/data')
PROFILES_PATH = os.path.join(DATA_DIR, 'profiles', 'profiles.json')

# ========== 隐私脱敏规则 ==========

def mask_id_card(id_card: str) -> str:
    """身份证号脱敏: 513324****1814"""
    if not id_card or len(id_card) < 10:
        return id_card or ''
    return id_card[:6] + '****' + id_card[-4:]

def mask_phone(phone: str) -> str:
    """电话号码脱敏: 136****18"""
    if not phone or len(phone) < 6:
        return phone or ''
    return phone[:3] + '****' + phone[-2:]

def mask_address(address: str, level: str = 'county') -> str:
    """地址脱敏: 只保留县/乡镇级别"""
    if not address:
        return ''
    if level == 'county':
        for cp in ['九龙县', '石渠县', '稻城县', '理塘县', '泸定县', '丹巴县', '色达县', '康定县', '白玉县']:
            if cp in address:
                # Return county + township only
                idx = address.index(cp)
                after = address[idx:]
                t_match = re.match(r'[^\s]+?[镇乡村]', after)
                if t_match:
                    return t_match.group(0)
                return cp
    return address[:6] + '***'

def should_mask() -> bool:
    """判断是否需要脱敏"""
    env = os.environ.get('EAA_MASK_MODE', 'auto')
    if env == 'always':
        return True
    if env == 'never':
        return False
    # auto: 默认脱敏，除非明确指定 EAA_RECIPIENT=teacher
    recipient = os.environ.get('EAA_RECIPIENT', '')
    return recipient != 'teacher'

# ========== 数据加载 ==========

def load_profiles():
    with open(PROFILES_PATH, 'r') as f:
        return json.load(f)

def find_student(name: str) -> dict:
    profiles = load_profiles()
    # Exact match
    if name in profiles:
        return profiles[name]
    # Fuzzy match
    for pname, pdata in profiles.items():
        if name in pname or pname in name:
            return pdata
    return None

# ========== 命令处理 ==========

def cmd_profile(name: str, full: bool = False):
    """查询学生完整档案"""
    student = find_student(name)
    if not student:
        print(f"❌ 未找到学生: {name}")
        sys.exit(1)
    
    mask = should_mask() and not full
    
    print(f"{'═' * 50}")
    print(f"📋 学生档案: {student['name']}")
    print(f"{'═' * 50}")
    
    # 基本信息
    print(f"\n📌 基本信息")
    print(f"  姓名: {student['name']}")
    print(f"  班级: {student.get('class', '高二5班')}")
    print(f"  性别: {student.get('gender', '?')}")
    print(f"  民族: {student.get('ethnicity', '?')}")
    
    if mask:
        print(f"  身份证: {mask_id_card(student.get('id_card', ''))}")
        print(f"  电话: {mask_phone(student.get('phone', ''))}")
        print(f"  地址: {mask_address(student.get('address', ''))}")
    else:
        print(f"  身份证: {student.get('id_card', '(无)')}")
        print(f"  电话: {student.get('phone', '(无)')}")
        print(f"  地址: {student.get('address', '(无)')}")
    
    print(f"  风险等级: {student.get('risk_level', '正常')}")
    
    # 操行分 (调用eaa CLI)
    print(f"\n📊 操行分")
    import subprocess
    result = subprocess.run(['eaa', 'score', student['name']], capture_output=True, text=True)
    if result.returncode == 0:
        print(f"  {result.stdout.strip()}")
    
    result = subprocess.run(['eaa', 'history', student['name']], capture_output=True, text=True)
    if result.returncode == 0 and result.stdout.strip():
        for line in result.stdout.strip().split('\n'):
            print(f"  {line}")
    
    # 学业成绩
    print(f"\n📚 学业成绩")
    scores = student.get('academic_latest', {})
    if scores:
        for subj, score in scores.items():
            print(f"  {subj}: {score}")
    else:
        print(f"  (暂无成绩记录)")
    
    # 谈话记录
    print(f"\n💬 谈话记录 ({student.get('talk_count', 0)}次)")
    talks = student.get('talks', [])
    if talks:
        for t in talks:
            date = t.get('date', '?')
            summary = t.get('summary', '')
            if mask:
                # 脱敏谈话摘要中的真名
                try:
                    result = subprocess.run(['eaa', 'privacy', 'anonymize', summary], 
                                          capture_output=True, text=True, timeout=5)
                    if result.returncode == 0:
                        summary = result.stdout.strip()
                except:
                    pass
            print(f"  [{date}] {summary[:100]}")
    else:
        print(f"  (暂无谈话记录)")
    
    if mask:
        print(f"\n🔒 数据已脱敏 | 使用 --full 查看完整信息（仅限邵老师）")
    
    print(f"{'═' * 50}")

def cmd_profile_full(name: str):
    """完整档案（不脱敏）- 仅限邵老师"""
    cmd_profile(name, full=True)

def cmd_grades(name: str):
    """查询学业成绩"""
    student = find_student(name)
    if not student:
        print(f"❌ 未找到学生: {name}")
        sys.exit(1)
    
    scores = student.get('academic_latest', {})
    print(f"{student['name']} 学业成绩:")
    if scores:
        for subj, score in scores.items():
            print(f"  {subj}: {score}")
    else:
        print(f"  (暂无成绩记录)")

def cmd_talks(name: str):
    """查询谈话记录"""
    student = find_student(name)
    if not student:
        print(f"❌ 未找到学生: {name}")
        sys.exit(1)
    
    talks = student.get('talks', [])
    print(f"{student['name']} 谈话记录 ({len(talks)}次):")
    if talks:
        for t in talks:
            print(f"  [{t.get('date', '?')}] {t.get('summary', '')[:200]}")
    else:
        print(f"  (暂无谈话记录)")

def cmd_export_profiles(output: str = ''):
    """导出所有学生档案（脱敏版）"""
    profiles = load_profiles()
    mask = should_mask()
    
    lines = []
    lines.append("序号,姓名,性别,民族,身份证,电话,地址,风险等级")
    for i, (name, p) in enumerate(profiles.items(), 1):
        id_card = mask_id_card(p.get('id_card', '')) if mask else p.get('id_card', '')
        phone = mask_phone(p.get('phone', '')) if mask else p.get('phone', '')
        addr = mask_address(p.get('address', '')) if mask else p.get('address', '')
        lines.append(f"{i},{p['name']},{p.get('gender','')},{p.get('ethnicity','')},{id_card},{phone},{addr},{p.get('risk_level','')}")
    
    content = '\n'.join(lines)
    if output:
        with open(output, 'w') as f:
            f.write(content)
        print(f"✅ 已导出到 {output} ({len(profiles)}名学生)")
    else:
        print(content)

# ========== 主入口 ==========

USAGE = """
EAA 扩展命令 - 学生档案管理

Usage: eaa <command> [args]

扩展命令:
  profile <姓名>          查询学生完整档案（自动脱敏）
  profile <姓名> --full   查询完整档案（不脱敏，仅邵老师）
  grades <姓名>           查询学业成绩
  talks <姓名>            查询谈话记录
  export-profiles [文件]   导出所有学生档案（脱敏CSV）

环境变量:
  EAA_MASK_MODE=always|never|auto  脱敏模式（默认auto）
  EAA_RECIPIENT=teacher            收件人为邵老师时不脱敏
"""

def main():
    args = sys.argv[1:]
    if not args:
        print(USAGE)
        sys.exit(0)
    
    cmd = args[0]
    
    if cmd == 'profile':
        if len(args) < 2:
            print("Usage: eaa profile <姓名> [--full]")
            sys.exit(1)
        name = args[1]
        full = '--full' in args
        if full:
            os.environ['EAA_RECIPIENT'] = 'teacher'
        cmd_profile(name, full=full)
    
    elif cmd == 'grades':
        if len(args) < 2:
            print("Usage: eaa grades <姓名>")
            sys.exit(1)
        cmd_grades(args[1])
    
    elif cmd == 'talks':
        if len(args) < 2:
            print("Usage: eaa talks <姓名>")
            sys.exit(1)
        cmd_talks(args[1])
    
    elif cmd == 'export-profiles':
        output = args[1] if len(args) > 1 else ''
        cmd_export_profiles(output)
    
    else:
        print(f"未知扩展命令: {cmd}")
        print(USAGE)
        sys.exit(1)

if __name__ == '__main__':
    main()
