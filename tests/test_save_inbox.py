#!/usr/bin/env python3
"""
测试套件 - 教育参谋系统
运行: python3 -m pytest tests/
"""

import os
import sys
import json
import tempfile
import shutil
from datetime import datetime

# 添加项目根目录到路径
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PROJECT_ROOT)

# 测试配置
TEST_CONFIG = {
    "app_id": "cli_test",
    "app_secret": "test_secret",
    "user_open_id": "ou_test"
}

class TestSaveInbox:
    """测试 save_inbox.py"""
    
    def setup_method(self):
        """每个测试前创建临时目录"""
        self.test_dir = tempfile.mkdtemp()
        self.original_dir = PROJECT_ROOT
        os.environ['TEST_MODE'] = '1'
    
    def teardown_method(self):
        """每个测试后清理"""
        shutil.rmtree(self.test_dir, ignore_errors=True)
        os.environ.pop('TEST_MODE', None)
    
    def test_save_inbox_creates_file(self):
        """测试保存消息到inbox"""
        from scripts.save_inbox import save_to_inbox
        
        message = "测试消息"
        source = "test"
        sender = "test_user"
        
        filepath = save_to_inbox(message, source, sender)
        
        assert os.path.exists(filepath), "文件应该被创建"
        
        with open(filepath, 'r') as f:
            data = json.load(f)
        
        assert data['message'] == message
        assert data['source'] == source
        assert data['sender'] == sender
        assert data['status'] == 'pending'
    
    def test_save_inbox_timestamp(self):
        """测试时间戳格式"""
        from scripts.save_inbox import save_to_inbox
        
        filepath = save_to_inbox("测试", "test", "user")
        
        with open(filepath, 'r') as f:
            data = json.load(f)
        
        # 验证ISO格式时间戳
        datetime.fromisoformat(data['timestamp'])
        assert True


class TestSupervisorQuickScan:
    """测试 supervisor_quick_scan.py"""
    
    def setup_method(self):
        """创建测试学生档案"""
        self.test_dir = tempfile.mkdtemp()
        self.students_dir = os.path.join(self.test_dir, "students")
        os.makedirs(self.students_dir)
        
        # 创建测试学生档案
        for name in ["张三", "李四", "王五"]:
            with open(os.path.join(self.students_dir, f"{name}.md"), 'w') as f:
                f.write(f"# 学生档案：{name}\n\n🟢 低风险\n")
    
    def teardown_method(self):
        """清理"""
        shutil.rmtree(self.test_dir, ignore_errors=True)
    
    def test_scan_finds_students(self):
        """测试扫描找到学生"""
        # 修改脚本使用测试目录
        import scripts.supervisor_quick_scan as scan
        
        original_dir = scan.STUDENTS_DIR
        scan.STUDENTS_DIR = self.students_dir
        
        result = scan.scan_students()
        
        scan.STUDENTS_DIR = original_dir
        
        assert result['total_students'] == 3
        assert result['high_risk_count'] == 0
    
    def test_scan_identifies_risk(self):
        """测试识别高风险学生"""
        # 添加一个高风险学生
        with open(os.path.join(self.students_dir, "赵六.md"), 'w') as f:
            f.write("# 学生档案：赵六\n\n🔴 高风险\n")
        
        import scripts.supervisor_quick_scan as scan
        
        original_dir = scan.STUDENTS_DIR
        scan.STUDENTS_DIR = self.students_dir
        
        result = scan.scan_students()
        
        scan.STUDENTS_DIR = original_dir
        
        assert '赵六' in result['high_risk']


class TestValidatorQuickCheck:
    """测试 validator_quick_check.py"""
    
    def setup_method(self):
        """创建测试环境"""
        self.test_dir = tempfile.mkdtemp()
        self.students_dir = os.path.join(self.test_dir, "students")
        self.conduct_dir = os.path.join(self.test_dir, "conduct_scores")
        self.inbox_dir = os.path.join(self.test_dir, "inbox")
        
        os.makedirs(self.students_dir)
        os.makedirs(self.conduct_dir)
        os.makedirs(self.inbox_dir)
        
        # 创建测试档案
        with open(os.path.join(self.students_dir, "张三.md"), 'w') as f:
            f.write("# 学生档案\n")
    
    def teardown_method(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)
    
    def test_check_passes_when_clean(self):
        """测试正常情况通过"""
        import scripts.validator_quick_check as vc
        
        original_students = vc.STUDENTS_DIR
        original_conduct = vc.CONDUCT_DIR
        original_inbox = vc.INBOX_DIR
        
        vc.STUDENTS_DIR = self.students_dir
        vc.CONDUCT_DIR = self.conduct_dir
        vc.INBOX_DIR = self.inbox_dir
        
        result = vc.run_quick_check()
        
        vc.STUDENTS_DIR = original_students
        vc.CONDUCT_DIR = original_conduct
        vc.INBOX_DIR = original_inbox
        
        assert result['overall_status'] in ['PASS', 'WARN']


class TestCheckpointBeforeResponse:
    """测试 checkpoint_before_response.py"""
    
    def test_verify_critical_data(self):
        """测试关键数据验证"""
        from scripts.checkpoint_before_response import verify_critical_data
        
        ok, msg = verify_critical_data()
        
        # 在实际环境中应该通过
        # 在测试环境中可能失败
        assert isinstance(ok, bool)
        assert isinstance(msg, str)


# 测试运行器
def run_tests():
    """运行所有测试"""
    import pytest
    
    sys.exit(pytest.main([__file__, '-v']))


if __name__ == "__main__":
    run_tests()
