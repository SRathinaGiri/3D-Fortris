// Every release must bump the version everywhere, including the service-worker cache name;
// otherwise installed PWAs keep serving the old cache. Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { VERSION } from '../js/config.js';

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const MODULES = readdirSync(new URL('../js/', import.meta.url)).filter(f => f.endsWith('.js')).map(f => f.slice(0, -3));

test('version is identical in config, service worker, manifest and both pages', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
  const sw = read('sw.js').match(/CACHE_VERSION = 'fortris-v([\d.]+)'/);
  assert.ok(sw, 'CACHE_VERSION not found in sw.js');
  assert.equal(sw[1], VERSION, 'sw.js CACHE_VERSION not bumped');
  assert.equal(JSON.parse(read('manifest.json')).version, VERSION, 'manifest.json version not bumped');
  for (const page of ['index.html', 'controller.html']) {
    const html = read(page).replace(/peerjs\.min\.js\?v=[\d.]+/g, ''); // bundled library keeps its own version
    const tags = [...html.matchAll(/v=?(\d+\.\d+\.\d+)/g)].map(m => m[1]);
    assert.ok(tags.length >= 3, `expected version tags in ${page}`);
    for (const t of tags) assert.equal(t, VERSION, `${page} still references v${t}`);
  }
});

test('service worker pre-caches every JS module, both pages and the icons', () => {
  const sw = read('sw.js');
  for (const m of MODULES) assert.ok(sw.includes(`'./js/${m}.js'`), `sw.js does not cache js/${m}.js`);
  for (const f of ['./controller.html', './index.html', './css/styles.css', './js/lib/three.min.js', './js/lib/peerjs.min.js']) {
    assert.ok(sw.includes(`'${f}'`), `sw.js does not cache ${f}`);
  }
  assert.match(sw, /cache: 'reload'/, 'service worker must pre-cache from the network');
});

test('import map pins every game module to the current version (no stale-module mixing after updates)', () => {
  const html = read('index.html');
  const imports = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
  for (const mod of MODULES.filter(m => m !== 'app' && m !== 'pad')) {
    assert.equal(imports[`./js/${mod}.js`], `./js/${mod}.js?v=${VERSION}`, `import map entry for ${mod}.js`);
  }
  assert.ok(html.indexOf('type="importmap"') < html.indexOf('type="module"'), 'import map must come before the module script');
  const pad = read('controller.html');
  const padImports = JSON.parse(pad.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
  assert.equal(padImports['./js/link.js'], `./js/link.js?v=${VERSION}`);
  assert.ok(pad.includes(`./js/pad.js?v=${VERSION}`));
});

test('every module imported anywhere exists and is in the import map', () => {
  const html = read('index.html');
  const imports = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
  for (const m of MODULES) {
    for (const [, dep] of read(`js/${m}.js`).matchAll(/from '\.\/([a-z0-9]+)\.js'/g)) {
      assert.ok(MODULES.includes(dep), `js/${m}.js imports missing ${dep}.js`);
      if (m !== 'pad') assert.ok(imports[`./js/${dep}.js`], `${dep}.js missing from the import map`);
    }
  }
});

test('bundled libraries load before the game modules', () => {
  const html = read('index.html');
  for (const lib of ['three.min.js', 'peerjs.min.js']) {
    assert.ok(html.indexOf(lib) > -1 && html.indexOf(lib) < html.indexOf('type="module"'), `${lib} must load before the modules`);
  }
  assert.ok(read('js/lib/peerjs.LICENSE.txt').includes('peerjs@1.5.5'));
  assert.ok(/window\.Peer=/.test(read('js/lib/peerjs.min.js')), 'not the PeerJS browser bundle');
});

test('privacy: PeerJS TURN relays are switched off (STUN only)', () => {
  const link = read('js/link.js');
  assert.match(link, /config:\s*\{\s*iceServers:\s*LINK\.ICE\s*\}/, 'link.js must override PeerJS default iceServers');
  assert.doesNotMatch(link, /turn:/i, 'no TURN server may be configured');
  assert.match(link, /PREFIX: 'fortris3d-v1-'/, 'own pairing namespace, so codes never reach a 3D Labyrinth screen');
});

test('privacy: the only outside hosts are the pairing server and STUN', () => {
  const allowed = new Set(['0.peerjs.com', 'stun.l.google.com']);
  const files = [...MODULES.map(m => `js/${m}.js`), 'sw.js', 'index.html', 'controller.html'];
  for (const f of files) {
    const src = read(f);
    for (const m of src.matchAll(/(?:wss?|https?|stun|turn):\/\/([a-z0-9.-]+)/gi)) {
      assert.ok(allowed.has(m[1].toLowerCase()), `${f} contacts an unapproved host: ${m[0]}`);
    }
    for (const m of src.matchAll(/(?:HOST|urls)\s*:\s*['"](?:stun:)?([a-z0-9.-]+)/gi)) {
      assert.ok(allowed.has(m[1].toLowerCase()), `${f} configures an unapproved host: ${m[1]}`);
    }
  }
});

test('PWA is installable: PNG 192/512 icons (any + maskable) exist, are listed and pre-cached', () => {
  const m = JSON.parse(read('manifest.json'));
  assert.equal(m.display, 'standalone');
  assert.ok(m.start_url && m.scope && m.id, 'start_url, scope and id required');
  const sw = read('sw.js');
  for (const purpose of ['any', 'maskable']) {
    for (const size of ['192x192', '512x512']) {
      const icon = m.icons.find(i => i.type === 'image/png' && i.sizes === size && i.purpose === purpose);
      assert.ok(icon, `manifest lacks a ${size} ${purpose} PNG icon`);
      const png = readFileSync(new URL(`../${icon.src.replace('./', '')}`, import.meta.url));
      assert.equal(png.readUInt32BE(16), +size.split('x')[0], `${icon.src} is not ${size}`);
      assert.ok(sw.includes(`'${icon.src}'`), `sw.js does not cache ${icon.src}`);
    }
  }
});

test('service worker only deletes its own old caches (other games share the github.io origin)', () => {
  const sw = read('sw.js');
  const activate = sw.slice(sw.indexOf("addEventListener('activate'"), sw.indexOf("addEventListener('message'"));
  assert.match(activate, /startsWith\(CACHE_PREFIX\)/, 'activate must filter cache names by our prefix');
  assert.match(sw, /CACHE_PREFIX = 'fortris-'/);
});
