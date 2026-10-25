// Theme switch (system, light, dark) and the hero animation's pause button. The site works without it.
(() => {
  const root = document.documentElement;
  const order = ['auto', 'light', 'dark'];
  const labels = { auto: 'Auto', light: 'Light', dark: 'Dark' };
  const read = () => {
    try {
      return localStorage.getItem('indaba-theme') || 'auto';
    } catch {
      return 'auto';
    }
  };
  const apply = (mode) => {
    if (mode === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', mode);
    for (const b of document.querySelectorAll('[data-theme-toggle]')) {
      b.textContent = labels[mode];
      b.setAttribute('aria-label', `Colour theme: ${mode === 'auto' ? 'follows the system' : mode}`);
    }
  };
  let mode = read();
  apply(mode);
  document.addEventListener('DOMContentLoaded', () => {
    apply(mode);
    for (const b of document.querySelectorAll('[data-theme-toggle]')) {
      b.addEventListener('click', () => {
        mode = order[(order.indexOf(mode) + 1) % order.length];
        try {
          localStorage.setItem('indaba-theme', mode);
        } catch {}
        apply(mode);
      });
    }

    const art = document.querySelector('.hero-art');
    const pause = document.querySelector('[data-hero-pause]');
    if (!art || !pause || typeof art.pauseAnimations !== 'function') return;
    const set = (paused) => {
      if (paused) art.pauseAnimations();
      else art.unpauseAnimations();
      art.classList.toggle('paused', paused);
      pause.textContent = paused ? 'Play' : 'Pause';
      pause.setAttribute('aria-pressed', String(paused));
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // A still frame that shows the whole story: consensus reached, the gate passed after a retry.
      art.setCurrentTime(11.2);
      set(true);
    }
    pause.addEventListener('click', () => set(!art.animationsPaused()));
  });
})();
