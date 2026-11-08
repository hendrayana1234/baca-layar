'use strict';
/* global api */
// Bilah alat jendela "Halaman" — halaman webnya sendiri digambar oleh proses utama di bawah bilah ini.
(() => {
  const $ = (s) => document.querySelector(s);
  const url = $('#url');
  let st = { open: false };
  let settings = {};

  function setStatus(msg, kind = '') {
    const el = $('#status');
    el.textContent = msg || '';
    el.className = 'status ' + kind;
  }

  function render(s) {
    st = s || st;
    if (document.activeElement !== url) url.value = st.url && !/^about:blank$/.test(st.url) ? st.url : '';
    $('#btnBack').disabled = !st.canGoBack;
    $('#btnFwd').disabled = !st.canGoForward;
    $('#btnReload').querySelector('use').setAttribute('href', st.loading ? '#i-x' : '#i-reload');
    $('#btnReload').title = st.loading ? 'Berhenti memuat' : 'Muat ulang (F5)';
    const ui = st.state || {};
    $('#btnFlow').classList.toggle('on', !!ui.continuous);
    $('#flowLabel').textContent = ui.continuous ? 'Hentikan Baca Terus' : 'Baca Terus';
    const pill = $('#pill');
    pill.className = 'pill';
    if (ui.continuous) {
      pill.classList.add('flow');
      pill.textContent = 'Baca Terus berjalan';
    } else if (ui.reading) {
      pill.classList.add('flow');
      pill.textContent = 'Membacakan';
    } else if (st.regionKind === 'page') {
      pill.classList.add('page');
      pill.textContent = 'Area baca: halaman ini';
    } else if (st.loading) pill.textContent = 'Memuat…';
    else pill.textContent = 'Siap';
    document.title = (st.title ? st.title + ' — ' : '') + 'Baca Layar';
  }

  api.onPageState(render);
  api.onPageError((msg) => setStatus(msg, 'error'));
  api.onPageFocusUrl(() => {
    url.focus();
    url.select();
  });

  const go = () => url.value.trim() && api.pageGo(url.value.trim());
  $('#btnGo').addEventListener('click', go);
  url.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      go();
      url.blur();
    } else if (e.key === 'Escape') {
      url.value = st.url || '';
      url.blur();
    }
  });
  url.addEventListener('focus', () => url.select());
  $('#btnBack').addEventListener('click', () => api.pageNav('back'));
  $('#btnFwd').addEventListener('click', () => api.pageNav('forward'));
  $('#btnReload').addEventListener('click', () => api.pageNav(st.loading ? 'stop' : 'reload'));
  $('#btnHome').addEventListener('click', () => api.pageNav('home'));

  $('#btnRead').addEventListener('click', async () => {
    const r = await api.pageUseWhole();
    if (r && r.error) return setStatus(r.error, 'error');
    setStatus('Membaca teks di halaman…');
    api.pageTrigger('reread');
  });
  $('#btnArea').addEventListener('click', async () => {
    setStatus('Seret kotak di atas bagian yang mau dibaca (Esc batal, Enter = semua)…');
    const r = await api.pageSelectArea();
    if (r && r.error) return setStatus(r.error, 'error');
    if (r && r.cancelled) return setStatus('');
    setStatus(`Area ${r.rect.width}×${r.rect.height} dipilih — membaca…`, 'ok');
    api.pageTrigger('reread');
  });
  $('#btnFlow').addEventListener('click', () => api.pageTrigger('continuous'));
  $('#btnText').addEventListener('click', async () => {
    setStatus('Mengambil teks halaman…');
    const r = await api.pageDomText();
    if (r && r.error) return setStatus(r.error, 'error');
    setStatus('Teks halaman dikirim ke jendela Baca Layar.', 'ok');
  });
  $('#btnStop').addEventListener('click', () => api.pageTrigger('stopAll'));
  $('#btnDown').addEventListener('click', () => api.pageScroll(Number(settings.scrollNotches) || 5));
  $('#btnUp').addEventListener('click', () => api.pageScroll(-(Number(settings.scrollNotches) || 5)));

  (async () => {
    settings = await api.getSettings();
    render(await api.pageState());
  })();
})();
