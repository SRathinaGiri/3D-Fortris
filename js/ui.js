/* ==========================================================================
   3D FORTRIS - UI MANAGER (menu, settings persistence, on-screen pad)
   Menu shell, folds, install flow and pairing panel follow 3D Labyrinth.
   ========================================================================== */

import { WELL_LIMITS, WELL_HEIGHTS, clampWellSize, clampWellHeight } from './config.js';
import { PROGRESS_KEY, freshProgress } from './progress.js';

const SETTINGS_KEY = '3d_fortris_settings';
const PAD_LABEL = { auto: 'Auto', on: 'On', off: 'Off' };
const MODE_NAME = { '2d': '2D', parallel: 'Parallel 3D', cross: 'Cross-Eye 3D', anaglyph: 'Anaglyph', hsbs: 'Smart Glasses' };
const REPEAT_DELAY = 220, REPEAT_RATE = 85; // ms, held on-screen arrows

const $ = id => document.getElementById(id);

export class UIManager {
  constructor(app) {
    this.app = app;
    this.modals = ['pauseScreen']; // only the settings sheet; game messages are 3D panels
    this.bindButtons();
    this.bindStereo();
    this.bindLook();
    this.bindPad();
    this.loadSettings();
    this.setupFolds();
    this.setupInstall();
  }

  on(id, fn) {
    const el = $(id);
    if (el) el.addEventListener('click', e => { e.preventDefault(); this.app.audio.ensureContext(); fn(e); });
  }

  bindButtons() {
    const a = this.app;
    this.on('playBtn', () => a.startGame({ resume: !!a.progress.saved }));
    this.on('newGameBtn', () => a.startGame({ resume: false }));
    this.on('gamePauseBtn', () => a.handleAction('pause'));
    this.on('gameStopBtn', () => a.stopGame());
    this.on('gameRestartBtn', () => a.handleAction('restart'));
    this.on('gameTurnLBtn', () => a.handleAction('turnL'));
    this.on('gameTurnRBtn', () => a.handleAction('turnR'));
    this.on('gameTopBtn', () => a.handleAction('top'));
    this.on('resumeBtn', () => { this.hideModals(); if (a.state === 'PAUSED') a.togglePause(); });
    this.on('settingsBackBtn', () => this.hideModals()); // back to the 3D pause panel
    this.on('resetScoresBtn', () => {
      if (!confirm('Clear the high scores and the saved game?')) return;
      a.progress = { ...freshProgress(), size: a.progress.size, height: a.progress.height };
      try { localStorage.removeItem(PROGRESS_KEY); } catch (_) { /* storage blocked */ }
      this.renderMenu();
    });
    ['audioToggle', 'gameAudioBtn'].forEach(id => this.on(id, () => this.toggleMute()));
    this.on('autoRotateBtn', () => { a.settings.autoRotate = !a.settings.autoRotate; this.syncCamera(); this.saveSettings(); });
    this.on('padModeBtn', () => {
      a.settings.pad = { auto: 'on', on: 'off', off: 'auto' }[a.settings.pad] || 'auto';
      this.syncPad(); this.saveSettings();
    });
    this.on('helpBtn', () => $('infoDrawer').classList.remove('hidden'));
    this.on('closeInfoBtn', () => $('infoDrawer').classList.add('hidden'));
    this.on('phonePadBtn', () => a.startPhoneLink());
    this.on('linkDoneBtn', () => $('linkPanel').classList.add('hidden'));
    this.on('linkStopBtn', () => { a.stopPhoneLink(); $('linkPanel').classList.add('hidden'); });

    const size = $('sizeSlider');
    if (size) {
      size.min = WELL_LIMITS.min; size.max = WELL_LIMITS.max;
      size.addEventListener('input', () => {
        a.progress.size = clampWellSize(size.value);
        this.syncSize();
      });
      size.addEventListener('change', () => a.saveProgress());
    }
    // Well height: 12 / 15 / 20 (Classic). Lower wells show bigger in side-by-side 3D on phones.
    const hs = $('heightSelector');
    if (hs) for (const h of WELL_HEIGHTS) {
      const b = document.createElement('button');
      b.className = 'look-btn';
      b.dataset.height = h;
      b.textContent = h === 20 ? '20 · Classic' : String(h);
      b.addEventListener('click', e => { e.preventDefault(); a.progress.height = clampWellHeight(h); a.saveProgress(); this.syncSize(); });
      hs.appendChild(b);
    }
  }

