/* ==========================================================================
   3D FORTRIS - PHONE CONTROLLER PAGE (controller.html)
   A joypad that sends presses to the game on the TV / glasses screen through
   link.js (pattern from 3D Labyrinth):
     MOVE  virtual stick: push the knob towards a direction, hold to repeat
     SPIN  swipe to roll the piece the way you swipe (relative to the
           camera), twist two fingers to turn it clockwise / anticlockwise
     DROP  ✂ cut the rope: the piece drops now (it also falls by itself after 10 s)
   ========================================================================== */

import { PadLink } from './link.js';

const $ = id => document.getElementById(id);
const REPEAT_DELAY = 220, REPEAT_RATE = 85; // ms

let connected = false, wakeLock = null, inPanel = false;

const link = new PadLink({
  onMessage: m => { if (m && m.t === 'state') showState(m); },
  onStatus: s => {
    if (s === 'answered') setStatus('✅ Found the game · connecting directly over Wi-Fi…');
    if (s === 'connected') { connected = true; showPad(true); setStatus(''); }
    if (s === 'lost' || s === 'failed') { connected = false; showPad(false); setStatus('⚠ Lost the connection. Enter the code again.'); }
  }
});

function setStatus(text) { $('padStatus').textContent = text; }

function showPad(on) {
  $('pairCard').classList.toggle('hidden', on);
  $('padCard').classList.toggle('hidden', !on);
}

/** While a 3D panel is open on the screen, the arrows walk its buttons (the game maps them). */
function press(b) {
  if (!connected) return;
  link.send({ t: 'btn', b });
  if (navigator.vibrate) { try { navigator.vibrate(12); } catch (_) { /* unsupported */ } }
}

function showState(m) {
  const fast = m.s === 'PLAYING' && !m.panel;
  const label = m.panel || m.s === 'MENU' ? ['▶', m.panel ? 'OK' : 'Start'] : ['✂', m.hold && m.left ? `Drop now · falls in ${m.left}` : 'Drop'];
  $('dropIcon').textContent = label[0]; $('dropText').textContent = label[1];
  $('dropBtn').classList.toggle('fast', fast);
  const names = { MENU: 'Menu', PLAYING: m.hold ? `Line it up · falls in ${m.left || 0} s` : 'Falling', PAUSED: 'Paused', OVER: 'Game over' };
  $('tvStatus').textContent = [`Level ${m.lv}`, `★ ${Number(m.score || 0).toLocaleString()}`, `${m.lines} layers`, names[m.s] || m.s].join(' · ');
  $('nextInfo').textContent = Array.isArray(m.next) && m.next.length ? `Next: ${m.next.join(' → ')}` : '';
  inPanel = !!m.panel;
  $('panelHint').textContent = m.panel ? `On screen: ${m.panel}. Push the stick ◀ ▶ and press OK.` : (m.s === 'MENU' ? 'Press DROP or OK to start.' : '');
}

async function keepAwake() {
  if (!('wakeLock' in navigator) || wakeLock) return;
  try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } catch (_) { /* not allowed */ }
}

async function connect() {
  const code = $('codeInput').value.trim();
  if (!/^\d{6}$/.test(code)) { setStatus('Enter the 6-digit code shown on the screen.'); return; }
  $('connectBtn').disabled = true;
  setStatus('⏳ Connecting…');
  keepAwake();
  try {
    await link.connect(code);
  } catch (err) {
    setStatus(`⚠ ${err.message}`);
    link.stop();
  } finally {
    $('connectBtn').disabled = false;
  }
}

