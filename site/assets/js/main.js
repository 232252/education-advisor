/* ==========================================================================
   Education Advisor · 官网主交互
   轻量原生 JS，无依赖
   ========================================================================== */
(function(){
  'use strict';

  /* ---------- 1. 导航：滚动压实 + 移动端菜单 + 章节高亮 ---------- */
  const nav = document.getElementById('nav');
  const navToggle = document.getElementById('navToggle');
  const navMobile = document.getElementById('navMobile');
  const navLinks = document.querySelectorAll('.nav-links a, .nav-mobile a');

  // 滚动压实
  let lastY = 0, ticking = false;
  function onScroll(){
    const y = window.scrollY;
    if (nav){
      if (y > 16) nav.classList.add('is-stuck');
      else nav.classList.remove('is-stuck');
    }
    // 回到顶部按钮
    if (backTop){
      if (y > 480) backTop.classList.add('is-visible');
      else backTop.classList.remove('is-visible');
    }
    // 章节高亮
    if (navLinks.length){
      highlightSection(y);
    }
    lastY = y;
    ticking = false;
  }
  function requestTick(){
    if (!ticking){
      requestAnimationFrame(onScroll);
      ticking = true;
    }
  }
  window.addEventListener('scroll', requestTick, { passive: true });

  // 移动端菜单
  if (navToggle && navMobile){
    navToggle.addEventListener('click', () => {
      const open = navMobile.classList.toggle('is-open');
      navToggle.classList.toggle('is-open', open);
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      document.body.style.overflow = open ? 'hidden' : '';
    });
    navMobile.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        navMobile.classList.remove('is-open');
        navToggle.classList.remove('is-open');
        navToggle.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      });
    });
  }

  // 章节高亮
  const sectionMap = {};
  navLinks.forEach(a => {
    const id = (a.getAttribute('href') || '').replace('#','');
    if (id) sectionMap[id] = sectionMap[id] || [];
    if (id) sectionMap[id].push(a);
  });
  const sections = Object.keys(sectionMap)
    .map(id => document.getElementById(id))
    .filter(Boolean);
  function highlightSection(y){
    const offset = 120;
    let current = sections[0]?.id;
    for (const sec of sections){
      if (sec.offsetTop - offset <= y) current = sec.id;
    }
    Object.entries(sectionMap).forEach(([id, links]) => {
      links.forEach(l => l.classList.toggle('is-active', id === current));
    });
  }

  /* ---------- 2. 回到顶部 ---------- */
  const backTop = document.getElementById('backTop');
  if (backTop){
    backTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ---------- 3. 滚动揭示（IntersectionObserver） ---------- */
  const revealEls = document.querySelectorAll('[data-reveal]');
  if ('IntersectionObserver' in window && revealEls.length){
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting){
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    revealEls.forEach(el => io.observe(el));
  } else {
    revealEls.forEach(el => el.classList.add('is-in'));
  }

  /* ---------- 4. 数字滚动（统计区） ---------- */
  const numEls = document.querySelectorAll('[data-num]');
  if ('IntersectionObserver' in window && numEls.length){
    const numIo = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        animateNum(entry.target);
        numIo.unobserve(entry.target);
      });
    }, { threshold: 0.4 });
    numEls.forEach(el => numIo.observe(el));
  }
  function animateNum(el){
    const target = parseFloat(el.getAttribute('data-num')) || 0;
    const dur = parseInt(el.getAttribute('data-num-dur')) || 1400;
    const decimals = parseInt(el.getAttribute('data-num-dec')) || 0;
    const suffix = el.getAttribute('data-num-suffix') || '';
    const start = performance.now();
    function frame(now){
      const p = Math.min(1, (now - start) / dur);
      // ease-out
      const e = 1 - Math.pow(1 - p, 3);
      const v = target * e;
      el.textContent = (decimals ? v.toFixed(decimals) : Math.floor(v).toLocaleString()) + suffix;
      if (p < 1) requestAnimationFrame(frame);
      else el.textContent = (decimals ? target.toFixed(decimals) : target.toLocaleString()) + suffix;
    }
    requestAnimationFrame(frame);
  }

  /* ---------- 5. Dashboard 实时警报插入（hero mockup） ---------- */
  const feed = document.getElementById('dmFeed');
  if (feed){
    const items = [
      { t: '00:00:12', text: 'class-monitor 写入：S_017 作业 +2', dot: 'ok' },
      { t: '00:00:18', text: 'privacy engine：2 个 PII 已脱敏', dot: 'info' },
      { t: '00:00:24', text: 'risk-alert 触发：S_032 14 日下降', dot: 'warn' },
      { t: '00:00:31', text: 'governor 通过一致性审计 ✓', dot: 'ok' },
      { t: '00:00:40', text: 'feishu 同步：bitable 已更新', dot: 'info' },
      { t: '00:00:48', text: 'counselor 生成 3 份谈话草稿', dot: 'info' },
    ];
    let i = 0;
    function push(){
      const it = items[i % items.length];
      const row = document.createElement('div');
      row.className = 'dm-feed-item';
      const colorMap = { ok: 'var(--c-success)', info: 'var(--c-accent)', warn: 'var(--c-warn)' };
      row.innerHTML = `<span class="dm-feed-dot" style="background:${colorMap[it.dot]||'var(--c-accent)'}"></span>
                       <span class="dm-feed-time">${it.t}</span>
                       <span>${it.text}</span>`;
      feed.insertBefore(row, feed.firstChild);
      // 上限
      while (feed.children.length > 4) feed.removeChild(feed.lastChild);
      i++;
    }
    // 初始化几条
    push(); push(); setTimeout(push, 600);
    setInterval(push, 2200 + Math.random() * 800);
  }

  /* ---------- 6. Dashboard 数字滚动动画（hero） ---------- */
  const dmCards = document.querySelectorAll('.dm-card-value');
  if (dmCards.length){
    const targets = [47, 23, 5];
    dmCards.forEach((el, idx) => {
      const target = targets[idx] || 0;
      const start = performance.now() + idx * 200;
      const dur = 1200;
      function tick(now){
        if (now < start) { requestAnimationFrame(tick); return; }
        const p = Math.min(1, (now - start) / dur);
        const e = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.floor(target * e);
        if (p < 1) requestAnimationFrame(tick);
        else el.textContent = target;
      }
      requestAnimationFrame(tick);
    });
  }

  /* ---------- 7. 平台检测 + 下载按钮智能跳转 ---------- */
  const platform = (function(){
    const ua = navigator.userAgent;
    if (/Windows/i.test(ua)) return 'windows';
    if (/Mac/i.test(ua)) return 'mac';
    if (/Linux/i.test(ua) && !/Android/i.test(ua)) return 'linux';
    if (/Android/i.test(ua)) return 'android';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
    return 'other';
  })();
  // 在所有 [data-platform] 按钮上做"当前平台优先"高亮
  document.querySelectorAll('[data-platform]').forEach(btn => {
    if (btn.getAttribute('data-platform') === platform){
      btn.classList.add('is-current');
      btn.setAttribute('data-current', 'true');
    }
  });

  /* ---------- 8. 光标跟随光晕（仅支持 hover 的设备） ---------- */
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches){
    const glow = document.createElement('div');
    glow.className = 'cursor-glow';
    document.body.appendChild(glow);
    let gx = 0, gy = 0, cx = 0, cy = 0;
    document.addEventListener('mousemove', (e) => {
      gx = e.clientX; gy = e.clientY;
    });
    function follow(){
      cx += (gx - cx) * 0.12;
      cy += (gy - cy) * 0.12;
      glow.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -50%)`;
      requestAnimationFrame(follow);
    }
    requestAnimationFrame(follow);
  }

  /* ---------- 9. 外部链接安全（noopener 已经在 HTML 里加） ---------- */

  /* ---------- 10. 平滑滚动到锚点（带 sticky nav 偏移） ---------- */
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (id.length < 2) return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      const navH = nav ? nav.offsetHeight : 0;
      const y = target.getBoundingClientRect().top + window.scrollY - navH - 12;
      window.scrollTo({ top: y, behavior: 'smooth' });
    });
  });

  /* ---------- 11. 页面访问标记（用于下载页判定） ---------- */
  try {
    sessionStorage.setItem('eea_landed_from', document.referrer || 'direct');
  } catch(_) {}

  /* ---------- 12. 初次触发一次滚动状态 ---------- */
  onScroll();

  /* ---------- 13. 主题切换（深色 / 浅色） ---------- */
  const THEME_KEY = 'eea_theme';
  const themeBtn = document.getElementById('themeToggle');
  const mobileThemeBtn = document.getElementById('navMobileTheme');

  function getInitialTheme(){
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored === 'light' || stored === 'dark') return stored;
    } catch(_){}
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches){
      return 'light';
    }
    return 'dark';
  }
  function applyTheme(t, persist){
    document.documentElement.setAttribute('data-theme', t);
    // 同步 meta theme-color
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta){
      meta.setAttribute('content', t === 'light' ? '#ffffff' : '#07060d');
    }
    // 同步移动端菜单按钮文案
    if (mobileThemeBtn){
      mobileThemeBtn.textContent = t === 'light' ? '☀️ 切换主题' : '🌙 切换主题';
    }
    if (persist){
      try { localStorage.setItem(THEME_KEY, t); } catch(_){}
    }
  }
  function toggleTheme(){
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(cur === 'dark' ? 'light' : 'dark', true);
  }
  // 初始化（不持久化初次，避免覆盖用户偏好）
  applyTheme(getInitialTheme(), false);

  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
  if (mobileThemeBtn) mobileThemeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    toggleTheme();
    // 关闭移动菜单
    const navMobile = document.getElementById('navMobile');
    if (navMobile){
      navMobile.classList.remove('is-open');
      const navToggle = document.getElementById('navToggle');
      if (navToggle){
        navToggle.classList.remove('is-open');
        navToggle.setAttribute('aria-expanded', 'false');
      }
      document.body.style.overflow = '';
    }
  });

  // 跟随系统设置变化（仅当用户未明确选择过）
  if (window.matchMedia){
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const handler = (e) => {
      try {
        if (!localStorage.getItem(THEME_KEY)){
          applyTheme(e.matches ? 'light' : 'dark', false);
        }
      } catch(_){}
    };
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else if (mq.addListener) mq.addListener(handler);
  }
})();
