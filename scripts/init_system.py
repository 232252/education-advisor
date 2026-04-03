#!/usr/bin/env python3
"""
教育参谋系统 - 初始化脚本

功能：
1. 创建必要的目录结构
2. 验证配置文件
3. 初始化数据库
4. 生成Agent工作区
5. 验证系统完整性
"""

import os
import sys
import json
from datetime import datetime

# 项目根目录
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def log(msg, status="INFO"):
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    symbols = {
        "INFO": "ℹ️",
        "OK": "✅",
        "WARN": "⚠️",
        "ERROR": "❌"
    }
    print(f"[{timestamp}] {symbols.get(status, 'ℹ️')} {msg}")

def create_directories():
    """创建目录结构"""
    log("创建目录结构...")
    
    dirs = [
        "data/students",
        "data/conduct_scores",
        "data/academic_scores",
        "data/home_school_notifications",
        "data_collection/raw",
        "data_collection/psychology",
        "logs",
        "workspace/memory/queue/inbox",
        "workspace/memory/queue/archive",
        "workspace/students",
        "supervisor",
        "safety",
        "scripts",
        "agents/main/workspace",
        "agents/supervisor/workspace",
        "agents/validator/workspace",
    ]
    
    for d in dirs:
        path = os.path.join(PROJECT_ROOT, d)
        os.makedirs(path, exist_ok=True)
        log(f"  创建: {d}", "OK")

def check_config():
    """验证配置文件"""
    log("验证配置文件...")
    
    config_file = os.path.join(PROJECT_ROOT, "config/app_config.json")
    if not os.path.exists(config_file):
        log(f"配置文件不存在: {config_file}", "WARN")
        example_file = os.path.join(PROJECT_ROOT, "config/app_config.example.json")
        if os.path.exists(example_file):
            log("请复制配置模板并填写参数", "WARN")
        return False
    
    try:
        with open(config_file, 'r') as f:
            config = json.load(f)
        
        required = ['app_id', 'app_secret', 'user_open_id']
        app_config = config.get('app', {})
        
        for key in required:
            if not app_config.get(key):
                log(f"缺少配置项: app.{key}", "WARN")
        
        log("配置文件验证通过", "OK")
        return True
    except Exception as e:
        log(f"配置文件解析失败: {e}", "ERROR")
        return False

def init_database():
    """初始化数据库"""
    log("初始化数据库...")
    
    # 主数据库
    db_file = os.path.join(PROJECT_ROOT, "data/database/students.json")
    os.makedirs(os.path.dirname(db_file), exist_ok=True)
    
    if not os.path.exists(db_file):
        with open(db_file, 'w') as f:
            json.dump({"students": [], "last_updated": ""}, f, indent=2)
        log("  创建主数据库", "OK")
    
    # 操行分数据库
    conduct_file = os.path.join(PROJECT_ROOT, "data/database/conduct_scores.json")
    os.makedirs(os.path.dirname(conduct_file), exist_ok=True)
    
    if not os.path.exists(conduct_file):
        with open(conduct_file, 'w') as f:
            json.dump({"scores": [], "last_updated": ""}, f, indent=2)
        log("  创建操行分数据库", "OK")

def init_agents():
    """初始化Agent工作区"""
    log("初始化Agent工作区...")
    
    agents = ['main', 'supervisor', 'validator', 'academic', 'psychology', 
               'safety', 'home_school', 'research', 'executor', 'talk_planner']
    
    for agent in agents:
        workspace = os.path.join(PROJECT_ROOT, f"agents/{agent}/workspace")
        os.makedirs(workspace, exist_ok=True)
        
        # 创建必要的子目录
        for subdir in ['private_data/logs', 'knowledge']:
            path = os.path.join(workspace, subdir)
            os.makedirs(path, exist_ok=True)
        
        log(f"  Agent: {agent}", "OK")

def verify_system():
    """验证系统完整性"""
    log("验证系统完整性...")
    
    required_files = [
        "scripts/save_inbox.py",
        "scripts/checkpoint_before_response.py",
        "scripts/supervisor_quick_scan.py",
        "scripts/validator_quick_check.py",
        "config/app_config.json",
        "README.md",
    ]
    
    all_ok = True
    for f in required_files:
        path = os.path.join(PROJECT_ROOT, f)
        if os.path.exists(path):
            log(f"  ✅ {f}", "OK")
        else:
            log(f"  ❌ {f}", "ERROR")
            all_ok = False
    
    return all_ok

def generate_summary():
    """生成系统摘要"""
    log("生成系统摘要...")
    
    summary = {
        "initialized_at": datetime.now().isoformat(),
        "project_root": PROJECT_ROOT,
        "students_count": len([f for f in os.listdir(os.path.join(PROJECT_ROOT, "data/students")) 
                              if f.endswith('.md')]),
        "agents_count": len(os.listdir(os.path.join(PROJECT_ROOT, "agents"))),
    }
    
    summary_file = os.path.join(PROJECT_ROOT, "data/system_summary.json")
    with open(summary_file, 'w') as f:
        json.dump(summary, f, indent=2)
    
    log(f"  学生档案: {summary['students_count']}个", "OK")
    log(f"  Agent数量: {summary['agents_count']}个", "OK")

def main():
    print("=" * 50)
    print("   🎓 教育参谋系统 - 初始化")
    print("=" * 50)
    print()
    
    create_directories()
    check_config()
    init_database()
    init_agents()
    
    if verify_system():
        generate_summary()
        print()
        log("系统初始化完成！", "OK")
        print()
        print("下一步:")
        print("  1. 配置飞书应用参数 (config/app_config.json)")
        print("  2. 重启 OpenClaw 服务")
        print("  3. 测试发送消息")
    else:
        print()
        log("系统验证失败，请检查缺失文件", "ERROR")
        sys.exit(1)

if __name__ == "__main__":
    main()
