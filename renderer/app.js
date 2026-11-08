'use strict';
/* global api */
(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let S = {}; // pengaturan
  const state = { reading: false, continuous: false, autoScroll: false, recording: false, busy: false };

  // ---------- status & pesan ----------
  function setStatus(msg, kind = '') {
    const el = $('#status');
    el.textContent = msg;
    el.className = 'status ' + kind;
  }
  let toastTimer = null;
  function toast(msg, ms = 4200) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }
  function refreshPill() {
    const p = $('#pill');
    p.className = 'pill';
    if (state.recording) {
      p.classList.add('rec');
      p.textContent = '● Rekam ' + $('#recTime').textContent;
    } else if (state.continuous) {
      p.classList.add('flow');
      p.textContent = 'Baca Terus';
    } else if (state.busy) {
      p.classList.add('busy');
      p.textContent = 'Membaca layar…';
    } else if (state.reading) {
      p.classList.add('busy');
      p.textContent = Player.isPaused() ? 'Dijeda' : 'Membacakan';
    } else if (state.autoScroll) {
      p.classList.add('flow');
      p.textContent = 'Gulir otomatis';
    } else p.textContent = 'Siap';
  }
  function pushState() {
    refreshPill();
    api.setState({
      reading: state.reading,
      continuous: state.continuous,
      autoScroll: state.autoScroll,
      recording: state.recording,
    });
  }

  async function countdown(n, msg) {
    // document.hidden tidak bisa dipakai (backgroundThrottling: false) — tanya ke proses utama.
    if (!(await api.isWindowVisible())) return;
    const box = $('#countdown');
    box.querySelector('.msg').textContent = msg;
    box.classList.remove('hidden');
    for (let i = n; i > 0; i--) {
      box.querySelector('.num').textContent = i;
      await sleep(1000);
    }
    box.classList.add('hidden');
  }

  // ---------- tab ----------
  $$('.tabs button').forEach((b) =>
    b.addEventListener('click', () => {
      $$('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
      $$('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
      if (b.dataset.tab === 'rekam' && !sourcesLoaded) loadSources();
    })
  );

  // ---------- pengaturan <-> input ----------
  function bindSettings() {
    $$('[data-setting]').forEach((el) => {
      const key = el.dataset.setting;
      const v = S[key];
      if (el.type === 'checkbox') el.checked = !!v;
      else if (v !== undefined && v !== null) el.value = v;
      el.addEventListener('change', async () => {
        let val;
        if (el.type === 'checkbox') val = el.checked;
        else if (el.type === 'range' || el.type === 'number' || 'num' in el.dataset) val = Number(el.value);
        else val = el.value;
        if (key === 'scrollNotches') val = Math.max(1, Math.min(30, Math.round(val) || 1));
        S = await api.setSettings({ [key]: val });
        syncOutputs();
      });
      if (el.type === 'range') el.addEventListener('input', () => syncOutputs(el));
    });
  }
  function syncOutputs(live) {
    const rate = live && live.id === 'rate' ? Number(live.value) : S.rate;
    $('#rateOut').textContent = Number(rate).toFixed(1) + '×';
    const wm = live && live.id === 'wmRange' ? Number(live.value) : S.watermarkThreshold;
    $('#wmOut').textContent = wm;
    $('#scrollNotches').value = S.scrollNotches;
  }
  $$('[data-step]').forEach((b) =>
    b.addEventListener('click', async () => {
      const n = Math.max(1, Math.min(30, (Number(S.scrollNotches) || 5) + Number(b.dataset.step)));
      S = await api.setSettings({ scrollNotches: n });
      syncOutputs();
    })
  );
  $$('[data-open]').forEach((b) => b.addEventListener('click', () => api.openExternal(b.dataset.open)));

  // ---------- teks ----------
  const textEl = $('#text');
  function putText(t, append) {
    if (append && textEl.value.trim()) textEl.value = textEl.value.replace(/\s+$/, '') + '\n\n' + t;
    else textEl.value = t;
    textEl.scrollTop = textEl.scrollHeight;
    updateCount();
  }
  function countWords(t) {
    return (t.match(/[\p{L}\p{N}]+/gu) || []).length;
  }
  function updateCount() {
    const n = countWords(textEl.value);
    $('#wordCount').textContent = n ? n + ' kata' : '';
  }
  textEl.addEventListener('input', updateCount);
  $('#btnCopy').addEventListener('click', async () => {
    const sel = textEl.value.substring(textEl.selectionStart, textEl.selectionEnd);
    await api.copy(sel || textEl.value);
    toast(sel ? 'Bagian terpilih disalin.' : 'Teks disalin.');
  });
  $('#btnSave').addEventListener('click', async () => {
    if (!textEl.value.trim()) return toast('Belum ada teks.');
    const p = await api.saveText(textEl.value);
    if (p) setStatus('Disimpan: ' + p, 'ok');
  });
  $('#btnClear').addEventListener('click', () => {
    textEl.value = '';
    updateCount();
  });

  // ---------- suara ----------
  const Player = (() => {
    let token = 0;
    let paused = false;
    let engine = 'windows'; // 'windows' | 'web'
    const audio = new Audio();
    let finishWait = null;

    function splitChunks(text) {
      const clean = text.replace(/[ \t]+/g, ' ').trim();
      if (!clean) return [];
      const parts = clean.match(/[^.!?;\n]+(?:[.!?;]+["”')]?|\n+|$)/g) || [clean];
      const chunks = [];
      let cur = '';
      for (const s of parts) {
        const limit = chunks.length === 0 ? 260 : 900; // bagian pertama pendek agar suara cepat mulai
        if (cur && (cur + s).length > limit) {
          chunks.push(cur.trim());
          cur = s;
        } else cur += s;
      }
      if (cur.trim()) chunks.push(cur.trim());
      return chunks.flatMap((c) => (c.length > 1600 ? c.match(/[\s\S]{1,1200}(?:\s|$)/g) : [c])).filter((c) => /[\p{L}\p{N}]/u.test(c));
    }

    function waitAudioEnd(my) {
      return new Promise((resolve) => {
        const done = () => {
          audio.onended = audio.onerror = null;
          finishWait = null;
          resolve();
        };
        finishWait = done;
        audio.onended = done;
        audio.onerror = done;
        if (my !== token) done();
      });
    }

    async function playWav(wav, my) {
      const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
      try {
        audio.src = url;
        const ended = waitAudioEnd(my);
        try {
          await audio.play();
        } catch (e) {
          // Dijeda tepat saat bagian ini mulai → tunggu dilanjutkan. Error lain (WAV rusak) → lewati bagian ini.
          const pausedNow = e && e.name === 'AbortError' && paused && my === token;
          if (!pausedNow && finishWait) finishWait();
        }
        await ended;
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    function webVoice() {
      const voices = speechSynthesis.getVoices();
      const id = S.voiceId || '';
      if (id.startsWith('web:')) {
        const v = voices.find((x) => x.name === id.slice(4));
        if (v) return v;
      }
      return voices.find((x) => /^id/i.test(x.lang)) || null;
    }

    function speakWebChunk(chunk, my) {
      return new Promise((resolve) => {
        if (my !== token) return resolve();
        const u = new SpeechSynthesisUtterance(chunk);
        const v = webVoice();
        if (v) {
          u.voice = v;
          u.lang = v.lang;
        } else u.lang = 'id-ID';
        u.rate = Number(S.rate) || 1;
        u.onend = u.onerror = () => {
          finishWait = null;
          resolve();
        };
        finishWait = () => resolve();
        speechSynthesis.speak(u);
      });
    }

    async function speak(text) {
      stop();
      const my = ++token;
      const chunks = splitChunks(text || '');
      if (!chunks.length) return;
      state.reading = true;
      paused = false;
      updatePlayButton();
      pushState();
      try {
        let useWeb = engine === 'web' || (S.voiceId || '').startsWith('web:');
        let next = useWeb ? null : api.synth({ text: chunks[0], voiceId: S.voiceId, rate: S.rate });
        for (let i = 0; i < chunks.length; i++) {
          if (my !== token) return;
          showSpeakLine(i, chunks.length, chunks[i]);
          if (!useWeb) {
            const cur = await next;
            if (my !== token) return;
            if (!cur || cur.error) {
              engine = 'web';
              useWeb = true;
              toast('Suara Windows tidak tersedia, memakai suara cadangan.');
            } else {
              next = i + 1 < chunks.length ? api.synth({ text: chunks[i + 1], voiceId: S.voiceId, rate: S.rate }) : null;
              await playWav(cur.wav, my);
              continue;
            }
          }
          await speakWebChunk(chunks[i], my);
        }
      } finally {
        if (my === token) {
          state.reading = false;
          paused = false;
          showSpeakLine(-1);
          updatePlayButton();
          pushState();
        }
      }
    }

    function stop() {
      token++;
      paused = false;
      try {
        audio.pause();
      } catch (_) {}
      try {
        speechSynthesis.cancel();
      } catch (_) {}
      if (finishWait) finishWait();
      if (state.reading) {
        state.reading = false;
        showSpeakLine(-1);
        updatePlayButton();
        pushState();
      }
    }
    function pause() {
      if (!state.reading) return;
      paused = true;
      audio.pause();
      try {
        speechSynthesis.pause();
      } catch (_) {}
      updatePlayButton();
      refreshPill();
    }
    function resume() {
      if (!paused) return;
      paused = false;
      if (audio.src && !audio.ended) audio.play().catch(() => {});
      try {
        speechSynthesis.resume();
      } catch (_) {}
      updatePlayButton();
      refreshPill();
    }
    return {
      speak,
      stop,
      pause,
      resume,
      isPaused: () => paused,
      setEngine: (e) => (engine = e),
    };
  })();

  function showSpeakLine(i, n, chunk) {
    const el = $('#speakLine');
    if (i < 0) return el.classList.add('hidden');
    el.classList.remove('hidden');
    const preview = chunk.length > 70 ? chunk.slice(0, 70) + '…' : chunk;
    el.textContent = (n > 1 ? `Bagian ${i + 1}/${n}: ` : 'Membacakan: ') + preview;
  }
  function updatePlayButton() {
    const use = $('#btnPlay use');
    use.setAttribute('href', state.reading && !Player.isPaused() ? '#i-pause' : '#i-play');
  }
  $('#btnPlay').addEventListener('click', () => {
    if (state.reading) return Player.isPaused() ? Player.resume() : Player.pause();
    const sel = textEl.value.substring(textEl.selectionStart, textEl.selectionEnd);
    const t = sel.trim() ? sel : textEl.value;
    if (!t.trim()) return toast('Belum ada teks. Pilih area dulu (Ctrl+Alt+O).');
    Player.speak(t);
  });
  $('#btnStop').addEventListener('click', () => Player.stop());
  $('#btnTestVoice').addEventListener('click', () =>
    Player.speak('Halo, saya Baca Layar. Saya akan membacakan teks di layar untuk Anda.')
  );

  async function loadVoices() {
    const sel = $('#voice');
    sel.innerHTML = '';
    const res = await api.voices();
    let list = (res.voices || []).map((v) => ({ id: v.id, label: `${v.name.replace(/^Microsoft /, '')} · ${v.lang}`, lang: v.lang }));
    if (!list.length) {
      Player.setEngine('web');
      let wv = speechSynthesis.getVoices();
      if (!wv.length) {
        await new Promise((r) => {
          speechSynthesis.onvoiceschanged = r;
          setTimeout(r, 1500);
        });
        wv = speechSynthesis.getVoices();
      }
      list = wv.map((v) => ({ id: 'web:' + v.name, label: `${v.name} · ${v.lang}`, lang: v.lang }));
    }
    list.sort((a, b) => (/^id/i.test(b.lang) ? 1 : 0) - (/^id/i.test(a.lang) ? 1 : 0));
    for (const v of list) {
      const o = document.createElement('option');
      o.value = v.id;
      o.textContent = v.label;
      sel.appendChild(o);
    }
    const hasIndo = list.some((v) => /^id/i.test(v.lang));
    $('#voiceHint').classList.toggle('hidden', hasIndo || !list.length);
    let chosen = list.find((v) => v.id === S.voiceId);
    if (!chosen) chosen = list.find((v) => /^id/i.test(v.lang)) || list.find((v) => v.id === res.defaultId) || list[0];
    if (chosen) {
      sel.value = chosen.id;
      if (chosen.id !== S.voiceId) S = await api.setSettings({ voiceId: chosen.id });
    }
    if (!list.length) {
      const o = document.createElement('option');
      o.textContent = 'Tidak ada suara terpasang';
      sel.appendChild(o);
    }
  }
  $('#voice').addEventListener('change', async (e) => {
    S = await api.setSettings({ voiceId: e.target.value });
  });

  // ---------- baca layar ----------
  async function refreshRegion(info) {
    if (info === undefined) info = await api.regionInfo();
    const line = $('#regionLine');
    line.classList.toggle('has', !!info);
    $('#btnRegionClear').classList.toggle('hidden', !info);
    $('#regionText').innerHTML = !info
      ? 'Belum ada area. Klik <b>Pilih area</b>, lalu seret kotak di atas teks yang mau dibaca.'
      : info.kind === 'page'
        ? `Area: <b>${info.whole ? 'seluruh tampilan' : `${info.width}×${info.height}`} halaman di aplikasi</b> — baca ulang & gulir dilakukan di dalam jendela Halaman.`
        : `Area tersimpan ${info.width}×${info.height} — tekan <b>Ctrl+Alt+L</b> untuk baca ulang setelah ganti halaman.`;
  }
  $('#btnRegionClear').addEventListener('click', async () => {
    await api.regionClear();
    refreshRegion(null);
  });
  api.onRegionChanged((info) => refreshRegion(info));
  api.onProgress((msg) => setStatus(msg));

  function handleOcr(r, speak) {
    if (!r || r.cancelled) {
      setStatus('Pemilihan area dibatalkan.');
      return false;
    }
    if (r.error) {
      setStatus('Gagal: ' + r.error, 'error');
      return false;
    }
    if (r.note) toast(r.note);
    if (!r.text) {
      setStatus('Tidak ada teks yang terbaca di area itu. Coba pilih area yang lebih pas.', 'warn');
      return false;
    }
    putText(r.text, S.appendText);
    setStatus(`Terbaca ${countWords(r.text)} kata (${r.engine === 'windows' ? 'OCR Windows' : 'Tesseract'}).`, 'ok');
    if (speak) Player.speak(r.text);
    else api.isWindowVisible().then((v) => v || api.showWindow(true));
    return true;
  }

  async function selectArea() {
    if (state.busy) return;
    if (state.continuous) stopContinuous();
    Player.stop();
    state.busy = true;
    pushState();
    setStatus('Seret kotak di atas teks yang mau dibaca… (Esc untuk batal)');
    try {
      const r = await api.ocrSelect();
      return handleOcr(r, S.autoSpeak);
    } finally {
      state.busy = false;
      pushState();
    }
  }

  async function rereadArea() {
    if (state.busy) return;
    if (!(await api.regionInfo())) return selectArea();
    Player.stop();
    state.busy = true;
    pushState();
    setStatus('Membaca ulang area…');
    try {
      const r = await api.ocrLast({});
      if (r && r.error === 'NO_REGION') return selectArea();
      return handleOcr(r, S.autoSpeak);
    } finally {
      state.busy = false;
      pushState();
    }
  }

  // ---------- Baca Terus ----------
  function updateContinuousUI() {
    $('#btnContinuous').classList.toggle('on', state.continuous);
    $('#contLabel').textContent = state.continuous ? 'Hentikan Baca Terus' : 'Baca Terus';
    $('#contLabel2').textContent = state.continuous ? 'Hentikan Baca Terus' : 'Mulai Baca Terus';
  }
  // Setiap putaran Baca Terus / gulir otomatis punya nomor sendiri; berhenti = nomor naik,
  // jadi putaran lama yang masih menunggu langsung keluar dan tidak berjalan dobel.
  let contGen = 0;
  let autoGen = 0;
  function stopContinuous(msg, kind) {
    if (!state.continuous) return;
    contGen++;
    state.continuous = false;
    Player.stop();
    updateContinuousUI();
    pushState();
    if (msg) setStatus(msg, kind);
    api.showWindow(true);
  }
  async function startContinuous() {
    if (state.continuous || state.busy) return;
    Player.stop();
    stopAutoScroll();
    if (!(await api.regionInfo())) {
      setStatus('Pilih dulu kolom teks halaman yang mau dibaca terus…');
      state.busy = true;
      pushState();
      let r;
      try {
        r = await api.ocrSelect();
      } finally {
        state.busy = false;
      }
      if (!r || r.cancelled || r.error || !(await api.regionInfo())) {
        pushState();
        return handleOcr(r, false);
      }
    }
    state.continuous = true;
    const my = ++contGen;
    const alive = () => state.continuous && my === contGen;
    updateContinuousUI();
    pushState();
    if (!S.appendText) {
      textEl.value = '';
      updateCount();
    }
    let first = true;
    let stuck = 0;
    let warned = false;
    let round = 0;
    let busyWait = 0;
    try {
      while (alive()) {
        round++;
        setStatus(`Baca Terus · bagian ${round}: membaca layar…`);
        const r = await api.ocrLast({ continuous: true, reset: first, keepHidden: true });
        if (!alive()) break;
        if (r && r.busy && busyWait < 60) {
          // putaran sebelumnya masih menyelesaikan OCR — tunggu sebentar lalu coba lagi
          busyWait++;
          round--;
          await sleep(250);
          continue;
        }
        first = false;
        busyWait = 0;
        if (!r || r.error) {
          stopContinuous('Baca Terus berhenti: ' + (r ? r.error : 'tidak ada hasil'), 'error');
          break;
        }
        if (r.note && (round === 1 || r.blank)) toast(r.note);
        if (r.same || r.blank) {
          stuck++;
          if (stuck >= 2) {
            stopContinuous(`Sudah sampai akhir halaman. Selesai ✓ (${countWords(textEl.value)} kata)`, 'ok');
            break;
          }
        } else stuck = 0;
        if (!r.anchored && round > 1 && !warned) {
          warned = true;
          toast('Sebagian teks mungkin terlewat — kecilkan "jarak gulir" di tab Gulir.', 6000);
        }
        if (r.text) {
          putText(r.text, true);
          setStatus(`Baca Terus · bagian ${round}: membacakan…`);
          await Player.speak(r.text);
          while (alive() && Player.isPaused()) await sleep(300);
        }
        if (!alive()) break;
        setStatus(`Baca Terus · menggulir ${S.scrollNotches} klik…`);
        const s = await api.scroll({ at: 'region', notches: S.scrollNotches, keepHidden: true });
        if (!alive()) break;
        if (s && s.error) {
          stopContinuous('Gagal menggulir: ' + s.error, 'error');
          break;
        }
        await sleep(Number(S.scrollDelayMs) || 900);
      }
    } catch (e) {
      if (alive()) stopContinuous('Baca Terus berhenti: ' + (e && e.message ? e.message : e), 'error');
    }
  }
  function toggleContinuous() {
    if (state.continuous) stopContinuous('Baca Terus dihentikan.');
    else startContinuous();
  }

  // ---------- gulir ----------
  const speedToMs = (v) => Math.round(3200 / Number(v));
  const msToSpeed = (ms) => Math.max(1, Math.min(10, Math.round(3200 / (Number(ms) || 1500))));
  function syncAutoSpeed() {
    const v = Number($('#autoSpeed').value);
    $('#autoSpeedOut').textContent = (1000 / speedToMs(v)).toFixed(1) + ' klik/dtk';
  }
  $('#autoSpeed').addEventListener('input', syncAutoSpeed);
  $('#autoSpeed').addEventListener('change', async () => {
    S = await api.setSettings({ autoScrollIntervalMs: speedToMs($('#autoSpeed').value) });
  });

  async function scrollOnce(dir) {
    const notches = dir * (Number(S.scrollNotches) || 5);
    if (await api.regionInfo()) {
      const r = await api.scroll({ at: 'region', notches });
      if (r && r.error) setStatus('Gagal menggulir: ' + r.error, 'error');
      else setStatus(`Digulir ${Math.abs(notches)} klik ${dir > 0 ? 'ke bawah' : 'ke atas'} di area tersimpan.`);
      return;
    }
    await countdown(2, 'Arahkan mouse ke halaman yang mau digulir');
    const r = await api.scroll({ at: 'cursor', notches });
    if (r && r.error) setStatus('Gagal menggulir: ' + r.error, 'error');
    else setStatus('Digulir di posisi mouse.');
  }
  $('#btnScrollDown').addEventListener('click', () => scrollOnce(1));
  $('#btnScrollUp').addEventListener('click', () => scrollOnce(-1));

  function stopAutoScroll() {
    if (!state.autoScroll) return;
    autoGen++;
    state.autoScroll = false;
    $('#autoLabel').textContent = 'Mulai gulir otomatis';
    $('#btnAutoScroll').classList.remove('on');
    pushState();
    setStatus('Gulir otomatis berhenti.');
  }
  async function toggleAutoScroll(fromHotkey) {
    if (state.autoScroll) return stopAutoScroll();
    if (state.continuous) stopContinuous();
    if (!fromHotkey && (await api.cursorOnOwnWindow())) {
      await countdown(3, 'Arahkan mouse ke halaman yang mau digulir');
    }
    if (state.autoScroll) return; // sudah dimulai dari tempat lain selama hitung mundur
    state.autoScroll = true;
    const my = ++autoGen;
    const alive = () => state.autoScroll && my === autoGen;
    $('#autoLabel').textContent = 'Hentikan gulir otomatis';
    $('#btnAutoScroll').classList.add('on');
    pushState();
    setStatus('Gulir otomatis berjalan di posisi mouse. Ctrl+Alt+G untuk berhenti.');
    while (alive()) {
      let r;
      try {
        r = await api.scroll({ at: 'cursor', notches: Number(S.autoScrollNotches) || 1 });
      } catch (e) {
        r = { error: e && e.message ? e.message : String(e) };
      }
      if (!alive()) break;
      if (r && r.error) {
        stopAutoScroll();
        setStatus('Gagal menggulir: ' + r.error, 'error');
        break;
      }
      await sleep(Number(S.autoScrollIntervalMs) || 1500);
    }
  }
  $('#btnAutoScroll').addEventListener('click', () => toggleAutoScroll(false));

  // ---------- tombol utama ----------
  $('#btnSelect').addEventListener('click', selectArea);
  $('#btnReread').addEventListener('click', rereadArea);
  $('#btnContinuous').addEventListener('click', toggleContinuous);
  $('#btnContinuous2').addEventListener('click', toggleContinuous);
  function stopAll() {
    stopContinuous();
    stopAutoScroll();
    Player.stop();
    setStatus('Dihentikan.');
  }
  $('#btnStopAll').addEventListener('click', stopAll);
  $('#btnPage').addEventListener('click', () => api.pageOpen());
  api.onPageText((text) => {
    if (!text) return;
    putText(text, S.appendText);
    setStatus(`Teks halaman diambil (${countWords(text)} kata).`, 'ok');
    if (S.autoSpeak) Player.speak(text);
  });

  // ---------- rekam layar ----------
  let sourcesLoaded = false;
  let selectedSource = null;
  const Rec = { recorder: null, streams: [], ctx: null, queue: Promise.resolve(), start: 0, pausedAt: 0, pausedTotal: 0, timer: null, lastPath: '' };

  async function loadSources() {
    sourcesLoaded = true;
    const box = $('#sources');
    let list = [];
    try {
      list = await api.recSources();
    } catch (e) {
      box.innerHTML = '<p class="muted small">Gagal memuat daftar layar.</p>';
      return;
    }
    box.innerHTML = '';
    if (!list.some((s) => s.id === selectedSource)) selectedSource = (list.find((s) => s.screen) || list[0] || {}).id || null;
    for (const s of list) {
      const b = document.createElement('button');
      b.className = 'src' + (s.screen ? ' screen' : '') + (s.id === selectedSource ? ' sel' : '');
      b.title = s.name;
      const img = document.createElement('img');
      if (s.thumb) img.src = s.thumb;
      const span = document.createElement('span');
      span.textContent = s.name;
      b.append(img, span);
      b.addEventListener('click', () => {
        selectedSource = s.id;
        $$('.src').forEach((x) => x.classList.toggle('sel', x === b));
      });
      box.appendChild(b);
    }
  }
  $('#btnRefreshSrc').addEventListener('click', loadSources);

  function pickMime(hasAudio) {
    const c = hasAudio
      ? ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      : ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    return c.find((t) => MediaRecorder.isTypeSupported(t)) || '';
  }
  const fmtTime = (ms) => {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  };
  function tick() {
    if (!Rec.recorder) return;
    const now = Rec.pausedAt || Date.now();
    $('#recTime').textContent = fmtTime(now - Rec.start - Rec.pausedTotal);
    refreshPill();
  }
  function updateRecUI() {
    const on = state.recording;
    $('#btnRec').classList.toggle('on', on);
    $('#recLabel').textContent = on ? 'Stop & simpan' : 'Mulai rekam';
    $('#btnRecPause').disabled = !on;
    $('#recPauseLabel').textContent = Rec.pausedAt ? 'Lanjut' : 'Jeda';
    $('#recTime').classList.toggle('on', on);
  }

  // Tekan Ctrl+Alt+R dua kali selama persiapan tidak boleh memulai dua perekam.
  let recStarting = false;
  async function startRecording() {
    if (state.recording || recStarting) return;
    recStarting = true;
    try {
      await startRecordingInner();
    } finally {
      recStarting = false;
    }
  }
  async function startRecordingInner() {
    if (!sourcesLoaded || !selectedSource) await loadSources();
    if (!selectedSource) return setStatus('Tidak ada layar yang bisa direkam.', 'error');
    await api.recUseSource({ id: selectedSource, audio: !!S.recSystemAudio });
    let display;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: Number(S.recFps) || 30, max: Number(S.recFps) || 30 } },
        audio: !!S.recSystemAudio,
      });
    } catch (e) {
      return setStatus('Tidak bisa mulai merekam: ' + e.message, 'error');
    }
    const streams = [display];
    let mic = null;
    if (S.recMic) {
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
        streams.push(mic);
      } catch (e) {
        toast('Mikrofon tidak bisa dipakai: ' + e.message);
      }
    }
    const sys = display.getAudioTracks();
    let audioTrack = null;
    let ctx = null;
    if (sys.length && mic) {
      ctx = new AudioContext();
      const dest = ctx.createMediaStreamDestination();
      ctx.createMediaStreamSource(new MediaStream([sys[0]])).connect(dest);
      ctx.createMediaStreamSource(mic).connect(dest);
      audioTrack = dest.stream.getAudioTracks()[0];
    } else if (sys.length) audioTrack = sys[0];
    else if (mic) audioTrack = mic.getAudioTracks()[0];

    const out = new MediaStream([...display.getVideoTracks(), ...(audioTrack ? [audioTrack] : [])]);
    const fps = Number(S.recFps) || 30;
    const vbps = (S.recQuality === 'high' ? 9_000_000 : 4_000_000) * (fps > 30 ? 1.5 : 1);
    let mime = pickMime(!!audioTrack);
    let recorder;
    try {
      recorder = new MediaRecorder(out, { mimeType: mime, videoBitsPerSecond: vbps, audioBitsPerSecond: 160000 });
    } catch (_) {
      mime = 'video/webm';
      recorder = new MediaRecorder(out, { mimeType: mime, videoBitsPerSecond: vbps });
    }

    if (S.recCountdown) await countdown(3, 'Perekaman dimulai…');
    const filePath = await api.recBegin({ ext: mime.includes('mp4') ? 'mp4' : 'webm' });
    Object.assign(Rec, { recorder, streams, ctx, queue: Promise.resolve(), start: Date.now(), pausedAt: 0, pausedTotal: 0, lastPath: filePath });

    recorder.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      const blob = e.data;
      Rec.queue = Rec.queue.then(async () => api.recChunk(new Uint8Array(await blob.arrayBuffer())));
    };
    recorder.onstop = async () => {
      await Rec.queue;
      const p = await api.recEnd();
      Rec.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      if (Rec.ctx) Rec.ctx.close().catch(() => {});
      clearInterval(Rec.timer);
      Rec.recorder = null;
      state.recording = false;
      updateRecUI();
      pushState();
      Rec.lastPath = p;
      $('#lastRec').classList.remove('hidden');
      $('#lastRecName').textContent = p.split(/[\\/]/).pop();
      setStatus('Rekaman tersimpan di ' + p, 'ok');
      $$('.tabs button').find((b) => b.dataset.tab === 'rekam').click();
      api.showWindow(false);
    };
    recorder.onerror = (e) => {
      setStatus('Rekaman error: ' + (e.error ? e.error.message : 'tidak diketahui'), 'error');
      stopRecording();
    };
    const vt = display.getVideoTracks()[0];
    if (vt) vt.onended = () => stopRecording(); // jendela yang direkam ditutup

    state.recording = true;
    updateRecUI();
    pushState();
    Rec.timer = setInterval(tick, 500);
    if (S.recHideWindow) await api.hideWindow();
    recorder.start(1000);
    setStatus('Merekam… tekan Ctrl+Alt+R untuk berhenti.');
  }
  function stopRecording() {
    if (!Rec.recorder || Rec.recorder.state === 'inactive') return;
    Rec.recorder.stop();
  }
  function togglePauseRecording() {
    const r = Rec.recorder;
    if (!r) return;
    if (r.state === 'recording') {
      r.pause();
      Rec.pausedAt = Date.now();
    } else if (r.state === 'paused') {
      r.resume();
      Rec.pausedTotal += Date.now() - Rec.pausedAt;
      Rec.pausedAt = 0;
    }
    updateRecUI();
    tick();
  }
  $('#btnRec').addEventListener('click', () => (state.recording ? stopRecording() : startRecording()));
  $('#btnRecPause').addEventListener('click', togglePauseRecording);
  $('#btnOpenRec').addEventListener('click', () => Rec.lastPath && api.openPath(Rec.lastPath));
  $('#btnShowRec').addEventListener('click', () => Rec.lastPath && api.showItem(Rec.lastPath));
  $('#btnRecFolder').addEventListener('click', async () => {
    $('#recFolder').textContent = await api.recChooseFolder();
  });

  // ---------- hotkey dari main ----------
  api.onHotkey((action) => {
    switch (action) {
      case 'select':
        return selectArea();
      case 'reread':
        return rereadArea();
      case 'continuous':
        return toggleContinuous();
      case 'autoScroll':
        return toggleAutoScroll(true);
      case 'record':
        return state.recording ? stopRecording() : startRecording();
      case 'stopAll':
        return stopAll();
    }
  });

  // ---------- update ----------
  api.onUpdateReady((v) => {
    $('#updVer').textContent = v ? 'v' + v : '';
    $('#updateBar').classList.remove('hidden');
  });
  $('#btnUpdate').addEventListener('click', () => {
    if (state.recording) return toast('Hentikan rekaman dulu sebelum memasang update.');
    api.installUpdate();
  });

  // ---------- mulai ----------
  const HOTKEY_LABELS = {
    select: 'Pilih area & baca',
    reread: 'Baca ulang area terakhir',
    continuous: 'Baca Terus (baca + gulir) mulai/berhenti',
    scrollDown: 'Gulir ke bawah di posisi mouse',
    scrollUp: 'Gulir ke atas di posisi mouse',
    autoScroll: 'Gulir otomatis mulai/berhenti',
    record: 'Rekam layar mulai/stop',
    stopAll: 'Hentikan suara, Baca Terus & gulir',
    page: 'Buka halaman di aplikasi',
  };
  (async () => {
    S = await api.getSettings();
    const info = await api.info();
    bindSettings();
    syncOutputs();
    $('#autoSpeed').value = msToSpeed(S.autoScrollIntervalMs);
    syncAutoSpeed();
    $('#ver').textContent = info.version;
    $('#recFolder').textContent = info.recFolder;
    $('#hotkeys').innerHTML = Object.entries(info.hotkeys)
      .map(([k, v]) => `<tr><td>${HOTKEY_LABELS[k] || k}${info.hotkeyStatus[k] === false ? '<span class="bad">dipakai aplikasi lain</span>' : ''}</td><td><kbd>${v}</kbd></td></tr>`)
      .join('');
    refreshRegion(info.region);
    updateCount();
    pushState();
    loadVoices().catch(() => {});
    const bad = Object.entries(info.hotkeyStatus).filter(([, ok]) => ok === false).map(([k]) => info.hotkeys[k]);
    if (bad.length) toast('Hotkey ' + bad.join(', ') + ' sudah dipakai aplikasi lain.', 6000);
  })();

  window.__bacaLayar = { putText, setStatus, toast, Player, state }; // untuk uji otomatis
})();
