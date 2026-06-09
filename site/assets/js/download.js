/* ==========================================================================
   Education Advisor · 下载页交互
   通道切换 + GitHub 加速 + 操作系统/架构/类型筛选
   ========================================================================== */
(function(){
  'use strict';

  /* ---------- 1. 资产元数据 ---------- */
  // 真实可下载的资产（v0.1.0-rc.1）
  // 实际文件：release/Education.Advisor-0.1.0-rc.1-Setup.exe (88MB)
  //          release/Education.Advisor-0.1.0-rc.1-portable.exe (78MB)
  // macOS / Linux 等待 CI 补齐，先用占位条目（自动显示"待发布"标签）
  const REPO = 'https://github.com/232252/education-advisor';
  const STABLE_TAG = 'v0.1.0-rc.1';
  const BETA_TAG = 'v3.1.2';   // CLI-only 旧版（归档在 core 子仓）

  // 表格数据
  const ROWS = [
    // Windows
    { os:'Windows', arch:'x86_64', type:'installer', file:'Education.Advisor-0.1.0-rc.1-Setup.exe',
      size:'88 MB', note:'推荐 · 自动注册服务 · 关联文件类型 · 卸载干净',
      stable:true, beta:false, sha:'8108aff557bcc9f06bd5a8dbfe317bb984e93a1603fc8cc6f020c20f77e2efcd' },
    { os:'Windows', arch:'x86_64', type:'portable', file:'Education.Advisor-0.1.0-rc.1-portable.exe',
      size:'78 MB', note:'无需安装 · 双击运行 · 适合 U 盘/无管理员权限',
      stable:true, beta:false, sha:'ef962dd1807643cd95a1afcb696bb56a84ea77f9dfad5c398ea096cbea94f89d' },

    // macOS（CI 待补 — 显示但标记"待发布"）
    { os:'macOS', arch:'arm64', type:'dmg', file:'Education.Advisor-0.1.0-rc.1-arm64.dmg',
      size:'≈ 113 MB', note:'Apple Silicon · 首次启动需 xattr -c /Applications/Education\\ Advisor.app',
      stable:true, beta:false, pending:true },
    { os:'macOS', arch:'x86_64', type:'dmg', file:'Education.Advisor-0.1.0-rc.1.dmg',
      size:'≈ 117 MB', note:'Intel · 首次启动需 xattr -c /Applications/Education\\ Advisor.app',
      stable:true, beta:false, pending:true },

    // Linux（CI 待补 — 显示但标记"待发布"）
    { os:'Linux', arch:'x86_64', type:'appimage', file:'Education.Advisor-0.1.0-rc.1.AppImage',
      size:'≈ 123 MB', note:'可执行 · chmod +x 后双击运行',
      stable:true, beta:false, pending:true },
    { os:'Linux', arch:'arm64', type:'appimage', file:'Education.Advisor-0.1.0-rc.1-arm64.AppImage',
      size:'≈ 120 MB', note:'ARM64 Linux · 树莓派 5 / 服务器',
      stable:true, beta:false, pending:true },
    { os:'Linux', arch:'x86_64', type:'deb', file:'education-advisor_0.1.0-rc.1_amd64.deb',
      size:'≈ 88 MB', note:'Debian / Ubuntu · apt 安装',
      stable:true, beta:false, pending:true },

    // 历史归档：v3.x CLI（beta 通道显示）
    { os:'Linux', arch:'x86_64', type:'tarball', file:'eaa-cli-x86_64-unknown-linux-gnu.tar.xz',
      size:'≈ 19.5 MB', note:'v3.x CLI · Rust 引擎 · 仅命令行 · 归档保留',
      stable:false, beta:true, pending:false },
  ];

  // 操作系统图标（用纯 inline SVG）
  const OS_ICONS = {
    'Windows': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M0 3.449L9.75 2.1v9.451H0M10.949 1.949L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/></svg>',
    'macOS': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09M12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25"/></svg>',
    'Linux': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 0 0-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68a1.36 1.36 0 0 0-.157.706c.014.226.075.435.097.658.014.286-.077.51-.413.822-.398.367-.55.762-.578 1.115a1.41 1.41 0 0 0 .165.838c.103.18.224.327.32.483.137.222.245.422.232.616-.024.305-.183.5-.42.692a2.122 2.122 0 0 1-.617.43c-.015.397-.078.796-.27 1.107-.157.254-.382.422-.654.543a2.486 2.486 0 0 1-.918.232 2.4 2.4 0 0 1-1.108-.226c.027.422-.143.864-.518 1.197-.222.198-.51.318-.78.395a2.984 2.984 0 0 1-1.22.045 1.65 1.65 0 0 1-.626-.305 1.07 1.07 0 0 1-.34-.585c-.058-.262-.04-.5.054-.714a1.12 1.12 0 0 1 .475-.51c.21-.13.464-.205.716-.27.103-.027.2-.054.298-.084a.554.554 0 0 1 .262-.041c.182.013.302.07.426.155.123.084.236.198.405.198a.587.587 0 0 0 .317-.083c.083-.057.135-.123.198-.198.054-.068.116-.13.198-.166.083-.034.184-.034.295-.014.112.014.232.041.345.014a.78.78 0 0 0 .328-.166c.087-.083.155-.18.205-.27.05-.097.085-.198.092-.295.014-.198-.04-.396-.143-.57a1.18 1.18 0 0 0-.317-.367 1.35 1.35 0 0 0-.555-.225c-.198-.04-.426-.04-.617.014a.95.95 0 0 0-.487.282c-.123.143-.198.32-.198.51 0 .184.075.353.198.495l.04.04a.43.43 0 0 1-.04.05c-.123.13-.295.198-.487.198a.96.96 0 0 1-.5-.143c-.155-.097-.262-.236-.328-.396a1.13 1.13 0 0 1-.097-.51c.014-.198.07-.396.198-.555a1.34 1.34 0 0 1 .426-.367c.166-.097.345-.166.543-.198a1.74 1.74 0 0 1 .598 0c.198.027.396.083.555.166.166.084.31.198.426.345.123.143.198.31.232.487a1.13 1.13 0 0 1-.04.51 1.18 1.18 0 0 1-.226.422c-.04.05-.087.097-.143.143a1.41 1.41 0 0 0 .295-.04c.198-.057.396-.143.555-.27a1.6 1.6 0 0 0 .426-.51c.123-.198.198-.426.198-.666 0-.184-.04-.367-.123-.543a1.4 1.4 0 0 0-.345-.482 1.62 1.62 0 0 0-.51-.328 1.84 1.84 0 0 0-.598-.123 1.7 1.7 0 0 0-.6.123 1.62 1.62 0 0 0-.51.328 1.4 1.4 0 0 0-.345.482c-.083.176-.123.36-.123.543v.04a1.74 1.74 0 0 0-.598-.04 1.84 1.84 0 0 0-.598.123 1.62 1.62 0 0 0-.51.328 1.4 1.4 0 0 0-.345.482 1.18 1.18 0 0 0-.123.51c0 .184.04.367.123.51.083.166.198.31.345.426.143.123.31.198.51.226.198.04.396.04.555-.014.166-.04.31-.123.426-.226.123-.123.198-.27.226-.426.04-.166.014-.328-.04-.482a.94.94 0 0 0-.226-.396.95.95 0 0 0-.396-.226 1.13 1.13 0 0 0-.482-.04 1.18 1.18 0 0 0-.422.143.95.95 0 0 1 .27-.04c.198-.014.396.04.555.155a.9.9 0 0 1 .328.426c.07.166.084.345.04.51a.94.94 0 0 1-.226.396.95.95 0 0 1-.396.226c-.166.057-.345.07-.51.027a1.13 1.13 0 0 1-.482-.198.94.94 0 0 1-.295-.396.95.95 0 0 1-.04-.482c.027-.166.097-.328.198-.482.123-.155.27-.27.426-.367.166-.097.345-.166.543-.198a1.74 1.74 0 0 1 .598 0c.198.027.396.083.555.166.166.084.31.198.426.345.123.143.198.31.232.487a1.13 1.13 0 0 1-.04.51 1.18 1.18 0 0 1-.226.422.95.95 0 0 1-.396.27 1.13 1.13 0 0 1-.482.04 1.18 1.18 0 0 1-.422-.143z"/></svg>',
  };

  /* ---------- 2. 状态 ---------- */
  const state = {
    channel: 'stable',   // 'stable' | 'beta'
    accel: '',
    os: '',
    arch: '',
    type: '',
  };

  /* ---------- 3. DOM ---------- */
  const $ = (id) => document.getElementById(id);
  const els = {
    channel: $('channelSelect'),
    accel: $('ghAccelSelect'),
    os: $('osSelect'),
    arch: $('archSelect'),
    type: $('typeSelect'),
    tbody: $('dlTableBody'),
    releaseTitle: $('releaseTitle'),
    releaseLink: $('releaseLink'),
  };

  if (!els.tbody) return;

  /* ---------- 4. URL 拼接 ---------- */
  function buildUrl(file) {
    if (state.channel === 'stable'){
      if (state.accel) return state.accel + REPO + '/releases/download/' + STABLE_TAG + '/' + file;
      return REPO + '/releases/download/' + STABLE_TAG + '/' + file;
    } else {
      // beta：跳到子仓 core release
      if (state.accel) return state.accel + 'https://github.com/232252/education-advisor/releases/tag/' + BETA_TAG;
      return 'https://github.com/232252/education-advisor/releases/tag/' + BETA_TAG;
    }
  }

  /* ---------- 5. 渲染 ---------- */
  function render(){
    const tag = state.channel === 'stable' ? STABLE_TAG : BETA_TAG;
    els.releaseTitle.innerHTML = state.channel === 'stable'
      ? `Education Advisor <span style="background:var(--grad-brand);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent">${tag}</span>`
      : `Education Advisor CLI <span style="color:var(--c-text-3)">${tag}</span> <small style="font-size:14px;color:var(--c-text-3);font-weight:500;margin-left:8px">· 旧版 CLI · 归档</small>`;
    els.releaseLink.href = state.channel === 'stable'
      ? `${REPO}/releases/tag/${tag}`
      : `https://github.com/232252/education-advisor/releases/tag/${tag}`;

    // 过滤
    const list = ROWS.filter(r => {
      if (state.channel === 'stable' && !r.stable) return false;
      if (state.channel === 'beta'   && !r.beta)   return false;
      if (state.os   && r.os   !== state.os)   return false;
      if (state.arch && r.arch !== state.arch) return false;
      if (state.type && r.type !== state.type) return false;
      return true;
    });

    if (list.length === 0){
      els.tbody.innerHTML = `<tr><td colspan="4"><div class="dl-table-empty">没有匹配的下载项 · 试试切换筛选条件或 <a href="${REPO}/releases" target="_blank" rel="noopener noreferrer" style="color:var(--c-accent)">去 GitHub Releases</a> 查看所有历史版本</div></td></tr>`;
      return;
    }

    els.tbody.innerHTML = list.map(r => {
      const icon = OS_ICONS[r.os] || '';
      const archBadge = `<span class="dl-arch-tag">${r.arch}</span>`;
      const typeMap = { installer:'安装版', portable:'便携版', dmg:'DMG', appimage:'AppImage', deb:'DEB', tarball:'tarball' };
      const typeLabel = typeMap[r.type] || r.type;
      const isPending = !!r.pending;
      const fileCell = isPending
        ? `<a class="dl-link alt" href="https://github.com/232252/education-advisor/issues" target="_blank" rel="noopener noreferrer" title="关注构建进度">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
             等待发布
             <span style="color:var(--c-text-3);font-weight:400">(${r.size})</span>
           </a>`
        : `<a class="dl-link" href="${buildUrl(r.file)}" rel="noopener noreferrer" data-file="${r.file}">${r.file} <span style="color:var(--c-text-3);font-weight:400">(${r.size})</span></a>`;
      return `
        <tr>
          <td>
            <span class="dl-os-cell">${icon} ${r.os}</span>
          </td>
          <td>${archBadge}</td>
          <td>${fileCell}</td>
          <td style="color:var(--c-text-3);font-size:12.5px;white-space:normal;max-width:380px">${r.note || '—'}</td>
        </tr>
      `;
    }).join('');
  }

  /* ---------- 6. 事件 ---------- */
  function bindSelect(el, key){
    if (!el) return;
    el.addEventListener('change', (e) => {
      state[key] = e.target.value;
      render();
    });
  }
  bindSelect(els.channel, 'channel');
  bindSelect(els.accel, 'accel');
  bindSelect(els.os, 'os');
  bindSelect(els.arch, 'arch');
  bindSelect(els.type, 'type');

  /* ---------- 7. 首次渲染 ---------- */
  render();

  /* ---------- 8. 处理 URL hash（如 #windows / #mac） ---------- */
  function applyHash(){
    const h = (location.hash || '').toLowerCase().replace('#','');
    if (!h) return;
    const map = { 'windows':'Windows', 'win':'Windows', 'mac':'macOS', 'macos':'macOS', 'linux':'Linux' };
    if (map[h]){
      els.os.value = map[h];
      state.os = map[h];
      render();
    }
  }
  applyHash();
  window.addEventListener('hashchange', applyHash);

})();
