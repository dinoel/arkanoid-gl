'use strict';
// Uses an installed Chromium browser and Node 22+ built-ins. No npm packages or downloads.
// BROWSER can point at Chrome/Edge on other machines. Artifacts stay in .artifacts/.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const out = path.join(ROOT, '.artifacts');
fs.mkdirSync(out, { recursive: true });
const playwrightRoot = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright');
const headless = playwrightRoot && fs.existsSync(playwrightRoot) ? fs.readdirSync(playwrightRoot)
  .filter(n => n.startsWith('chromium_headless_shell-')).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  .map(n => path.join(playwrightRoot, n, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe')).find(p => fs.existsSync(p)) : null;
const browser = process.env.BROWSER || [
  headless,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(p => p && fs.existsSync(p));
assert.ok(browser, 'Set BROWSER to an installed Chromium executable');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const p = path.resolve(ROOT, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (p !== ROOT && !p.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(p === ROOT ? path.join(ROOT, 'index.html') : p, (err, data) => {
    if (err) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', mime[path.extname(p)] || 'application/octet-stream'); res.end(data);
  });
});

async function connect(url) {
  const ws = new WebSocket(url), requests = new Map(), events = [];
  let id = 0;
  ws.addEventListener('message', e => {
    const x = JSON.parse(e.data);
    if (x.id) { const p = requests.get(x.id); requests.delete(x.id); if (x.error) p.reject(new Error(JSON.stringify(x.error))); else p.resolve(x.result); }
    else if (x.method === 'Runtime.exceptionThrown') events.push(x.params.exceptionDetails);
  });
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  return { events, close: () => ws.close(), send: (method, params = {}) => new Promise((resolve, reject) => {
    requests.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
  }) };
}

(async () => {
  let child, tab;
  const killTimer = setTimeout(() => { if (child) child.kill(); server.close(); process.exitCode = 1; }, 180000);
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    child = spawn(browser, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
      '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
      '--remote-debugging-port=0', `--user-data-dir=${path.join(out, 'browser-profile')}`, 'about:blank'], { windowsHide: true });
    const endpoint = await new Promise((resolve, reject) => {
      let text = '';
      child.on('error', reject); child.on('exit', code => reject(new Error('Browser exited: ' + code + '\n' + text)));
      child.stderr.on('data', b => { text += b.toString(); const m = text.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (m) resolve(m[1]); });
    });
    const origin = endpoint.replace(/^ws:/, 'http:').split('/devtools/')[0];
    const target = await (await fetch(origin + '/json/new?' + encodeURIComponent(base + '/tests/audio-render.html'), { method: 'PUT' })).json();
    tab = await connect(target.webSocketDebuggerUrl);
    await tab.send('Runtime.enable'); await tab.send('Page.enable');
    await tab.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    async function evaluate(expression) {
      const r = await tab.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    }
    async function ready(urlPath) {
      for (let tries = 0; tries < 100; tries++) {
        try { if (await evaluate(`location.pathname === ${JSON.stringify(urlPath)} && document.readyState === 'complete'`)) return; }
        catch (e) { if (!/context|navigat/i.test(e.message)) throw e; }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error('Page did not load: ' + urlPath);
    }
    await ready('/tests/audio-render.html');
    const renders = [];
    for (const style of ['synthwave', 'techno', 'dnb', 'lofi', 'trap', 'chip']) {
      const r = await evaluate(`renderMusic('${style}', 2026)`);
      if (r.wav) { fs.writeFileSync(path.join(out, 'music-showcase.wav'), Buffer.from(r.wav, 'base64')); delete r.wav; }
      assert.equal(r.nonfinite, 0, style + ' finite samples');
      assert.ok(r.peak < 0.99 && r.peak > 0.02, `${style} peak ${r.peak}`);
      assert.ok(r.rms > 0.005, `${style} audible RMS ${r.rms}`);
      assert.ok(Math.abs(r.dc) < 0.005, style + ' DC offset');
      assert.ok(r.stereo > 0.001, style + ' stereo field');
      assert.ok(r.remaining.voices <= 2, `${style} unreleased voices: ${r.remaining.voices}`);
      renders.push(r); console.log('Audio:', style, 'peak', r.peak.toFixed(3), 'RMS', r.rms.toFixed(3), 'voices', r.remaining.voices);
    }
    const muted = await evaluate("renderMusic('lofi', 2026, true)");
    assert.ok(muted.rms < 0.001, 'master mutes reverb as well as dry signal: ' + muted.rms);

    await tab.send('Page.navigate', { url: base + '/music.html?musicSeed=2026' }); await ready('/music.html');
    await evaluate("document.getElementById('play').click()");
    await evaluate('new Promise(resolve => setTimeout(resolve, 400))');
    assert.equal(await evaluate('AK.A.ctx.state'), 'running');
    await evaluate("document.getElementById('simulateLose').click()");
    assert.equal(await evaluate('AK.Music.state().next'), 'break');
    await evaluate("document.getElementById('play').click()");
    await evaluate('new Promise(resolve => setTimeout(resolve, 100))');
    assert.equal(await evaluate('AK.Music.clock(AK.A.now())'), null);
    assert.equal(await evaluate('AK.MSynth.stats().voices'), 0, 'pause releases pending sources');
    const labShot = await tab.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(out, 'music-lab.png'), Buffer.from(labShot.data, 'base64'));

    await tab.send('Page.navigate', { url: base + '/index.html?seed=2026' }); await ready('/index.html');
    await evaluate("document.getElementById('overlay').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}))");
    await evaluate('new Promise(resolve => setTimeout(resolve, 800))');
    const game = await evaluate(`(() => {
      const M = AK.Music, G = AK.G;
      G.combo = 12; G.pw.fire = 8; AK.UI.intensity();
      return { ready: AK.A.ready, state: G.state, energy: M.state().targetIntensity,
        clock: M.clock(AK.A.now()), spots: G.spots.map(q => ({e:q.e, a:q.a, c:q.c})), glError: document.getElementById('err').textContent };
    })()`);
    assert.ok(game.ready && game.clock && game.energy > 0.7, 'game audio and intensity');
    assert.ok(game.spots.length && game.spots.every(s => Number.isFinite(s.e) && Number.isFinite(s.a) && s.c.every(Number.isFinite)), 'finite animated spotlights');
    assert.equal(tab.events.length, 0, JSON.stringify(tab.events));
    const shot = await tab.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(out, 'game-lights.png'), Buffer.from(shot.data, 'base64'));
    fs.writeFileSync(path.join(out, 'music-validation.json'), JSON.stringify({ renders, muted, game }, null, 2));
    console.log('PASS: six offline renders, wet master mute, Music Lab controls, game and light show.');
  } finally {
    clearTimeout(killTimer); if (tab) tab.close(); if (child) child.kill(); server.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