  /* ---------- Stereo (shared by the menu and the in-game settings sheet) ---------- */
  bindStereo() {
    document.querySelectorAll('.mode-btn').forEach(btn => btn.addEventListener('click', e => {
      e.preventDefault();
      this.setStereoMode(btn.dataset.mode);
      this.saveSettings();
    }));
    this.bindSliderPair('.depth-slider', '.depth-val', v => { this.app.depth = v; }, v => v.toFixed(2));
    this.bindSliderPair('.focus-slider', '.focus-val', v => { this.app.focusOffset = v / 100; }, v => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`);
    document.querySelectorAll('.swap-btn').forEach(btn => btn.addEventListener('click', e => {
      e.preventDefault();
      this.app.renderer.swapEyes = !this.app.renderer.swapEyes;
      this.syncSwap();
      this.saveSettings();
    }));
  }

  bindSliderPair(sliderSel, valSel, apply, fmt) {
    const sliders = document.querySelectorAll(sliderSel), vals = document.querySelectorAll(valSel);
    const set = v => {
      sliders.forEach(s => { s.value = v; });
      vals.forEach(el => { el.textContent = fmt(v); });
      apply(v);
    };
    sliders.forEach(s => s.addEventListener('input', () => { set(parseFloat(s.value)); this.saveSettings(); }));
    this[`set_${sliderSel}`] = set;
    return set;
  }

  setStereoMode(mode) {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    // Side-by-side needs a 2:1 view: on a landscape phone the pads then float over it (see CSS .dual)
    document.getElementById('gamePage').classList.toggle('dual', ['parallel', 'cross', 'hsbs'].includes(mode));
    this.app.renderer.setMode(mode);
    // Changed mid-game (a tap, so allowed): side-by-side modes need landscape, re-lock to match
    if (!this.loading && this.app.state !== 'MENU') this.app.lockOrientation();
  }

  syncSwap() { document.querySelectorAll('.swap-btn').forEach(b => b.classList.toggle('active', this.app.renderer.swapEyes)); }

  /* ---------- Look: cube opacity, ghost, drop guides, side panels ---------- */
  bindLook() {
    const a = this.app;
    this.bindSliderPair('.opacity-slider', '.opacity-val', v => { a.settings.opacity = v; a.well.setOpacity(v); }, v => `${Math.round(v * 100)}%`);
    this.on('ghostBtn', () => { a.settings.ghost = !a.settings.ghost; this.applyLook(); });
    this.on('guidesBtn', () => { a.settings.guides = !a.settings.guides; this.applyLook(); });
    this.on('panelsBtn', () => a.handleAction('panels'));
  }

  applyLook() {
    const a = this.app;
    a.well.showGhost = a.settings.ghost;
    a.well.showGuides = a.settings.guides;
    a.dirty.piece = true;
    this.syncLook();
    this.saveSettings();
  }

  syncLook() {
    const s = this.app.settings;
    const set = (id, on, label) => { const b = $(id); if (b) { b.classList.toggle('active', on); b.textContent = `${label}: ${on ? 'ON' : 'OFF'}`; } };
    set('ghostBtn', s.ghost, '👻 Landing ghost');
    set('guidesBtn', s.guides, '⇣ Drop guides');
    set('panelsBtn', s.panels, '▤ Next & Layers panels');
    this.syncSummaries();
  }

  syncCamera() {
    const a = this.app;
    const b = $('autoRotateBtn');
    if (b) { b.classList.toggle('active', a.settings.autoRotate); b.textContent = `🔄 Auto-rotate camera: ${a.settings.autoRotate ? 'ON' : 'OFF'}`; }
    const t = $('gameTopBtn');
    if (t) t.classList.toggle('active', a.orbit.top);
    this.syncSummaries();
  }

  /* ---------- On-screen pad (phones / tablets) ---------- */
  bindPad() {
    const c = this.app.controls;
    document.querySelectorAll('[data-act]').forEach(btn => {
      const act = btn.dataset.act;
      let timer = null;
      const stop = () => { clearTimeout(timer); clearInterval(timer); timer = null; btn.classList.remove('held'); };
      btn.addEventListener('pointerdown', e => {
        e.preventDefault();
        this.app.audio.ensureContext();
        btn.classList.add('held');
        c.fire(act, 'touch');
        if (navigator.vibrate) { try { navigator.vibrate(8); } catch (_) { /* unsupported */ } }
        if (btn.dataset.repeat) {
          timer = setTimeout(() => { timer = setInterval(() => { if (!c.menuMode) c.fire(act, 'touch'); }, REPEAT_RATE); }, REPEAT_DELAY);
        }
      });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => btn.addEventListener(ev, stop));
      btn.addEventListener('contextmenu', e => e.preventDefault());
    });
  }

  syncPad() {
    const mode = this.app.settings.pad;
    const on = mode === 'on' || (mode === 'auto' && matchMedia('(pointer: coarse)').matches);
    $('gamePage').classList.toggle('pad-on', on);
    const b = $('padModeBtn');
    if (b) { b.textContent = `🕹 Touch pad: ${PAD_LABEL[mode]}`; b.classList.toggle('active', on); }
    this.app.renderer.handleResize();
    this.syncSummaries();
  }

  /* ---------- Menu ---------- */
  syncSize() {
    const p = this.app.progress, s = p.size, h = p.height;
    if ($('sizeSlider')) $('sizeSlider').value = s;
    if ($('sizeVal')) $('sizeVal').textContent = `${s} × ${s} × ${h}`;
    document.querySelectorAll('[data-height]').forEach(b => b.classList.toggle('active', +b.dataset.height === h));
    const note = $('sizeNote');
    if (note) {
      const saved = p.saved, sh = saved && (saved.height || (saved.grid && saved.grid.length));
      note.textContent = saved && (saved.size !== s || sh !== h)
        ? `Continue keeps the saved game's ${saved.size}×${saved.size}×${sh} well; a new game uses ${s}×${s}×${h}.`
        : 'Smaller wells clear faster; a lower well shows bigger in side-by-side 3D on a phone.';
    }
  }

