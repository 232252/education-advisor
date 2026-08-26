(() => {
  'use strict';

  const REPO_OWNER = '232252';
  const REPO_NAME = 'education-advisor';
  const FALLBACK_BODY = `v3.2.0 架构评审修复版发布（M1-M35 全部完成）。

主要特性：
- 18 个专业 AI 智能体
- Rust EAA 数据引擎 v3.2.3
- 共享数据层（TTL 缓存 + 并发去重）
- 隐私引擎（PII 脱敏 / 反脱敏）
- MCP 集成与 19 个 AI 工具
- 35+ LLM 提供商支持
- Excel 批量导入学生
- electron-updater 自动更新
- Cron 漏执行补偿
- Windows / macOS / Linux 三平台安装包`;

  function simpleMarkdownToHtml(md) {
    return md
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/^\- (.*$)/gim, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
      .replace(/\n\n/g, '</p><p>');
  }

  async function loadReleaseNotes() {
    const container = document.getElementById('releaseNotes');
    if (!container) return;

    try {
      const response = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`, {
        headers: { 'Accept': 'application/vnd.github.v3+json' }
      });

      if (!response.ok) throw new Error(`GitHub API ${response.status}`);

      const data = await response.json();
      const html = simpleMarkdownToHtml(data.body || FALLBACK_BODY);
      container.innerHTML = `<p>${html}</p>`;
    } catch (err) {
      container.innerHTML = `<p>${simpleMarkdownToHtml(FALLBACK_BODY)}</p><p class="error">GitHub 加载失败（${err.message}），已显示本地缓存版本。</p>`;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadReleaseNotes);
  } else {
    loadReleaseNotes();
  }
})();
