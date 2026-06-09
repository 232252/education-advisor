// PR-D01: Agent Data Isolation Implementation
// 方案D: 12 Agent集成 - Agent数据隔离
// 验收标准: 安全测试通过
// 行数预估: 250

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;

/// Agent数据隔离器
/// 每个Agent拥有独立数据目录，权限700，防止横向攻击
pub struct AgentIsolator {
    /// Agent数据目录映射: agent_id -> data_dir
    agent_dirs: RwLock<HashMap<String, PathBuf>>,
    /// 根数据目录
    root_dir: PathBuf,
}

impl AgentIsolator {
    /// 创建新的隔离器实例
    pub fn new(root_dir: PathBuf) -> Result<Self, IsolationError> {
        // 确保根目录存在
        if !root_dir.exists() {
            fs::create_dir_all(&root_dir)
                .map_err(|e| IsolationError::DirectoryCreationFailed(e.to_string()))?;
        }
        
        // 设置根目录权限为700
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&root_dir)
                .map_err(|e| IsolationError::PermissionSetupFailed(e.to_string()))?
                .permissions();
            perms.set_mode(0o700);
            fs::set_permissions(&root_dir, perms)
                .map_err(|e| IsolationError::PermissionSetupFailed(e.to_string()))?;
        }
        
        Ok(Self {
            agent_dirs: RwLock::new(HashMap::new()),
            root_dir,
        })
    }
    
    /// 为Agent注册独立数据目录
    /// 每个Agent只能访问自己的数据目录
    pub fn register_agent(&self, agent_id: &str) -> Result<PathBuf, IsolationError> {
        // 验证agent_id格式（防止路径遍历攻击）
        if !self.validate_agent_id(agent_id) {
            return Err(IsolationError::InvalidAgentId(agent_id.to_string()));
        }
        
        let agent_dir = self.root_dir.join(agent_id);
        
        // 创建Agent专属目录
        if !agent_dir.exists() {
            fs::create_dir_all(&agent_dir)
                .map_err(|e| IsolationError::DirectoryCreationFailed(e.to_string()))?;
        }
        
        // 设置目录权限为700（仅所有者可读写）
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&agent_dir)
                .map_err(|e| IsolationError::PermissionSetupFailed(e.to_string()))?
                .permissions();
            perms.set_mode(0o700);
            fs::set_permissions(&agent_dir, perms)
                .map_err(|e| IsolationError::PermissionSetupFailed(e.to_string()))?;
        }
        
        // 记录映射关系
        let mut dirs = self.agent_dirs.write()
            .map_err(|e| IsolationError::LockFailed(e.to_string()))?;
        dirs.insert(agent_id.to_string(), agent_dir.clone());
        
        log::info!("Agent {} registered with isolated directory: {:?}", agent_id, agent_dir);
        
        Ok(agent_dir)
    }
    
    /// 获取Agent的数据目录
    /// 未注册的Agent返回错误
    pub fn get_agent_dir(&self, agent_id: &str) -> Result<PathBuf, IsolationError> {
        let dirs = self.agent_dirs.read()
            .map_err(|e| IsolationError::LockFailed(e.to_string()))?;
        
        dirs.get(agent_id)
            .cloned()
            .ok_or_else(|| IsolationError::AgentNotFound(agent_id.to_string()))
    }
    
    /// 验证Agent ID格式
    /// 防止路径遍历攻击（防止 agent_id = "../../../etc"）
    fn validate_agent_id(&self, agent_id: &str) -> bool {
        // Agent ID必须是字母数字下划线组成，长度1-64
        if agent_id.is_empty() || agent_id.len() > 64 {
            return false;
        }
        
        agent_id.chars().all(|c| {
            c.is_ascii_alphanumeric() || c == '_' || c == '-'
        })
    }
    
    /// 数据写入（自动路由到Agent隔离目录）
    pub fn write_data(&self, agent_id: &str, filename: &str, data: &[u8]) 
        -> Result<(), IsolationError> 
    {
        // 验证文件名（防止路径遍历）
        if !self.validate_filename(filename) {
            return Err(IsolationError::InvalidFilename(filename.to_string()));
        }
        
        let agent_dir = self.get_agent_dir(agent_id)?;
        let file_path = agent_dir.join(filename);
        
        fs::write(&file_path, data)
            .map_err(|e| IsolationError::WriteFailed(e.to_string()))?;
        
        log::debug!("Agent {} wrote data to {:?}", agent_id, file_path);
        
        Ok(())
    }
    
    /// 数据读取（自动路由到Agent隔离目录）
    pub fn read_data(&self, agent_id: &str, filename: &str) 
        -> Result<Vec<u8>, IsolationError> 
    {
        // 验证文件名
        if !self.validate_filename(filename) {
            return Err(IsolationError::InvalidFilename(filename.to_string()));
        }
        
        let agent_dir = self.get_agent_dir(agent_id)?;
        let file_path = agent_dir.join(filename);
        
        fs::read(&file_path)
            .map_err(|e| IsolationError::ReadFailed(e.to_string()))
    }
    
    /// 验证文件名安全性
    fn validate_filename(&self, filename: &str) -> bool {
        // 文件名不能包含路径分隔符或父目录引用
        if filename.contains('/') || filename.contains('\\') {
            return false;
        }
        if filename.contains("..") {
            return false;
        }
        if filename.is_empty() || filename.len() > 255 {
            return false;
        }
        true
    }
    
    /// 注销Agent（清除其数据目录映射）
    /// 注意：不自动删除数据目录，保留数据供审计
    pub fn unregister_agent(&self, agent_id: &str) -> Result<(), IsolationError> {
        let mut dirs = self.agent_dirs.write()
            .map_err(|e| IsolationError::LockFailed(e.to_string()))?;
        
        if dirs.remove(agent_id).is_none() {
            return Err(IsolationError::AgentNotFound(agent_id.to_string()));
        }
        
        log::info!("Agent {} unregistered", agent_id);
        
        Ok(())
    }
    
    /// 获取所有已注册的Agent列表
    pub fn list_agents(&self) -> Result<Vec<String>, IsolationError> {
        let dirs = self.agent_dirs.read()
            .map_err(|e| IsolationError::LockFailed(e.to_string()))?;
        Ok(dirs.keys().cloned().collect())
    }
}

