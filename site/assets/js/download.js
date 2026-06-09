/* ==========================================================================
   Education Advisor · 下载页（v2）
   从 GitHub Releases 实时同步：tag_name / published_at / assets / SHA256SUMS
   ========================================================================== */
(function(){
  'use strict';

  /* ---------- 1. 配置 ---------- */
  const REPO_OWNER = '232252';
  const REPO_NAME  = 'education-advisor';
  const RELEASES_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases`;
  const CACHE_KEY = 'eea_gh_releases_v2';
  const CACHE_TTL_MS = 10 * 60 * 1000;        // 10 min 软过期
  const CACHE_HARD_MS = 24 * 60 * 60 * 1000;  // 24h 硬上限（强制重新拉）

  /* ---------- 2. DOM ---------- */
  const $ = (id) => document.getElementById(id);
  const els = {
    bannerTag:       $('bannerReleaseTag'),
    bannerDate:      $('bannerReleaseDate'),
    channelStable:   $('channelStableTag'),
    releaseTitle:    $('releaseTitle'),
    releaseLink:     $('releaseLink'),
    tbody:           $('dlTableBody'),
    shaBlock:        $('shaBlock'),
    channel:         $('channelSelect'),
    accel:           $('ghAccelSelect'),
    os:              $('osSelect'),
    arch:            $('archSelect'),
    type:            $('typeSelect'),
  };

  if (!els.tbody) return; // 仅在下载页运行

  /* ---------- 3. 状态 ---------- */
  const state = { channel:'stable', accel:'', os:'', arch:'', type:'' };

  /* ---------- 4. 缓存层 ---------- */
  function readCache(){
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !Array.isArray(obj.data)) return null;
      if (Date.now() - obj.ts > CACHE_HARD_MS) return null;
      return obj;
    } catch(_) { return null; }
  }
  function writeCache(data){
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); }
    catch(_) {}
  }

  /* ---------- 5. 拉取 releases ---------- */
  async function fetchReleases(){
    const cached = readCache();
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      // 软新鲜：立即返回，后台静默刷新
      backgroundRefresh();
      return cached.data;
    }
    try {
      const res = await fetch(RELEASES_API, {
        headers: { 'Accept': 'application/vnd.github+json' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      writeCache(data);
      return data;
    } catch (e) {
      if (cached) {
        console.warn('[eea-dl] API failed, serving stale cache:', e.message);
        return cached.data;
      }
      throw e;
    }
  }
  function backgroundRefresh(){
    fetch(RELEASES_API, { headers: { 'Accept': 'application/vnd.github+json' }})
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(data => { writeCache(data); render(); })
      .catch(() => {});
  }

  /* ---------- 6. 选 desktop release ----------
     优先匹配资产名包含 education.advisor 的最近 release（兼容 prerelease）。
     找不到再退回到最近的非 draft release。*/
  function pickDesktopRelease(releases){
    if (!Array.isArray(releases) || releases.length === 0) return null;
    const desktopPattern = /education[\s._-]?advisor/i;
    const desktop = releases
      .filter(r => !r.draft)
      .filter(r => (r.assets || []).some(a => desktopPattern.test(a.name || '')))
      .sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
    if (desktop.length) return desktop[0];
    const fallback = releases
      .filter(r => !r.draft)
      .sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
    return fallback[0] || null;
  }

  /* ---------- 7. 资产名 → (os, arch, type) ---------- */
  function classifyAsset(asset){
    const name = asset.name || '';
    // 跳过元数据 / 校验文件
    if (/^(sha256|checksums?|signature|manifest|.*\.sig|.*\.asc|.*\.sha256)$/i.test(name)) return null;
    if (/\.(sha256|sig|asc|pub)$/i.test(name)) return null;

    let os = null, type = null;
    if (/\.dmg$/i.test(name))       { os='macOS';  type='dmg'; }
    else if (/\.pkg$/i.test(name))  { os='macOS';  type='pkg'; }
    else if (/\.exe$/i.test(name))  { os='Windows'; type = /portable/i.test(name) ? 'portable' : 'installer'; }
    else if (/\.appimage$/i.test(name)) { os='Linux'; type='appimage'; }
    else if (/\.deb$/i.test(name))  { os='Linux';  type='deb'; }
    else if (/\.rpm$/i.test(name))  { os='Linux';  type='rpm'; }
    else { return null; }

    let arch = 'x86_64'; // 桌面端默认 64-bit
    if (/arm64|aarch64/i.test(name))      arch = 'arm64';
    else if (/x86_64|amd64/i.test(name))  arch = 'x86_64';
    else if (/(?:^|[^a-z])x86(?![0-9])|i[3-6]86/i.test(name)) arch = 'x86';

    return { os, arch, type, asset };
  }

  /* ---------- 8. 解析 SHA-256 ----------
     GitHub API 已经在每个 asset 上带 digest 字段（"sha256:<hex>"），免去
     二次抓 SHA256SUMS。CORS / 重定向问题也消失。仅作为补强，回退去抓
     SHA256SUMS / SHA256.txt 等旁挂文件。*/
  function parseApiSha(release){
    const map = {};
    (release.assets || []).forEach(a => {
      if (a.digest && /^sha256:/i.test(a.digest)) {
        map[a.name] = a.digest.replace(/^sha256:/i, '').toLowerCase();
      }
    });
    return map;
  }
  async function fetchSupplementarySha(release){
    const meta = (release.assets || []).find(a => /^sha256/i.test(a.name) && !/\.(sig|asc)$/i.test(a.name));
    if (!meta) return {};
    try {
      const res = await fetch(meta.browser_download_url, { cache: 'no-store' });
      if (!res.ok) return {};
      const text = await res.text();
      const out = {};
      text.split(/\r?\n/).forEach(line => {
        const m = line.match(/^([a-f0-9]{64})\s+\*?(.+?)\s*$/i);
        if (m) out[m[2].trim()] = m[1].toLowerCase();
      });
      return out;
    } catch(_) { return {}; }
  }

  /* ---------- 9. 工具 ---------- */
  function formatBytes(n){
    if (typeof n !== 'number') return '';
    if (n < 1024) return n + ' B';
    if (n < 1024*1024) return (n/1024).toFixed(1) + ' KB';
    if (n < 1024*1024*1024) return (n/1024/1024).toFixed(1) + ' MB';
    return (n/1024/1024/1024).toFixed(2) + ' GB';
  }
  function formatDate(iso){
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }
  function buildDownloadUrl(asset){
    const raw = asset.browser_download_url;
    if (state.accel && /^https?:\/\/(?:[^\/]+\.)?github\.com\//i.test(raw)) {
      return state.accel.replace(/\/$/, '') + '/' + raw;
    }
    return raw;
  }
  const RELEASE_NOTE_BY_TYPE = (asset) => {
    const n = (asset.name||'').toLowerCase();
    if (/-setup/i.test(n))        return '推荐 · 安装版 · 卸载干净';
    if (/portable/i.test(n))      return '便携版 · 无需安装';
    if (/\.appimage$/i.test(n))   return '可执行 · chmod +x 后双击运行';
    if (/\.dmg$/i.test(n))        return '挂载 DMG 后拖入 Applications';
    if (/\.deb$/i.test(n))        return 'Debian / Ubuntu · apt 安装';
    if (/\.rpm$/i.test(n))        return 'Fedora / RHEL · dnf/yum 安装';
    return '—';
  };

  /* ---------- 10. 静态 Beta 通道（v3.x CLI 归档） ---------- */
  const BETA_ROWS = [
    { os:'Linux', arch:'x86_64', type:'tarball', _isBeta:true,
      asset:{ name:'eaa-cli-x86_64-unknown-linux-gnu.tar.xz', size:19.5*1024*1024,
              browser_download_url:'https://github.com/232252/education-advisor/releases/tag/v3.1.2' },
      note:'v3.x CLI · Rust 引擎 · 仅命令行 · 归档保留' }
  ];
  const BETA_TAG = 'v3.1.2';

  /* ---------- 11. 当前 release 引用 ---------- */
  let currentRelease = null;
  let currentShaMap  = {};
  let currentShaUrl  = null;

  /* ---------- 12. 渲染 ---------- */
  function render(){
    if (state.channel === 'beta') renderBeta();
    else renderStable();
  }

  function renderBeta(){
    if (els.releaseTitle) {
      els.releaseTitle.innerHTML =
        `Education Advisor CLI <span style="color:var(--c-text-3)">${BETA_TAG}</span>` +
        ` <small style="font-size:14px;color:var(--c-text-3);font-weight:500;margin-left:8px">· 旧版 CLI · 归档</small>`;
    }
    if (els.releaseLink) els.releaseLink.href = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag/${BETA_TAG}`;
    renderRows(BETA_ROWS);
    renderShaBlock(null);
  }

  function renderStable(){
    if (!currentRelease) return;
    const tag = currentRelease.tag_name;
    if (els.releaseTitle) {
      els.releaseTitle.innerHTML =
        `Education Advisor <span style="background:var(--grad-brand);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent">${tag}</span>`;
    }
    if (els.releaseLink) els.releaseLink.href = currentRelease.html_url;
    if (els.bannerTag)   els.bannerTag.textContent = tag;
    if (els.bannerDate)  els.bannerDate.textContent = `发布于 ${formatDate(currentRelease.published_at)}`;
    if (els.channelStable) els.channelStable.textContent = tag;

    const rows = (currentRelease.assets || []).map(classifyAsset).filter(Boolean);
    renderRows(rows);
    renderShaBlock(currentShaMap);
  }

  function renderRows(rows){
    const list = rows.filter(r => {
      if (state.os   && r.os   !== state.os)   return false;
      if (state.arch && r.arch !== state.arch) return false;
      if (state.type && r.type !== state.type) return false;
      return true;
    });
    if (list.length === 0){
      els.tbody.innerHTML =
        `<tr><td colspan="4"><div class="dl-table-empty">` +
        `没有匹配的下载项 · 试试切换筛选条件或 ` +
        `<a href="https://github.com/${REPO_OWNER}/${REPO_NAME}/releases" target="_blank" rel="noopener noreferrer" style="color:var(--c-accent)">` +
        `去 GitHub Releases 查看所有历史版本</a></div></td></tr>`;
      return;
    }

    const OS_ICON = {
      Windows: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M0 3.449L9.75 2.1v9.451H0m10.949-1.5L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/></svg>',
      macOS:   '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09M12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25"/></svg>',
      Linux:   '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489.024.155.097.29.21.4.103.103.232.166.4.21.157.04.31.04.46 0 .143-.04.27-.103.4-.21.103-.103.166-.232.21-.4.04-.157.04-.31 0-.46-.04-.143-.103-.27-.21-.4l-.05-.05c-.097-.103-.21-.166-.345-.21-.143-.04-.287-.04-.43 0-.143.04-.27.103-.4.21-.097.097-.166.21-.21.345-.04.143-.04.287 0 .43.024.123.07.232.143.345z"/></svg>',
    };
    const TYPE_LABEL = { installer:'安装版', portable:'便携版', dmg:'DMG', pkg:'PKG', appimage:'AppImage', deb:'DEB', rpm:'RPM', tarball:'tarball' };

    els.tbody.innerHTML = list.map(r => {
      const icon = OS_ICON[r.os] || '';
      const archBadge = `<span class="dl-arch-tag">${r.arch}</span>`;
      const typeLabel = TYPE_LABEL[r.type] || r.type;
      const sizeStr = r.asset && typeof r.asset.size === 'number' ? formatBytes(r.asset.size) : '';
      const fileName = r.asset ? r.asset.name : '';
      const note = r.note || (r.asset ? RELEASE_NOTE_BY_TYPE(r.asset) : '—');
      const fileCell = r._isBeta
        ? `<a class="dl-link alt" href="${r.asset.browser_download_url}" target="_blank" rel="noopener noreferrer" data-file="${fileName}">${fileName || '查看版本页'} <span style="color:var(--c-text-3);font-weight:400">(${sizeStr})</span></a>`
        : `<a class="dl-link" href="${buildDownloadUrl(r.asset)}" rel="noopener noreferrer" data-file="${fileName}" download>${fileName} <span style="color:var(--c-text-3);font-weight:400">(${sizeStr})</span></a>`;
      return `
        <tr>
          <td><span class="dl-os-cell">${icon} ${r.os}</span></td>
          <td>${archBadge}</td>
          <td>${fileCell}</td>
          <td style="color:var(--c-text-3);font-size:12.5px;white-space:normal;max-width:380px">${note}</td>
        </tr>
      `;
    }).join('');
  }

  function renderShaBlock(shaMap){
    if (!els.shaBlock) return;
    if (!shaMap || Object.keys(shaMap).length === 0){
      els.shaBlock.innerHTML =
        `<span class="com"># 当前 release 未提供任何 SHA-256 摘要</span>\n` +
        `<span class="com"># 或直接看：</span>\n` +
        `<a href="${currentRelease ? currentRelease.html_url : `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`}" target="_blank" rel="noopener noreferrer">GitHub Release 页面</a>`;
      return;
    }
    // 只列出本 release 中实际有的资产
    const realNames = new Set(
      (currentRelease && currentRelease.assets ? currentRelease.assets : [])
        .map(a => a.name)
        .filter(n => /\.(exe|dmg|pkg|appimage|deb|rpm)$/i.test(n))
    );
    const lines = Object.entries(shaMap)
      .filter(([name]) => realNames.has(name))
      .map(([name, hash]) => `<span class="com"># ${hash}</span>\n  ${name}`)
      .join('\n');
    if (!lines) {
      els.shaBlock.innerHTML =
        `<span class="com"># 当前 release 中无桌面资产的 SHA-256 摘要</span>`;
      return;
    }
    els.shaBlock.innerHTML =
      `${lines}\n\n` +
      `<span class="com"># Windows 验证（PowerShell）</span>\n` +
      `Get-FileHash .\\&lt;文件名&gt;\n\n` +
      `<span class="com"># macOS / Linux 验证</span>\n` +
      `shasum -a 256 &lt;文件名&gt;` +
      (currentShaUrl ? `\n\n<span class="com"># 完整校验集：</span> <a href="${currentShaUrl}" target="_blank" rel="noopener noreferrer" style="color:var(--c-accent)">${currentShaUrl.split('/').pop()}</a>` : '');
  }

  /* ---------- 13. 事件 ---------- */
  function bindSelect(el, key){
    if (!el) return;
    el.addEventListener('change', e => { state[key] = e.target.value; render(); });
  }
  bindSelect(els.channel, 'channel');
  bindSelect(els.accel,   'accel');
  bindSelect(els.os,      'os');
  bindSelect(els.arch,    'arch');
  bindSelect(els.type,    'type');

  /* ---------- 14. URL hash 跳转 ---------- */
  function applyHash(){
    const h = (location.hash || '').toLowerCase().replace('#','');
    if (!h) return;
    const map = { 'windows':'Windows', 'win':'Windows', 'mac':'macOS', 'macos':'macOS', 'linux':'Linux' };
    if (map[h] && els.os){
      els.os.value = map[h];
      state.os = map[h];
      render();
    }
  }
  applyHash();
  window.addEventListener('hashchange', applyHash);

  /* ---------- 15. 启动 ---------- */
  async function init(){
    // 加载态
    els.tbody.innerHTML =
      `<tr><td colspan="4"><div class="dl-table-empty">正在从 GitHub 加载最新版本信息…</div></td></tr>`;
    if (els.shaBlock) {
      els.shaBlock.innerHTML = `<span class="com"># 正在加载…</span>`;
    }

    try {
      const releases = await fetchReleases();
      const desktop  = pickDesktopRelease(releases);
      if (!desktop) throw new Error('未找到任何桌面端 release');

      currentRelease = desktop;
      // 1) 优先用 API 自带的 digest（无二次请求）
      currentShaMap = parseApiSha(desktop);
      // 2) 补强：拉 SHA256SUMS 旁挂文件，覆盖 API 没给 digest 的旧 release
      fetchSupplementarySha(desktop).then(extra => {
        Object.assign(currentShaMap, extra);
        renderShaBlock(currentShaMap);
      }).catch(() => {});

      render();
    } catch (e) {
      console.error('[eea-dl] init failed:', e);
      els.tbody.innerHTML =
        `<tr><td colspan="4"><div class="dl-table-empty">` +
        `无法从 GitHub 加载 release 信息（${e.message}）<br/><br/>` +
        `<a href="https://github.com/${REPO_OWNER}/${REPO_NAME}/releases" target="_blank" rel="noopener noreferrer" style="color:var(--c-accent)">` +
        `直接前往 GitHub Releases 页面 →</a></div></td></tr>`;
      if (els.releaseTitle) {
        els.releaseTitle.innerHTML =
          `Education Advisor <span style="color:var(--c-text-3)">加载失败</span>`;
      }
      if (els.releaseLink) els.releaseLink.href = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`;
    }
  }

  init();

})();