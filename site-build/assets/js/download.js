// =============================================================
// 下载页逻辑（site-build/download.html）
// - 数据三级降级：Worker 归一化 API → 浏览器直连 GitHub（扁平列表）
//   → 页面内置静态表（releases/latest 链接，不锁版本，永不漂移）
// - 资产分类只在 Worker 里做一遍（单一事实来源）；前端只渲染
//   归一化后的 { os, arch, kind, label, giteeUrl } 数据。
// - 页面源码不含任何硬编码版本号（修复 v0.1.0-rc / v3.2.0 手抄事故）。
// =============================================================
(() => {
  'use strict';

  const WORKER_URL =
    (typeof window !== 'undefined' && window.EEA_RELEASES_API) ||
    'https://api.eea.qdzwwqd.top/releases';
  const GITHUB_RELEASES_URL =
    'https://api.github.com/repos/232252/education-advisor/releases?per_page=100';
  const GITEE_TAG_URL = (tag) =>
    `https://gitee.com/qdzwwqd/education-advisor/releases/tag/${encodeURIComponent(tag)}`;
  const GITHUB_RELEASES_PAGE = 'https://github.com/232252/education-advisor/releases';
  const GITHUB_LATEST_BASE =
    'https://github.com/232252/education-advisor/releases/latest/download/';

  // 下载源 → 链接前缀；gitee 特殊：逐资产判定可用性
  const SOURCE_PREFIX = {
    github: '',
    'ghfast.top': 'https://ghfast.top/',
    'v6.gh-proxy.org': 'https://v6.gh-proxy.org/',
    'hk.gh-proxy.org': 'https://hk.gh-proxy.org/',
  };
  const SOURCE_LABELS = {
    github: 'GitHub 直连（官方）',
    'ghfast.top': 'ghfast.top 加速（第三方）',
    'v6.gh-proxy.org': 'v6.gh-proxy.org 加速（第三方）',
    'hk.gh-proxy.org': 'hk.gh-proxy.org 加速（第三方）',
    gitee: 'Gitee 镜像（官方同源）',
  };

  const OS_LABELS = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };
  const OS_ORDER = { windows: 0, macos: 1, linux: 2 };
  const ARCH_LABELS = { x64: 'x64 (Intel/AMD)', arm64: 'arm64 (Apple Silicon)', arm: 'arm' };

  // 推荐按钮的安装包优先级（跟随平台惯例）。
  // Windows 2026-11-09 起只发 Setup（免管理员、装当前用户目录），Portable 停发；
  // 历史 release 资产仍会被 classifyAsset 归类并正常展示。
  const CTA_KIND_PRIORITY = {
    windows: ['installer'],
    macos: ['dmg', 'zip'],
    linux: ['appimage', 'deb'],
  };

  // 备注列固定文案（均有仓库内文档佐证：DESKTOP_BUILD.md / TROUBLESHOOTING.md）
  const PLATFORM_NOTES = {
    windows: '未签名安装包，首次运行 SmartScreen 可能提示「Windows 已保护你的电脑」，点「更多信息」→「仍要运行」即可。',
    macos: '未公证，Gatekeeper 会拦截：右键点「打开」，或执行 xattr -c /Applications/Education\\ Advisor.app。',
    linux: 'AppImage 首次运行需 chmod +x；精简发行版若缺 FUSE2，先安装 libfuse2（deb 包免此步）。',
  };

  // 完全离线兜底：/releases/latest/download/ 不锁版本
  const STATIC_LATEST_ASSET = {
    windows: 'Education-Advisor-Setup.exe',
    macos_arm64: 'Education-Advisor-arm64.dmg',
    macos_x64: 'Education-Advisor-x64.dmg',
    linux: 'Education-Advisor.AppImage',
  };

  const els = {
    heroVersion: document.getElementById('heroVersion'),
    ctaCard: document.getElementById('ctaCard'),
    ctaTitle: document.getElementById('ctaTitle'),
    ctaMeta: document.getElementById('ctaMeta'),
    ctaButton: document.getElementById('ctaButton'),
    ctaButtonText: document.getElementById('ctaButtonText'),
    controls: document.getElementById('downloadControls'),
    channelSelect: document.getElementById('channelSelect'),
    versionField: document.getElementById('versionField'),
    versionSelect: document.getElementById('versionSelect'),
    osSelect: document.getElementById('osSelect'),
    archSelect: document.getElementById('archSelect'),
    sourceSelect: document.getElementById('sourceSelect'),
    fullView: document.getElementById('fullView'),
    releaseTitle: document.getElementById('releaseTitle'),
    tableBody: document.getElementById('downloadTableBody'),
    releaseNotes: document.getElementById('releaseNotes'),
    checksumsLink: document.getElementById('checksumsLink'),
    rawView: document.getElementById('rawView'),
    rawTableBody: document.getElementById('rawAssetTableBody'),
    staticFallback: document.getElementById('staticFallback'),
  };

  const state = {
    channels: null, // { stable, prerelease, all }
    channel: 'stable',
    versionTag: null, // 仅历史版本通道使用
    source: 'github',
    osFilter: '',
    archFilter: '',
  };

  // ---------- 工具 ----------

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function formatSize(bytes) {
    if (typeof bytes !== 'number' || Number.isNaN(bytes)) return '';
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
    if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${bytes} B`;
  }

  function formatDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  // 先整体转义、再做受限 markdown 替换（release body 属半可信内容）
  function inlineMarkdown(s) {
    return s
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|#[^)\s]*)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  function renderMarkdown(md) {
    const escaped = escapeHtml(md || '');
    const out = [];
    let inList = false;
    for (const line of escaped.split('\n')) {
      const li = line.match(/^- (.*)$/);
      if (li) {
        if (!inList) { out.push('<ul>'); inList = true; }
        out.push(`<li>${inlineMarkdown(li[1])}</li>`);
        continue;
      }
      if (inList) { out.push('</ul>'); inList = false; }
      const h = line.match(/^(#{1,3}) (.*)$/);
      if (h) {
        const level = 4 - h[1].length; // # → h3，避免压过页面 h2
        out.push(`<h${level}>${inlineMarkdown(h[2])}</h${level}>`);
        continue;
      }
      if (!line.trim()) continue;
      out.push(`<p>${inlineMarkdown(line)}</p>`);
    }
    if (inList) out.push('</ul>');
    return out.join('') || '<p>（无更新说明）</p>';
  }

  function detectMacArch() {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
      if (/Apple\s*(M\d|GPU)|Apple Silicon/i.test(renderer)) return 'arm64';
    } catch { /* WebGL 不可用时按 x64 兜底 */ }
    return 'x64';
  }

  function detectPlatform() {
    const ua = navigator.userAgent || '';
    if (/Windows/i.test(ua)) return { os: 'windows', arch: 'x64' };
    if (/Mac|iPhone|iPad/i.test(ua)) return { os: 'macos', arch: detectMacArch() };
    if (/Linux|X11/i.test(ua) && !/Android/i.test(ua)) return { os: 'linux', arch: 'x64' };
    return { os: 'windows', arch: 'x64' };
  }

  // ---------- 模式切换 ----------

  function setMode(mode) {
    els.fullView.hidden = mode !== 'full';
    els.controls.hidden = mode !== 'full';
    els.ctaCard.hidden = mode === 'static' ? false : mode !== 'full';
    els.rawView.hidden = mode !== 'raw';
    els.staticFallback.hidden = mode !== 'static';
    if (mode !== 'full') {
      els.heroVersion.textContent = '最新版本';
      els.checksumsLink.href = GITHUB_RELEASES_PAGE;
    }
  }

  // ---------- 降级 3：静态兜底 ----------

  function enterStaticMode() {
    setMode('static');
    const { os, arch } = detectPlatform();
    const key = os === 'macos' ? `macos_${arch}` : os;
    const asset = STATIC_LATEST_ASSET[key] || STATIC_LATEST_ASSET.windows;
    els.ctaTitle.textContent = `${OS_LABELS[os] || 'Windows'} 最新版`;
    els.ctaMeta.textContent = '版本信息加载失败，链接始终指向最新稳定版';
    els.ctaButton.href = GITHUB_LATEST_BASE + asset;
    els.ctaButtonText.textContent = `下载 ${asset}`;
  }

  // ---------- 降级 2：浏览器直连 GitHub（扁平列表，不做分类） ----------

  function enterRawMode(releases) {
    setMode('raw');
    const latest = Array.isArray(releases) && releases.length ? releases[0] : null;
    if (!latest) { enterStaticMode(); return; }
    const rows = (latest.assets || []).map((a) => `
      <tr>
        <td><code>${escapeHtml(a.name)}</code></td>
        <td>${formatSize(a.size)}</td>
        <td><a class="btn btn-secondary btn-sm" href="${a.browser_download_url}">下载</a></td>
      </tr>`).join('');
    els.rawTableBody.innerHTML = rows;
    els.ctaCard.hidden = true;
    els.heroVersion.textContent = latest.tag_name || '最新版本';
  }

  // ---------- 正常路径：Worker 归一化数据 ----------

  async function enterFullMode(releases) {
    state.channels = splitChannels(releases);
    state.channel = state.channels.stable ? 'stable' : 'history';
    state.versionTag = (state.channels.stable || state.channels.all[0] || {}).tag || null;
    state.osFilter = '';
    state.archFilter = '';

    const prereleaseOpt = els.channelSelect.querySelector('option[value="prerelease"]');
    if (prereleaseOpt) prereleaseOpt.disabled = !state.channels.prerelease;

    els.channelSelect.value = state.channel;
    els.versionSelect.innerHTML = state.channels.all.map((r) => `
      <option value="${escapeHtml(r.tag)}">${escapeHtml(r.tag)}${r.prerelease ? '（预发布）' : ''}</option>
    `).join('');
    els.versionSelect.value = state.versionTag || '';
    els.versionField.hidden = state.channel !== 'history';

    if (state.channels.stable) els.heroVersion.textContent = state.channels.stable.tag;
    else if (state.channels.all.length) els.heroVersion.textContent = state.channels.all[0].tag;

    setMode('full');
    renderAll();
  }

  function currentRelease() {
    const ch = state.channels;
    if (!ch) return null;
    if (state.channel === 'stable') return ch.stable || ch.all[0] || null;
    if (state.channel === 'prerelease') return ch.prerelease || null;
    return ch.all.find((r) => r.tag === state.versionTag) || ch.all[0] || null;
  }

  function splitChannels(releases) {
    const sorted = [...releases].sort(
      (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt),
    );
    return {
      stable: sorted.find((r) => !r.prerelease) || null,
      prerelease: sorted.find((r) => r.prerelease) || null,
      all: sorted,
    };
  }

  function renderAll() {
    const rel = currentRelease();
    if (!rel) { enterStaticMode(); return; }
    populateFilters(rel);
    renderReleaseTitle(rel);
    renderTable(rel);
    renderCta(rel);
    renderChangelog(rel);
    renderChecksumLink(rel);
  }

  function populateFilters(rel) {
    const osValues = [...new Set(rel.assets.map((a) => a.os).filter(Boolean))]
      .sort((x, y) => (OS_ORDER[x] ?? 9) - (OS_ORDER[y] ?? 9));
    const archValues = [...new Set(rel.assets.map((a) => a.arch).filter(Boolean))];

    if (!osValues.includes(state.osFilter) && state.osFilter !== '') state.osFilter = '';
    if (!archValues.includes(state.archFilter) && state.archFilter !== '') state.archFilter = '';

    els.osSelect.innerHTML = ['<option value="">全部</option>']
      .concat(osValues.map((v) => `<option value="${v}">${OS_LABELS[v] || v}</option>`))
      .join('');
    els.osSelect.value = state.osFilter;

    els.archSelect.innerHTML = ['<option value="">全部</option>']
      .concat(archValues.map((v) => `<option value="${v}">${ARCH_LABELS[v] || v}</option>`))
      .join('');
    els.archSelect.value = state.archFilter;
  }

  function renderReleaseTitle(rel) {
    const badge = rel.prerelease ? ' <span class="badge">预发布</span>' : '';
    const date = formatDate(rel.publishedAt);
    els.releaseTitle.innerHTML =
      `<a href="${rel.htmlUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(rel.tag)}</a>` +
      `${badge}<span class="release-date">${date}</span>`;
  }

  function assetChipHtml(rel, asset) {
    const size = formatSize(asset.size);
    const name = escapeHtml(asset.name);
    const label = escapeHtml(asset.label);
    if (state.source === 'gitee') {
      if (asset.giteeUrl) {
        return `<a class="asset-chip" href="${asset.giteeUrl}" target="_blank" rel="noopener noreferrer"><strong>${label}</strong><small>${name} · ${size}</small></a>`;
      }
      return `<a class="asset-chip mirror-missing" href="${GITEE_TAG_URL(rel.tag)}" target="_blank" rel="noopener noreferrer" title="该资产超出 Gitee 单附件 100MB 上限，未同步；点击前往该版本的 Gitee Release 页"><strong>镜像未同步</strong><small>${name}</small></a>`;
    }
    const prefix = SOURCE_PREFIX[state.source] || '';
    return `<a class="asset-chip" href="${prefix}${asset.url}" target="_blank" rel="noopener noreferrer"><strong>${label}</strong><small>${name} · ${size}</small></a>`;
  }

  function renderTable(rel) {
    const filtered = rel.assets.filter((a) =>
      (state.osFilter === '' || a.os === state.osFilter) &&
      (state.archFilter === '' || a.arch === state.archFilter));

    const groups = new Map();
    for (const a of filtered) {
      const key = `${a.os || 'other'}|${a.arch || ''}`;
      if (!groups.has(key)) groups.set(key, { os: a.os, arch: a.arch, assets: [] });
      groups.get(key).assets.push(a);
    }
    const rows = [...groups.values()].sort((x, y) =>
      (OS_ORDER[x.os] ?? 9) - (OS_ORDER[y.os] ?? 9) ||
      String(x.arch || '').localeCompare(String(y.arch || '')));

    if (!rows.length) {
      els.tableBody.innerHTML =
        '<tr><td colspan="4" class="table-empty">当前筛选条件下没有可下载的安装包，请调整筛选。</td></tr>';
      return;
    }

    els.tableBody.innerHTML = rows.map((row) => {
      const osCell = row.os ? (OS_LABELS[row.os] || row.os) : '其他文件';
      const archCell = row.arch ? (ARCH_LABELS[row.arch] || row.arch) : '—';
      const chips = row.assets.map((a) => assetChipHtml(rel, a)).join('');
      const note = row.os ? (PLATFORM_NOTES[row.os] || '') : '命名未识别的文件，可前往 GitHub Release 页确认用途。';
      return `<tr><td><strong>${escapeHtml(osCell)}</strong></td><td>${escapeHtml(archCell)}</td><td>${chips}</td><td class="note-cell">${escapeHtml(note)}</td></tr>`;
    }).join('');
  }

  function pickCtaAsset(rel) {
    const { os, arch } = detectPlatform();
    const priority = CTA_KIND_PRIORITY[os] || CTA_KIND_PRIORITY.windows;
    for (const kind of priority) {
      const exact = rel.assets.find((a) => a.os === os && a.kind === kind && a.arch === arch);
      if (exact) return exact;
      const any = rel.assets.find((a) => a.os === os && a.kind === kind);
      if (any) return any;
    }
    return rel.assets.find((a) => a.os === os) || rel.assets[0] || null;
  }

  function renderCta(rel) {
    const asset = pickCtaAsset(rel);
    const { os } = detectPlatform();
    if (!asset) { els.ctaCard.hidden = true; return; }
    els.ctaCard.hidden = false;
    els.ctaTitle.textContent = `为你的 ${OS_LABELS[os] || os} 系统推荐`;

    let href;
    if (state.source === 'gitee' && asset.giteeUrl) href = asset.giteeUrl;
    else if (state.source === 'gitee') {
      href = asset.url; // 镜像缺失时静默回退官方直链，meta 里说明
      const missing = `Gitee 未同步该文件（超 100MB 上限），已回退 GitHub 直连`;
      els.ctaMeta.textContent = `${asset.name} · ${formatSize(asset.size)} · ${missing}`;
      els.ctaButton.href = href;
      els.ctaButtonText.textContent = `下载 ${asset.label}`;
      return;
    } else {
      href = (SOURCE_PREFIX[state.source] || '') + asset.url;
    }
    els.ctaMeta.textContent = `${asset.name} · ${formatSize(asset.size)} · ${SOURCE_LABELS[state.source]}`;
    els.ctaButton.href = href;
    els.ctaButtonText.textContent = `下载 ${asset.label}`;
  }

  function renderChangelog(rel) {
    els.releaseNotes.innerHTML = rel.body ? renderMarkdown(rel.body) : '<p>该版本没有填写更新说明。</p>';
  }

  function renderChecksumLink(rel) {
    if (state.source === 'gitee' && rel.giteeChecksumsUrl) {
      els.checksumsLink.href = rel.giteeChecksumsUrl;
      return;
    }
    els.checksumsLink.href = rel.checksumsUrl || rel.htmlUrl || GITHUB_RELEASES_PAGE;
  }

  // ---------- 数据加载（三级降级） ----------

  async function loadData() {
    // 1) Worker 归一化 API（正常路径）
    try {
      const res = await fetch(WORKER_URL);
      if (!res.ok) throw new Error(`worker ${res.status}`);
      const payload = await res.json();
      if (payload && Array.isArray(payload.releases) && payload.releases.length) {
        await enterFullMode(payload.releases);
        return;
      }
      throw new Error('worker returned empty payload');
    } catch { /* 继续降级 */ }

    // 2) 浏览器直连 GitHub（用访客自己的 IP 配额；不做资产分类）
    try {
      const res = await fetch(GITHUB_RELEASES_URL, {
        headers: { Accept: 'application/vnd.github.v3+json' },
      });
      if (!res.ok) throw new Error(`github ${res.status}`);
      const releases = await res.json();
      if (Array.isArray(releases) && releases.length) {
        enterRawMode(releases);
        return;
      }
    } catch { /* 继续降级 */ }

    // 3) 内置静态兜底表
    enterStaticMode();
  }

  // ---------- 事件 ----------

  function bindEvents() {
    els.channelSelect.addEventListener('change', () => {
      state.channel = els.channelSelect.value;
      if (state.channel === 'stable') {
        state.versionTag = (state.channels.stable || state.channels.all[0] || {}).tag || state.versionTag;
      } else if (state.channel === 'prerelease') {
        state.versionTag = (state.channels.prerelease || {}).tag || state.versionTag;
      }
      els.versionField.hidden = state.channel !== 'history';
      if (state.channel === 'history') els.versionSelect.value = state.versionTag || '';
      renderAll();
    });

    els.versionSelect.addEventListener('change', () => {
      state.versionTag = els.versionSelect.value;
      renderAll();
    });

    els.osSelect.addEventListener('change', () => {
      state.osFilter = els.osSelect.value;
      renderTable(currentRelease());
    });

    els.archSelect.addEventListener('change', () => {
      state.archFilter = els.archSelect.value;
      renderTable(currentRelease());
    });

    els.sourceSelect.addEventListener('change', () => {
      state.source = els.sourceSelect.value;
      const rel = currentRelease();
      if (!rel) return;
      renderTable(rel);
      renderCta(rel);
      renderChecksumLink(rel);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { bindEvents(); loadData(); });
  } else {
    bindEvents();
    loadData();
  }
})();
