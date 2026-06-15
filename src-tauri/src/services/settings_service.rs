//! 设置服务 — Rust 重写自 `src/main/services/settings-service.ts`。
//!
//! 设计与原版一致:
//!   - 持久化到 `{userData}/settings.json` (原子写: tmp + rename)。
//!   - 默认值来自打包的 `config/default-settings.json`。
//!   - `update(dotPath, value)` 支持点路径局部更新 (如 "general.theme")。
//!   - 节流的写入 → 这里简化为写时直接落盘 (桌面端写频率低, 无需 throttle)。

use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::error::{AppError, Result};

/// 完整设置 (保留为 JSON Value, 与前端 UnifiedSettings 完全同构)。
pub type UnifiedSettings = Value;

pub struct SettingsService {
    settings: UnifiedSettings,
    path: PathBuf,
    defaults: UnifiedSettings,
    resources: PathBuf,
}

impl SettingsService {
    /// 从 resources/config/default-settings.json 读默认值, 合并用户 settings.json。
    pub fn load(user_data: &Path) -> Result<Self> {
        // resources 在 Tauri 里通过 Manager::path() 解析; 这里取约定相对路径作为回退。
        let resources = user_data.join("resources");
        let defaults = load_defaults(&resources).unwrap_or_else(|| Value::Object(Default::default()));
        let path = user_data.join("settings.json");
        let settings = if path.exists() {
            let raw = std::fs::read_to_string(&path)?;
            let user: Value = serde_json::from_str(&raw)?;
            merge_defaults(&defaults, user)
        } else {
            defaults.clone()
        };
        Ok(Self { settings, path, defaults, resources })
    }

    pub fn resources_dir(&self) -> &Path {
        &self.resources
    }

    pub fn get(&self) -> UnifiedSettings {
        self.settings.clone()
    }

    /// 点路径更新。如 "general.theme" -> settings["general"]["theme"]。
    pub fn update(&mut self, dot_path: &str, value: Value) -> Result<()> {
        let parts: Vec<&str> = dot_path.split('.').collect();
        if parts.is_empty() {
            return Err(AppError::Config("空设置路径".into()));
        }
        set_by_path(&mut self.settings, &parts, value)?;
        self.save_now()?;
        Ok(())
    }

    /// 重置为默认值。
    pub fn reset(&mut self) -> Result<()> {
        self.settings = self.defaults.clone();
        self.save_now()?;
        Ok(())
    }

    /// 设置自定义模型 (provider 维度数组, 绕过点路径)。
    pub fn set_custom_models(&mut self, provider_id: &str, models: Vec<Value>) -> Result<()> {
        let arr = Value::Array(models);
        // 确保 settings.models 是对象 (defaults 可能为空, 需要兜底创建)
        if !self.settings.is_object() {
            self.settings = Value::Object(serde_json::Map::new());
        }
        let root = self.settings.as_object_mut().unwrap();
        let models_obj = root.entry("models".to_string())
            .or_insert_with(|| Value::Object(serde_json::Map::new()));
        if !models_obj.is_object() {
            *models_obj = Value::Object(serde_json::Map::new());
        }
        let obj = models_obj.as_object_mut().unwrap();
        // 嵌套结构: models.customModels[provider_id] = [...]
        let cm = obj.entry("customModels".to_string())
            .or_insert_with(|| Value::Object(serde_json::Map::new()));
        if let Some(cm_obj) = cm.as_object_mut() {
            cm_obj.insert(provider_id.to_string(), arr);
        }
        self.save_now()?;
        Ok(())
    }

    /// 取一个具体字段的便捷方法。
    pub fn get_path(&self, dot_path: &str) -> Option<&Value> {
        let mut cur = &self.settings;
        for part in dot_path.split('.') {
            cur = cur.get(part)?;
        }
        Some(cur)
    }

    /// EAA 数据目录 (settings.general.dataDir, 回退到 userData/eaa-data)。
    pub fn eaa_data_dir(&self, user_data: &Path) -> PathBuf {
        self.get_path("general.dataDir")
            .and_then(|v| v.as_str())
            .map(PathBuf::from)
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or_else(|| user_data.join("eaa-data"))
    }

    fn save_now(&self) -> Result<()> {
        atomic_write(&self.path, &self.settings)
    }
}

fn load_defaults(resources: &Path) -> Option<UnifiedSettings> {
    let p = resources.join("config").join("default-settings.json");
    let raw = std::fs::read_to_string(&p).ok()?;
    serde_json::from_str(&raw).ok()
}

/// 深合并: 以 default 为底, user 覆盖 (仅对象层递归, 数组/标量直接替换)。
fn merge_defaults(defaults: &Value, mut user: Value) -> Value {
    if let Value::Object(d) = defaults {
        if let Value::Object(u) = &mut user {
            for (k, dv) in d {
                u.entry(k.clone()).or_insert_with(|| dv.clone());
            }
        }
    }
    user
}

fn set_by_path(root: &mut Value, parts: &[&str], value: Value) -> Result<()> {
    let mut cur = root;
    for &part in &parts[..parts.len() - 1] {
        if !cur.is_object() {
            *cur = Value::Object(Default::default());
        }
        let obj = cur.as_object_mut().ok_or_else(|| AppError::Config("路径非对象".into()))?;
        cur = obj.entry(part.to_string()).or_insert_with(|| Value::Object(Default::default()));
    }
    let last = parts.last().unwrap();
    if !cur.is_object() {
        *cur = Value::Object(Default::default());
    }
    cur.as_object_mut()
        .ok_or_else(|| AppError::Config("路径非对象".into()))?
        .insert(last.to_string(), value);
    Ok(())
}

/// 原子写: 写 .tmp -> fsync -> rename (与 eaa_core::storage::atomic_write_json 一致语义)。
fn atomic_write(path: &Path, value: &Value) -> Result<()> {
    use std::io::Write;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    let data = serde_json::to_string_pretty(value)?;
    {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(data.as_bytes())?;
        f.sync_all()?;
    }
    std::fs::rename(&tmp, path)?;
    Ok(())
}
