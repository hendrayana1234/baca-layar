'use strict';
(() => {
  const shot = document.getElementById('shot');
  const sel = document.getElementById('sel');
  const size = document.getElementById('size');
  const hint = document.getElementById('hint');
  let start = null;
  let rect = null;
  let screenW = window.innerWidth;
  let screenH = window.innerHeight;

  window.api.onOverlayInit(({ image, width, height }) => {
    shot.src = image;
    screenW = width || window.innerWidth;
    screenH = height || window.innerHeight;
  });

  function draw() {
    if (!rect) return sel.classList.remove('on');
    sel.classList.add('on');
    Object.assign(sel.style, {
      left: rect.x + 'px',
      top: rect.y + 'px',
      width: rect.width + 'px',
      height: rect.height + 'px',
    });
    size.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
  }

  function finish(r) {
    // Skala CSS px -> DIP layar (umumnya sama, jaga-jaga bila jendela sedikit beda ukuran)
    if (r) {
      const fx = screenW / window.innerWidth;
      const fy = screenH / window.innerHeight;
      r = { x: r.x * fx, y: r.y * fy, width: r.width * fx, height: r.height * fy };
    }
    window.api.overlayDone(r);
  }

  window.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return finish(null);
    start = { x: e.clientX, y: e.clientY };
    rect = { x: start.x, y: start.y, width: 0, height: 0 };
    document.body.classList.add('selecting');
    hint.style.display = 'none';
    draw();
  });
  window.addEventListener('mousemove', (e) => {
    if (!start) return;
    const x = Math.min(start.x, e.clientX);
    const y = Math.min(start.y, e.clientY);
    rect = { x, y, width: Math.abs(e.clientX - start.x), height: Math.abs(e.clientY - start.y) };
    draw();
  });
  window.addEventListener('mouseup', () => {
    if (!start) return;
    start = null;
    if (!rect || rect.width < 8 || rect.height < 8) {
      rect = null;
      draw();
      document.body.classList.remove('selecting');
      hint.style.display = '';
      return;
    }
    finish(rect);
  });
  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    finish(null);
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') finish(null);
    if (e.key === 'Enter') finish({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight });
  });
})();