  renderMenu() {
    const p = this.app.progress, saved = p.saved;
    const play = $('playBtn');
    if (play) play.textContent = saved ? `▶ Continue · Level ${saved.level} · ★ ${(saved.score || 0).toLocaleString()}` : '▶ Play';
    if ($('newGameBtn')) $('newGameBtn').classList.toggle('hidden', !saved);
    const list = $('scoreList');
    if (list) {
      list.innerHTML = '';
      if (!p.scores.length) list.innerHTML = '<li class="empty">No scores yet. Clear a layer to get on the board.</li>';
      p.scores.forEach((s, i) => {
        const li = document.createElement('li');
        const when = s.at ? new Date(s.at).toLocaleDateString() : '';
        li.innerHTML = `<span class="rk">${i + 1}</span><span class="sc">★ ${s.score.toLocaleString()}</span><span class="dt">L${s.level} · ${s.lines} layers · ${s.size}×${s.size}×${s.height}${when ? ' · ' + when : ''}</span>`;
        list.appendChild(li);
      });
    }
    if ($('totalLines')) $('totalLines').textContent = p.totalLines ? `${p.totalLines.toLocaleString()} layers cleared on this device` : '';
    this.syncSize();
  }

  /* ---------- Collapsible menu sections ---------- */
  setupFolds() {
    const key = '3d_fortris_folds';
    let open = {};
    try { open = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (_) { open = {}; }
    document.querySelectorAll('details.fold').forEach(d => {
      d.open = !!open[d.dataset.fold];
      d.addEventListener('toggle', () => {
        open[d.dataset.fold] = d.open;
        try { localStorage.setItem(key, JSON.stringify(open)); } catch (_) { /* storage blocked */ }
      });
    });
    this.syncSummaries();
  }

  /** One-line summaries on the closed section headers. */
  syncSummaries() {
    const a = this.app;
    const set = (id, text) => { if ($(id)) $(id).textContent = text; };
    set('sumControls', `Auto-rotate ${a.settings.autoRotate ? 'on' : 'off'} · pad ${PAD_LABEL[a.settings.pad].toLowerCase()}`);
    set('sumLook', `Opacity ${Math.round(a.settings.opacity * 100)}%${a.settings.ghost ? ' · ghost' : ''}${a.settings.guides ? ' · guides' : ''}`);
    set('sum3d', `${MODE_NAME[a.renderer.mode]}${a.renderer.mode === '2d' ? '' : ` · depth ${a.depth.toFixed(2)}`}`);
  }

  /* ---------- Phone controller pairing panel ---------- */
  showLinkPanel(code, status) {
    const url = new URL('controller.html', location.href);
    url.search = ''; url.hash = '';
    $('linkUrl').textContent = url.href;
    $('linkCode').textContent = code || '······';
    $('linkPanel').classList.remove('hidden');
    this.setLinkStatus(status);
  }

  setLinkStatus(s) {
    const el = $('linkStatus'), btn = $('phonePadBtn');
    const text = {
      starting: '⏳ Getting a code…', waiting: '⏳ Waiting for the phone…', connected: '✅ Phone connected: steer with it',
      phone: '📲 Phone found · connecting directly over Wi-Fi…',
      failed: '⚠ The phone found this screen but could not connect directly. Same Wi-Fi? Guest networks often block devices talking to each other.',
      lost: '⚠ Phone disconnected: enter the code again on the phone', off: ''
    }[s] ?? (s.startsWith('error:') ? `⚠ ${s.slice(6)}` : '');
    if (el) el.textContent = text;
    if (btn) {
      btn.classList.toggle('active', s === 'connected');
      btn.textContent = s === 'connected' ? '📲 Phone: connected' : '📲 Phone controller';
    }
    if (s === 'connected') setTimeout(() => { if (this.app.link && this.app.link.connected) $('linkPanel').classList.add('hidden'); }, 1500);
  }

  /* ---------- Install as an app (from 3D Labyrinth) ---------- */
  setupInstall() {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    if (standalone) return;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    let deferred = null;
    const dismissedKey = '3d_fortris_install_dismissed';
    const show = () => {
      if ($('installBtn')) $('installBtn').style.display = 'inline-flex';
      let dismissed = false;
      try { dismissed = localStorage.getItem(dismissedKey) === '1'; } catch (_) { /* storage blocked */ }
      if (!dismissed) $('installBanner').classList.remove('hidden');
    };
    const hide = () => {
      if ($('installBtn')) $('installBtn').style.display = 'none';
      $('installBanner').classList.add('hidden');
    };
    const install = async () => {
      if (deferred) {
        deferred.prompt();
        const { outcome } = await deferred.userChoice;
        deferred = null;
        if (outcome === 'accepted') hide();
      } else if (isIOS) {
        $('iosInstallHelp').classList.remove('hidden');
      }
    };
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; show(); });
    window.addEventListener('appinstalled', hide);
    this.on('installBtn', install);
    this.on('installBannerBtn', install);
    this.on('closeInstallBtn', () => {
      $('installBanner').classList.add('hidden');
      try { localStorage.setItem(dismissedKey, '1'); } catch (_) { /* storage blocked */ }
    });
    this.on('closeIosHelpBtn', () => $('iosInstallHelp').classList.add('hidden'));
    if (isIOS) show();
  }

  /* ---------- Pages, modals, sound ---------- */
  showMenuPage() {
    $('gamePage').classList.add('hidden');
    $('menuPage').classList.remove('hidden');
    this.hideModals();
    this.renderMenu();
  }

  showGamePage() {
    $('menuPage').classList.add('hidden');
    $('gamePage').classList.remove('hidden');
    this.hideModals();
    this.syncPad();
  }

  showModal(id) { this.hideModals(); $(id).classList.remove('hidden'); }
  hideModals() { this.modals.forEach(id => $(id) && $(id).classList.add('hidden')); }

  toggleMute() {
    const m = this.app.audio.toggleMute();
    if (!m && this.app.state === 'PLAYING') this.app.audio.startMusic();
    this.syncMute();
    this.saveSettings();
  }

  syncMute() {
    const m = this.app.audio.muted;
    if ($('audioToggle')) $('audioToggle').textContent = m ? '🔇 Muted' : '🔊 Sound';
    if ($('gameAudioBtn')) { $('gameAudioBtn').textContent = m ? '🔇' : '🔊'; $('gameAudioBtn').classList.toggle('active', m); }
  }

  showUpdatePrompt(worker) {
    const banner = $('updateBanner');
    banner.classList.remove('hidden');
    $('installUpdateBtn').onclick = () => { $('installUpdateBtn').textContent = '⏳ Updating...'; worker.postMessage({ type: 'SKIP_WAITING' }); };
    $('closeUpdateBtn').onclick = () => banner.classList.add('hidden');
  }

  /* ---------- Settings persistence ---------- */
  saveSettings() {
    if (this.loading) return;
    const a = this.app;
    const s = {
      mode: a.renderer.mode, depth: a.depth, focus: Math.round(a.focusOffset * 100), swapEyes: a.renderer.swapEyes,
      muted: a.audio.muted, ...a.settings
    };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (_) { /* storage blocked */ }
    this.syncSummaries();
  }

  loadSettings() {
    this.loading = true;
    let s = {};
    try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch (_) { s = {}; }
    const a = this.app, num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    this.setStereoMode(s.mode || '2d');
    this['set_.depth-slider'](num(s.depth, 1.0));
    this['set_.focus-slider'](num(s.focus, 0));
    this['set_.opacity-slider'](num(s.opacity, 0.85));
    a.renderer.swapEyes = !!s.swapEyes; this.syncSwap();
    for (const k of ['autoRotate', 'ghost', 'guides', 'panels']) if (typeof s[k] === 'boolean') a.settings[k] = s[k];
    if (PAD_LABEL[s.pad]) a.settings.pad = s.pad;
    a.well.showGhost = a.settings.ghost; a.well.showGuides = a.settings.guides;
    if (s.muted && !a.audio.muted) a.audio.toggleMute();
    this.syncMute();
    this.syncLook();
    this.syncCamera();
    this.syncPad();
    this.loading = false;
  }
}