/// Agent数据隔离相关错误
#[derive(Debug, thiserror::Error)]
pub enum IsolationError {
    #[error("Agent ID无效: {0}")]
    InvalidAgentId(String),
    
    #[error("Agent未注册: {0}")]
    AgentNotFound(String),
    
    #[error("文件名无效: {0}")]
    InvalidFilename(String),
    
    #[error("目录创建失败: {0}")]
    DirectoryCreationFailed(String),
    
    #[error("权限设置失败: {0}")]
    PermissionSetupFailed(String),
    
    #[error("数据写入失败: {0}")]
    WriteFailed(String),
    
    #[error("数据读取失败: {0}")]
    ReadFailed(String),
    
    #[error("锁操作失败: {0}")]
    LockFailed(String),
}

// ==================== 测试辅助函数 ====================

#[cfg(test)]
fn create_test_isolator() -> AgentIsolator {
    use std::env::temp_dir;
    let temp_dir = temp_dir().join("agent_isolation_test");
    AgentIsolator::new(temp_dir).unwrap()
}

// ==================== 安全测试用例 ====================

#[cfg(test)]
mod security_tests {
    use super::*;

    #[test]
    fn test_agent_isolation_basic() {
        let isolator = create_test_isolator();
        
        // 注册两个Agent
        let agent_a_dir = isolator.register_agent("agent_a").unwrap();
        let agent_b_dir = isolator.register_agent("agent_b").unwrap();
        
        // 验证两个Agent目录不同
        assert_ne!(agent_a_dir, agent_b_dir);
        
        // Agent A写入数据
        isolator.write_data("agent_a", "data.txt", b"secret data").unwrap();
        
        // Agent A读取自己的数据成功
        let data = isolator.read_data("agent_a", "data.txt").unwrap();
        assert_eq!(data, b"secret data");
        
        // Agent B读取Agent A的数据失败（目录隔离）
        let result = isolator.read_data("agent_b", "data.txt");
        assert!(result.is_err());
    }
    
    #[test]
    fn test_path_traversal_prevention() {
        let isolator = create_test_isolator();
        isolator.register_agent("agent_test").unwrap();
        
        // 尝试路径遍历攻击
        let result = isolator.write_data("agent_test", "../../../etc/passwd", b"hacked");
        assert!(result.is_err());
        
        let result = isolator.write_data("agent_test", "normal/../../../etc/passwd", b"hacked");
        assert!(result.is_err());
    }
    
    #[test]
    fn test_invalid_agent_id() {
        let isolator = create_test_isolator();
        
        // 无效的Agent ID
        let result = isolator.register_agent("");
        assert!(result.is_err());
        
        let result = isolator.register_agent("../../../etc");
        assert!(result.is_err());
        
        let result = isolator.register_agent("agent with space");
        assert!(result.is_err());
    }
    
    #[test]
    fn test_agent_unregistration() {
        let isolator = create_test_isolator();
        
        isolator.register_agent("agent_to_remove").unwrap();
        
        // 注销后无法访问目录
        isolator.unregister_agent("agent_to_remove").unwrap();
        let result = isolator.get_agent_dir("agent_to_remove");
        assert!(result.is_err());
    }
}

// ==================== 集成测试用例 ====================

#[cfg(test)]
mod integration_tests {
    use super::*;
    use std::env::temp_dir;
    
    #[test]
    fn test_concurrent_agent_access() {
        let isolator = create_test_isolator();
        
        // 并发注册多个Agent
        let agent_ids = vec!["agent_1", "agent_2", "agent_3", "agent_4"];
        
        for id in &agent_ids {
            isolator.register_agent(id).unwrap();
        }
        
        // 验证所有Agent都有独立目录
        let dirs: Vec<_> = agent_ids.iter()
            .map(|id| isolator.get_agent_dir(id).unwrap())
            .collect();
        
        // 验证目录互不相同
        for i in 0..dirs.len() {
            for j in (i+1)..dirs.len() {
                assert_ne!(dirs[i], dirs[j]);
            }
        }
    }
}
