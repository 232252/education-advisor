# 贡献指南

感谢您对 Education Advisor AI 项目的关注！

## 如何贡献

### 报告问题
- 在 [GitHub Issues](https://github.com/232252/education-advisor/issues) 提交
- 包含：操作系统、复现步骤、预期行为、实际行为

### 提交代码
1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/your-feature`
3. 提交更改：`git commit -m "feat: 简短描述"`
4. 推送分支：`git push origin feature/your-feature`
5. 创建 Pull Request

### 代码规范
- **Rust**：`cargo fmt` + `cargo clippy`
- **Python**：`ruff format` + `ruff check`
- **Shell**：`shellcheck`
- **提交信息**：遵循 [Conventional Commits](https://www.conventionalcommits.org/)

### 安全注意
- **禁止提交学生真实数据**
- **禁止提交API密钥或Token**
- 敏感信息使用环境变量

### 开发环境
```bash
git clone https://github.com/232252/education-advisor.git
cd education-advisor
cd core/eaa-cli && cargo build --release && cd ../..
```

### v3.1.1 开发：双后端测试

```bash
# 文件系统后端（默认）
cargo test

# PostgreSQL 后端（需要本地 PG）
EAA_BACKEND=postgres DATABASE_URL=postgres://eaa:pass@localhost/eaa cargo test --features postgres
```
