// Browser smoke test: opens both tools in headless Edge/Chrome against a running
// server, waits for their data to load, then decodes a status and parses every
// capture in test/fixtures/battles, checking the results render.
//
//   bin/rails server -p 3055        (in another terminal)
//   node test/browser/smoke.mjs http://localhost:3055
//
// Uses the Chrome DevTools Protocol directly (Node 24 has fetch and WebSocket),
// so there are no npm dependencies. Set BROWSER to the browser executable if
// Edge/Chrome isn't in a standard location.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] ?? 'http://localhost:3055';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 9300 + Math.floor(Math.random() * 500);

const CANDIDATES = [
  process.env.BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/microsoft-edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch() {
  const exe = CANDIDATES.find(p => fs.existsSync(p));
  if (!exe) throw new Error('No Edge/Chrome found; set BROWSER to its path');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ffrk-smoke-'));
  const proc = spawn(exe, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, 'about:blank',
  ], { stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try {
      const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      return { proc, profile, browserWs: webSocketDebuggerUrl };
    } catch { await sleep(100); }
  }
  throw new Error('Browser did not open its debugging port');
}

async function openPage(url) {
  const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${url}`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push(msg.params.entry.text);
  };
  const send = (method, params = {}) => new Promise(res => {
    const msgId = ++id;
    pending.set(msgId, res);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
  await send('Runtime.enable');
  await send('Log.enable');
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluate failed');
    return r.result.result.value;
  };
  const waitFor = async (expr, what, timeoutMs = 60000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await evaluate(expr).catch(() => false)) return;
      await sleep(200);
    }
    throw new Error(`Timed out waiting for ${what}`);
  };
  return { evaluate, waitFor, errors, close: () => ws.close() };
}

const text = id => `(document.getElementById('${id}')?.textContent ?? '')`;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

// Browser.close shuts down every browser process; killing the launcher alone
// leaves its child processes running on Windows.
async function closeBrowser(browserWs, proc) {
  try {
    const ws = new WebSocket(browserWs);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
    await sleep(1000);
  } catch {}
  proc.kill();
}

const { proc, profile, browserWs } = await launch();
try {
  // ── Status Decoder ──
  const sd = await openPage(`${BASE}/status_decoder`);
  await sd.waitFor(`/assignments/.test(${text('li-parse-detail')})`, 'decoder data to load');
  check('decoder loads battle.js', await sd.evaluate(`document.getElementById('li-battlejs-icon').className.includes('ok')`), await sd.evaluate(text('li-battlejs-detail')));
  check('decoder loads sheets', await sd.evaluate(`document.getElementById('li-sheets-icon').className.includes('ok')`), await sd.evaluate(text('li-sheets-detail')));
  check('decoder builds status assignments', true, await sd.evaluate(text('li-parse-detail')));
  await sd.evaluate(`(() => { const i = document.getElementById('status-input'); i.value = 'CRYSTAL_BUDDY_MODE_DESHI'; document.getElementById('decode-btn').click(); })()`);
  await sd.waitFor(`!!document.getElementById('tsv-out')`, 'a decoded status');
  const tsv = await sd.evaluate(`document.getElementById('tsv-out').value`);
  check('decoder decodes CRYSTAL_BUDDY_MODE_DESHI', /Crystal Force Mode/.test(tsv), tsv.slice(0, 80));
  check('decoder page has no script errors', sd.errors.length === 0, sd.errors.join(' | '));
  sd.close();

  // ── Ability Parser ──
  const battles = path.join(ROOT, 'test/fixtures/battles');
  for (const file of fs.readdirSync(battles).filter(f => /\.(json|txt)$/.test(f)).sort()) {
    const ap = await openPage(`${BASE}/ability_parser`);
    await ap.waitFor(`!document.getElementById('parse-btn').disabled`, 'parser data to load');
    const input = fs.readFileSync(path.join(battles, file), 'utf8');
    await ap.evaluate(`(() => { document.getElementById('json-input').value = ${JSON.stringify(input)}; document.getElementById('parse-btn').click(); })()`);
    await ap.waitFor(`document.querySelectorAll('.sbp-tsv-area').length > 0 || !!${text('parse-error')}`, `rows for ${file}`);
    const rows = await ap.evaluate(`document.querySelectorAll('.sbp-tsv-area').length`);
    const err = await ap.evaluate(text('parse-error'));
    check(`parser renders ${file}`, rows > 0 && !err, err || `${rows} sheet rows`);
    check(`parser page has no script errors (${file})`, ap.errors.length === 0, ap.errors.join(' | '));
    ap.close();
  }
} catch (e) {
  check('smoke test ran to completion', false, e.message);
} finally {
  await closeBrowser(browserWs, proc);
  // The browser can hold profile files briefly after exit; cleanup is best-effort.
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch {}
}

const failed = results.filter(ok => !ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
