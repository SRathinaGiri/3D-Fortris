/* ==========================================================================
   3D FORTRIS - PHONE CONTROLLER PAGE (controller.html)
   Sends button presses to the game on the TV / glasses screen through
   link.js (pattern from 3D Labyrinth). Held arrows auto-repeat on the phone.
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
  const names = { MENU: 'Menu', PLAYING: m.hold ? 'Line it up · DROP to release' : 'Falling', PAUSED: 'Paused', OVER: 'Game over' };
  $('tvStatus').textContent = [`Level ${m.lv}`, `★ ${Number(m.score || 0).toLocaleString()}`, `${m.lines} layers`, names[m.s] || m.s].join(' · ');
  $('nextInfo').textContent = Array.isArray(m.next) && m.next.length ? `Next: ${m.next.join(' → ')}` : '';
  inPanel = !!m.panel;
  $('panelHint').textContent = m.panel ? `On screen: ${m.panel}. Use ◀ ▶ and OK.` : (m.s === 'MENU' ? 'Press DROP or OK to start.' : '');
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

$('connectBtn').addEventListener('click', connect);
$('codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') connect(); });
$('disconnectBtn').addEventListener('click', () => { link.stop(); connected = false; showPad(false); setStatus('Disconnected.'); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && connected) keepAwake(); });
// A code in the address (controller.html#123456) is pre-filled; connecting still needs a tap
if (/^#\d{6}$/.test(location.hash)) $('codeInput').value = location.hash.slice(1);
