(() => {
  'use strict';

  const THEME_KEY = 'eea_theme_v2';

  /* ---------- Theme helpers ---------- */
  function getInitialTheme() {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored === 'light' || stored === 'dark') return stored;
    } catch (_) {}
    return 'light'; // 阳光优先，浅色为默认
  }

  function applyTheme(theme, persist) {
    document.documentElement.setAttribute('data-theme', theme);

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', theme === 'dark' ? '#0f1218' : '#eff6ff');
    }

    const mobileThemeBtn = document.getElementById('navMobileTheme');
    if (mobileThemeBtn) {
      mobileThemeBtn.textContent = theme === 'dark' ? '🌙 切换主题' : '☀️ 切换主题';
    }

    if (persist) {
      try { localStorage.setItem(THEME_KEY, theme); } catch (_) {}
    }
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(current === 'dark' ? 'light' : 'dark', true);
  }

  /* ---------- Navigation ---------- */
  function initNav() {
    const nav = document.getElementById('nav');
    const toggle = document.getElementById('navToggle');
    const mobile = document.getElementById('navMobile');
    const themeBtn = document.getElementById('themeToggle');
    const mobileThemeBtn = document.getElementById('navMobileTheme');

    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
    if (mobileThemeBtn) mobileThemeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      toggleTheme();
      closeMobileMenu();
    });

    function closeMobileMenu() {
      if (!mobile || !toggle) return;
      mobile.classList.remove('is-open');
      toggle.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    }

    if (toggle && mobile) {
      toggle.addEventListener('click', () => {
        const isOpen = mobile.classList.toggle('is-open');
        toggle.classList.toggle('is-open', isOpen);
        toggle.setAttribute('aria-expanded', String(isOpen));
        document.body.style.overflow = isOpen ? 'hidden' : '';
      });

      mobile.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => closeMobileMenu());
      });
    }

    if (nav) {
      const onScroll = () => {
        nav.classList.toggle('is-scrolled', window.scrollY > 8);
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }
  }

  /* ---------- Initialize ---------- */
  applyTheme(getInitialTheme(), false);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initNav();
      window.__eeaMainLoaded = true;
    });
  } else {
    initNav();
    window.__eeaMainLoaded = true;
  }
})();
