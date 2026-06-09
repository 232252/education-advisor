/* ==========================================================================
   Education Advisor · 官网交互
   导航 / 滚动动画 / 回到顶部 / 移动端菜单
   ========================================================================== */

(function () {
  'use strict';

  // ---- 工具函数 ----
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  // ---- 导航栏：滚动时增强背景 ----
  const nav = $('#nav');
  let lastScrollY = 0;

  function updateNav() {
    const y = window.scrollY;
    if (y > 12) {
      nav.classList.add('scrolled');
    } else {
      nav.classList.remove('scrolled');
    }
    lastScrollY = y;
  }

  window.addEventListener('scroll', updateNav, { passive: true });
  updateNav();

  // ---- 移动端菜单切换 ----
  const navToggle = $('#navToggle');
  if (navToggle) {
    navToggle.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', String(open));
    });

    // 点链接后关闭菜单
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
    if (window.scrollY > 600) {
      backTop.classList.add('show');
    } else {
      backTop.classList.remove('show');
    }
  }
  window.addEventListener('scroll', updateBackTop, { passive: true });
  backTop.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  updateBackTop();

  // ---- Scroll Reveal：进入视口显示 ----
  const revealTargets = [
    '.feature-card',
    '.diff-item',
    '.page-card',
    '.metric',
    '.arch-layer',
    '.download-card',
    '.download-extra-item',
    '.qs-list li',
    '.qs-side-card',
    '.faq-item',
    '.cta-card',
    '.section-head',
  ];

  const revealElements = $$(revealTargets.join(','));
  revealElements.forEach((el, i) => {
    el.setAttribute('data-reveal', '');
    // 错开动画延迟，制造"瀑布流"效果
    el.style.transitionDelay = `${Math.min((i % 6) * 60, 300)}ms`;
  });

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
      { threshold: 0.08, rootMargin: '0px 0px -40px 0px' }
    );
    revealElements.forEach((el) => io.observe(el));
  } else {
    // 降级：直接显示
    revealElements.forEach((el) => el.classList.add('is-visible'));
  }

  // ---- 平滑滚动锚点 ----
  $$('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (!id || id === '#') return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      const top = target.getBoundingClientRect().top + window.scrollY - 68; // 减去导航栏高度
      window.scrollTo({ top, behavior: 'smooth' });
    });
  });

  // ---- 平台检测：自动高亮对应下载按钮 ----
  function highlightDownload() {
    const ua = navigator.userAgent.toLowerCase();
    const isWin = ua.includes('win');
    const isMac = ua.includes('mac');
    const isLinux = ua.includes('linux');
    const cards = $$('.download-card');
    cards.forEach((card) => {
      const os = (card.dataset.os || '').toLowerCase();
      if (
        (isWin && os.includes('win')) ||
        (isMac && os.includes('mac')) ||
        (isLinux && os.includes('linux'))
      ) {
        card.classList.add('os-detected');
      }
    });
  }
  highlightDownload();

  // ---- 模拟动态数据：仪表盘数字滚动 ----
  function animateNumber(el, target, duration = 1500) {
    const start = 0;
    const startTime = performance.now();
    const isFloat = String(target).includes('.');
    function tick(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = start + (target - start) * eased;
      el.textContent = isFloat ? value.toFixed(1) : Math.floor(value);
      if (progress < 1) requestAnimationFrame(tick);
      else el.textContent = String(target);
    }
    requestAnimationFrame(tick);
  }

  // 当仪表盘进入视口时启动数字动画
  const mockupValues = $$('.mockup-card-value');
  if (mockupValues.length && 'IntersectionObserver' in window) {
    const mockupIO = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const targets = [47, 23, 5];
            mockupValues.forEach((el, i) => {
              if (targets[i] !== undefined) animateNumber(el, targets[i], 1200);
            });
            mockupIO.disconnect();
          }
        });
      },
      { threshold: 0.3 }
    );
    const firstCard = $('.mockup-window');
    if (firstCard) mockupIO.observe(firstCard);
  }

  // ---- Hero Dashboard 模拟"实时"事件 ----
  const alertList = [
    { dot: 'ok', msg: 'validator 已完成 6h 数据校验', time: '刚刚' },
    { dot: '', msg: 'psychology 关注到王同学情绪波动', time: '5 分钟前' },
    { dot: 'ok', msg: 'class-monitor 录入 +1 操行分', time: '12 分钟前' },
    { dot: '', msg: 'safety 标记课间安全事件', time: '23 分钟前' },
    { dot: 'ok', msg: 'weekly-reporter 已生成本周班级报告', time: '1 小时前' },
  ];
  const alertContainer = $('.mockup-alerts');
  if (alertContainer) {
    let idx = 0;
    setInterval(() => {
      const item = alertList[idx % alertList.length];
      idx++;
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
      alert.style.transform = 'translateX(-10px)';
      alert.style.transition = 'all 0.4s ease';
      alert.appendChild(dot);
      alert.appendChild(msg);
      alert.appendChild(time);

      alertContainer.insertBefore(alert, alertContainer.firstChild);
      requestAnimationFrame(() => {
        alert.style.opacity = '1';
        alert.style.transform = 'translateX(0)';
      });

      // 限制最多 3 条
      while (alertContainer.children.length > 3) {
        const last = alertContainer.lastElementChild;
        last.style.transition = 'all 0.3s ease';
        last.style.opacity = '0';
        setTimeout(() => last.remove(), 300);
      }
    }, 6000);
  }

  // ---- 键盘快捷键：/? 聚焦搜索（占位） ----
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      e.preventDefault();
      const firstInput = $('input[type="search"]');
      if (firstInput) firstInput.focus();
    }
  });

  // ---- 下载按钮：缺文件时给出友好提示 ----
  $$('a[href$=".exe"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const href = a.getAttribute('href');
      // 仅对占位文件提示
      if (href && href.includes('Education-Advisor')) {
        fetch(href, { method: 'HEAD' })
          .then((res) => {
            if (!res.ok) {
              e.preventDefault();
              showDownloadNotice();
            }
          })
          .catch(() => {
            e.preventDefault();
            showDownloadNotice();
          });
      }
    });
  });

  function showDownloadNotice() {
    const note = document.createElement('div');
    note.style.cssText = `
      position: fixed; left: 50%; top: 80px; transform: translateX(-50%);
      padding: 14px 20px; background: var(--bg-3); border: 1px solid var(--brand-cyan);
      border-radius: 12px; color: var(--text); font-size: 14px; z-index: 1000;
      box-shadow: 0 12px 40px rgba(0,0,0,0.5); max-width: 480px; text-align: center;
    `;
    note.innerHTML = `
      <div style="font-weight:700;margin-bottom:4px;">📦 安装包还在构建中</div>
      <div style="color:var(--text-2);font-size:13px;">
        v0.1.0-rc.1 已发布 · 下载请前往
        <a href="https://github.com/232252/education-advisor" target="_blank" style="color:var(--brand-cyan-2);">GitHub 仓库</a>
        从源码构建，或 Star 一下等通知。
      </div>
    `;
    document.body.appendChild(note);
    setTimeout(() => {
      note.style.transition = 'all 0.4s ease';
      note.style.opacity = '0';
      note.style.transform = 'translateX(-50%) translateY(-20px)';
      setTimeout(() => note.remove(), 400);
    }, 5000);
  }

  // ---- 性能：打印完成日志 ----
  console.log(
    '%c🎓 Education Advisor %cv0.1.0-rc.1',
    'color:#7C3AED;font-weight:bold;font-size:14px;',
    'color:#06B6D4;font-size:12px;'
  );
  console.log('%c让教育更智能，让教师更轻松。', 'color:#94A3B8;font-size:12px;');
})();
