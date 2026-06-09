/* ============================================================================
   Education Advisor · 官网交互
   滚动 · 渐入 · 数字滚动 · 18 agent 过滤 · 截图 lightbox · 移动菜单 · 告警滚动 · 回到顶部
   ============================================================================ */

(function () {
  'use strict';

  // ---- 工具 ----
  const $  = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));

  // Mark the page as JS-ready: this enables reveal/hide rules in CSS.
  // (No-JS users stay visible by default.)
  document.documentElement.classList.add('js-ready');

  // ---- 导航栏：滚动时增强背景 ----
  const nav = $('#nav');
  function updateNav() {
    if (window.scrollY > 12) nav.classList.add('scrolled');
    else nav.classList.remove('scrolled');
  }
  window.addEventListener('scroll', updateNav, { passive: true });
  updateNav();

  // ---- 移动端菜单 ----
  const navToggle = $('#navToggle');
  if (navToggle) {
    navToggle.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', String(open));
    });
    $$('.nav-links a').forEach((a) => {
      a.addEventListener('click', () => {
        nav.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // ---- 回到顶部 ----
  const backTop = $('#backTop');
  function updateBackTop() {
    if (window.scrollY > 600) backTop.classList.add('show');
    else backTop.classList.remove('show');
  }
  window.addEventListener('scroll', updateBackTop, { passive: true });
  backTop.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  updateBackTop();

  // ---- 渐入动画：IntersectionObserver ----
  const revealSelectors = [
    '.feature-card',
    '.agent-card',
    '.metric',
    '.arch-layer',
    '.arch-arrow',
    '.shot-card',
    '.download-card',
    '.download-extra-item',
    '.faq-item',
    '.section-head',
    '.hero-content',
    '.hero-visual',
  ];
  const revealEls = $$(revealSelectors.join(','));
  revealEls.forEach((el) => el.setAttribute('data-reveal', ''));

  // Safety net: if IO is not available OR the page is restored from bfcache,
  // or JS is delayed, we still want everything to be visible.
  const forceRevealAll = () => revealEls.forEach((el) => el.classList.add('is-visible'));

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.0, rootMargin: '0px 0px -10% 0px' }
    );
    revealEls.forEach((el) => io.observe(el));
    // If for any reason nothing has been observed-visible after 2s, force.
    setTimeout(forceRevealAll, 2000);
  } else {
    forceRevealAll();
  }

  // ---- 平滑滚动锚点（覆盖浏览器默认） ----
  $$('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (!id || id === '#') return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      const top = target.getBoundingClientRect().top + window.scrollY - 64;
      window.scrollTo({ top, behavior: 'smooth' });
    });
  });

  // ---- 数字滚动动画（默认就显示目标值，IO 触发后只是从 0 滚到目标） ----
  function animateNumber(el, target, duration = 1400) {
    const start = 0;
    const startTime = performance.now();
    const isFloat = String(target).includes('.');
    function tick(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = start + (target - start) * eased;
      el.textContent = isFloat ? value.toFixed(1) : Math.floor(value);
      if (progress < 1) requestAnimationFrame(tick);
      else el.textContent = String(target);
    }
    requestAnimationFrame(tick);
  }
  // Set final value immediately as a fallback (if IO never fires, or JS loads late).
  const numberEls = $$('.metric-num, .mockup-card-value');
  numberEls.forEach((el) => {
    const t = Number(el.dataset.target);
    if (!isNaN(t)) el.textContent = String(t);
  });
  // Then animate from 0 up to target when the element scrolls into view.
  if (numberEls.length && 'IntersectionObserver' in window) {
    const numIO = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const t = Number(entry.target.dataset.target);
            if (!isNaN(t)) {
              entry.target.textContent = '0';
              animateNumber(entry.target, t, 1400);
            }
            numIO.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.0, rootMargin: '0px 0px -10% 0px' }
    );
    numberEls.forEach((el) => numIO.observe(el));
  }

  // ---- 18 Agent 过滤 ----
  const filterBtns = $$('.agent-filter-btn');
  const agentCards = $$('.agent-card');
  filterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const f = btn.dataset.filter;
      filterBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      agentCards.forEach((card) => {
        if (f === 'all' || card.dataset.group === f) {
          card.classList.remove('hidden');
        } else {
          card.classList.add('hidden');
        }
      });
    });
  });

  // ---- Hero Dashboard "实时" 事件流 ----
  const alertList = [
    { dot: 'ok', msg: 'validator 已完成 6h 数据校验',         time: '刚刚' },
    { dot: 'ok', msg: 'class-monitor 录入 +2 操行分',           time: '3 分钟前' },
    { dot: '',    msg: 'risk-alert 提示某同学 14 天下降 28%', time: '8 分钟前' },
    { dot: 'ok', msg: 'weekly-reporter 已生成本周班级报告',    time: '21 分钟前' },
    { dot: '',    msg: 'home_school 起草 12 条家长消息',       time: '40 分钟前' },
    { dot: 'ok', msg: 'privacy 引擎 5 次脱敏调用已审计',       time: '1 小时前' },
  ];
  const alertContainer = $('#mockupAlerts');
  if (alertContainer) {
    let idx = 0;
    // 初始 2 条
    function addAlert(item, prepend = true) {
      const dot = document.createElement('span');
      dot.className = 'mockup-alert-dot' + (item.dot ? ' ' + item.dot : '');
      const msg = document.createElement('span');
      msg.className = 'mockup-alert-msg';
      msg.textContent = item.msg;
      const time = document.createElement('span');
      time.className = 'mockup-alert-time';
      time.textContent = item.time;
      const alert = document.createElement('div');
      alert.className = 'mockup-alert';
      alert.style.opacity = '0';
      alert.style.transform = 'translateX(-8px)';
      alert.style.transition = 'all 0.4s ease';
      alert.appendChild(dot);
      alert.appendChild(msg);
      alert.appendChild(time);
      if (prepend) alertContainer.insertBefore(alert, alertContainer.firstChild);
      else alertContainer.appendChild(alert);
      requestAnimationFrame(() => {
        alert.style.opacity = '1';
        alert.style.transform = 'translateX(0)';
      });
    }
    addAlert(alertList[0]);
    addAlert(alertList[1], false);

    setInterval(() => {
      const item = alertList[idx % alertList.length];
      idx++;
      addAlert(item);
      while (alertContainer.children.length > 4) {
        const last = alertContainer.lastElementChild;
        last.style.transition = 'all 0.3s ease';
        last.style.opacity = '0';
        setTimeout(() => last.remove(), 300);
      }
    }, 5500);
  }

  // ---- 截图 lightbox ----
  const lightbox = document.createElement('div');
  lightbox.className = 'lightbox';
  lightbox.innerHTML = '<img alt="截图预览" />';
  document.body.appendChild(lightbox);
  const lightboxImg = lightbox.querySelector('img');
  $$('.shot-card').forEach((card) => {
    card.addEventListener('click', () => {
      const src = card.dataset.full;
      if (!src) return;
      lightboxImg.src = src;
      lightbox.classList.add('open');
    });
  });
  lightbox.addEventListener('click', () => {
    lightbox.classList.remove('open');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lightbox.classList.contains('open')) {
      lightbox.classList.remove('open');
    }
  });

  // ---- 平台检测：自动高亮对应下载按钮 ----
  function highlightDownload() {
    const ua = navigator.userAgent.toLowerCase();
    const isWin = ua.includes('win');
    const isMac = ua.includes('mac');
    const isLinux = ua.includes('linux');
    $$('.download-card').forEach((card) => {
      const os = (card.dataset.os || '').toLowerCase();
      if ((isWin && os === 'win') || (isMac && os === 'mac') || (isLinux && os === 'linux')) {
        card.classList.add('highlight');
      }
    });
  }
  highlightDownload();

  // ---- 键盘 / 快捷：? 键聚焦 FAQ 第一个 ----
  document.addEventListener('keydown', (e) => {
    if (e.key === '?' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      e.preventDefault();
      const firstFaq = $('.faq-item');
      if (firstFaq) {
        firstFaq.scrollIntoView({ behavior: 'smooth', block: 'center' });
        firstFaq.open = true;
      }
    }
  });

  // ---- 启动日志 ----
  console.log(
    '%c🎓 Education Advisor %cv0.1.0-rc.1',
    'color:#7C3AED;font-weight:bold;font-size:14px;',
    'color:#06B6D4;font-size:12px;'
  );
  console.log('%c让教育更智能，让教师更轻松。', 'color:#94A3B8;font-size:12px;');
})();