(() => {
  'use strict';

  // 单一事实来源：永远解析 GitHub latest release。
  // 下载按钮 href 由 JS 用真实资产覆盖；HTML 内的静态 href 仅作 API 失败时的兜底，
  // 因此兜底值无需随发版手改（修复 v3.2.0 手抄事故：硬编码产物链接 404）。
  const REPO_OWNER = '232252';
  const REPO_NAME = 'education-advisor'; // 修正：此前误写为 education-advisor-tauri（另一条产品线）
  const GITEE_OWNER = 'qdzwwqd';

  const FALLBACK_BODY = `最新版本功能一览：

- 18 个专业 AI 智能体协同
- Rust EAA 数据引擎（本地事件溯源 + 隐私脱敏）
- 本地优先，数据完全归属教师
- 支持云端与本地（Ollama）大模型
- Windows / macOS / Linux 全平台`;

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

  // HTML 的下载链接带 data-asset（资产名正则）；JS 拉到 latest release 后逐一覆盖 href。
  async function bindDownloadButtons(release) {
    if (!release || !Array.isArray(release.assets)) return;
    document.querySelectorAll('a[data-asset]').forEach((a) => {
      let re;
      try { re = new RegExp(a.getAttribute('data-asset')); } catch { return; }
      const asset = release.assets.find((x) => re.test(x.name));
      if (!asset) return;
      if (a.dataset.mirror === 'gitee') {
        a.href = `https://gitee.com/${GITEE_OWNER}/${REPO_NAME}/releases/download/${release.tag_name}/${asset.name}`;
      } else {
        a.href = asset.browser_download_url;
      }
    });
    document.querySelectorAll('[data-release-tag]').forEach((el) => {
      el.textContent = release.tag_name.replace(/^v/, '');
    });
    document.querySelectorAll('a[data-releases-link]').forEach((a) => {
      a.href = release.html_url;
    });
  }

  async function loadReleaseNotes() {
    const container = document.getElementById('releaseNotes');
    try {
      const response = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`, {
        headers: { 'Accept': 'application/vnd.github.v3+json' }
      });

      if (!response.ok) throw new Error(`GitHub API ${response.status}`);

      const release = await response.json();
      bindDownloadButtons(release);
      const body = release.body || FALLBACK_BODY;
      if (container) container.innerHTML = `<p>${simpleMarkdownToHtml(body)}</p>`;
    } catch (err) {
      if (container) {
        container.innerHTML = `<p>${simpleMarkdownToHtml(FALLBACK_BODY)}</p><p class="error">GitHub 加载失败（${err.message}），已显示本地缓存版本。</p>`;
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadReleaseNotes);
  } else {
    loadReleaseNotes();
  }
})();