document.querySelectorAll('[data-b]').forEach(btn => {
  let timer = null;
  const stop = () => { clearTimeout(timer); clearInterval(timer); timer = null; };
  btn.addEventListener('pointerdown', e => {
    e.preventDefault();
    press(btn.dataset.b);
    if (btn.dataset.repeat) timer = setTimeout(() => { timer = setInterval(() => { if (!inPanel) press(btn.dataset.b); }, REPEAT_RATE); }, REPEAT_DELAY);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => btn.addEventListener(ev, stop));
  btn.addEventListener('contextmenu', e => e.preventDefault());
});

/* ---------- MOVE: virtual stick (4-way, auto-repeat while held) ---------- */
function bindStick() {
  const zone = $('stickZone'), knob = $('stickKnob');
  let id = null, dir = null, timer = null;
  const stopRepeat = () => { clearTimeout(timer); clearInterval(timer); timer = null; };
  const setDir = d => {
    if (d === dir) return;
    dir = d; stopRepeat();
    if (!d) return;
    press(d);
    timer = setTimeout(() => { timer = setInterval(() => { if (!inPanel && dir) press(dir); }, REPEAT_RATE); }, REPEAT_DELAY);
  };
  const track = e => {
    const r = zone.getBoundingClientRect(), radius = r.width / 2;
    let dx = e.clientX - (r.left + radius), dy = e.clientY - (r.top + radius);
    const len = Math.hypot(dx, dy), max = radius * 0.62;
    if (len > max) { dx *= max / len; dy *= max / len; }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    setDir(len < radius * 0.3 ? null : Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  };
  zone.addEventListener('pointerdown', e => {
    if (id !== null) return;
    e.preventDefault(); id = e.pointerId;
    try { zone.setPointerCapture(id); } catch (_) { /* gone */ }
    track(e);
  });
  zone.addEventListener('pointermove', e => { if (e.pointerId === id) { e.preventDefault(); track(e); } });
  const end = e => { if (e.pointerId !== id) return; id = null; setDir(null); knob.style.transform = ''; };
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);
}

/* ---------- SPIN: swipe = roll (camera-relative), two-finger twist = turn ---------- */
const SWIPE_PX = 42, TWIST_RAD = 0.6;
function bindSpin() {
  const zone = $('spinZone'), flash = $('spinFlash'), pts = new Map();
  let anchor = null, twist = null, flashTimer = null;
  const show = icon => {
    flash.textContent = icon; flash.classList.add('show');
    clearTimeout(flashTimer); flashTimer = setTimeout(() => flash.classList.remove('show'), 120);
  };
  const angle = () => { const [a, b] = [...pts.values()]; return Math.atan2(b.y - a.y, b.x - a.x); };
  const restart = () => {
    twist = pts.size === 2 ? { last: angle(), acc: 0 } : null;
    anchor = pts.size === 1 ? { ...[...pts.values()][0] } : null;
  };
  zone.addEventListener('pointerdown', e => {
    e.preventDefault();
    try { zone.setPointerCapture(e.pointerId); } catch (_) { /* gone */ }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    restart();
  });
  zone.addEventListener('pointermove', e => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    p.x = e.clientX; p.y = e.clientY;
    if (twist) {
      const a = angle();
      let d = a - twist.last; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
      twist.last = a; twist.acc += d;
      // Screen y grows downwards, so a growing angle is clockwise as you see it
      if (Math.abs(twist.acc) >= TWIST_RAD) { const cw = twist.acc > 0; press(cw ? 'twistCW' : 'twistCCW'); show(cw ? '↻' : '↺'); twist.acc = 0; }
    } else if (anchor) {
      const dx = p.x - anchor.x, dy = p.y - anchor.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) >= SWIPE_PX) {
        const b = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'spinR' : 'spinL') : (dy > 0 ? 'spinD' : 'spinU');
        press(b); show({ spinR: '⟳', spinL: '⟲', spinU: '⤴', spinD: '⤵' }[b]);
        anchor = { x: p.x, y: p.y }; // keep swiping for more quarter turns
      }
    }
  });
  const end = e => { if (pts.delete(e.pointerId)) restart(); };
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);
}

bindStick();
bindSpin();
$('connectBtn').addEventListener('click', connect);
$('codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') connect(); });
$('disconnectBtn').addEventListener('click', () => { link.stop(); connected = false; showPad(false); setStatus('Disconnected.'); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && connected) keepAwake(); });
// A code in the address (controller.html#123456) is pre-filled; connecting still needs a tap
if (/^#\d{6}$/.test(location.hash)) $('codeInput').value = location.hash.slice(1);
