// Runs the Ability Parser and Status Decoder page scripts in a Node `vm`
// sandbox, against the frozen data snapshot in test/fixtures/snapshot.
//
// The scripts run unchanged: a minimal fake DOM stands in for the browser, and
// a fake fetch() serves the snapshot for the routes the pages call. Top-level
// declarations in the page scripts (DB, decodeStatus, processBattleJson, ...)
// are reachable through page.eval('name').

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const FIXTURES = path.join(ROOT, 'test/fixtures');
const SNAPSHOT_DIR = path.join(FIXTURES, 'snapshot');

// ─── Snapshot ────────────────────────────────────────────────────────────────
let snapshotCache = null;

export function snapshot() {
  if (snapshotCache) return snapshotCache;
  const read = rel => zlib.gunzipSync(fs.readFileSync(path.join(SNAPSHOT_DIR, `${rel}.gz`))).toString('utf8');
  const sheetsDir = path.join(SNAPSHOT_DIR, 'sheets');
  const sheets = {};
  for (const f of fs.readdirSync(sheetsDir).sort()) {
    const name = f.replace(/\.json\.gz$/, '');
    sheets[name] = JSON.parse(read(`sheets/${name}.json`));
  }
  snapshotCache = { battleJs: read('battle_js.txt'), sheets };
  return snapshotCache;
}

// ─── Page scripts ────────────────────────────────────────────────────────────
const VIEWS = path.join(ROOT, 'app/views');

// Expands `<%= render 'shared/x' %>` and drops ERB comments, then returns the
// inline <script> bodies in document order.
export function pageScripts(view) {
  const expand = file => fs.readFileSync(file, 'utf8')
    .replace(/<%#[\s\S]*?%>/g, '')
    .replace(/<%=\s*render\s+['"]([\w/]+)['"]\s*%>/g, (_, partial) => {
      const [dir, name] = partial.split('/');
      return expand(path.join(VIEWS, dir, `_${name}.html.erb`));
    });
  const html = expand(path.join(VIEWS, view, 'index.html.erb'));
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  for (const s of scripts) {
    if (s.includes('<%')) throw new Error(`${view}: ERB inside a <script> block is not supported by the harness`);
  }
  return scripts;
}

// ─── Fake DOM ────────────────────────────────────────────────────────────────
class FakeClassList {
  constructor(el) { this.el = el; }
  get list() { return this.el.className.split(/\s+/).filter(Boolean); }
  contains(c) { return this.list.includes(c); }
  add(...cs) { this.el.className = [...new Set([...this.list, ...cs])].join(' '); }
  remove(...cs) { this.el.className = this.list.filter(c => !cs.includes(c)).join(' '); }
  toggle(c, force) {
    const on = force ?? !this.contains(c);
    on ? this.add(c) : this.remove(c);
    return on;
  }
}

class FakeElement {
  constructor(id = '', tagName = 'DIV') {
    this.id = id;
    this.tagName = tagName;
    this.className = '';
    this.classList = new FakeClassList(this);
    this.textContent = '';
    this.innerHTML = '';
    this.value = '';
    this.disabled = false;
    this.style = {};
    this.dataset = {};
    this.children = [];
    this.listeners = {};
    this.attributes = {};
  }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  removeEventListener() {}
  dispatch(type, event = {}) { for (const fn of this.listeners[type] ?? []) fn({ preventDefault() {}, target: this, ...event }); }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  closest() { return null; }
  appendChild(child) { this.children.push(child); return child; }
  insertAdjacentHTML(_pos, html) { this.innerHTML += html; }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] ?? null; }
  removeAttribute(k) { delete this.attributes[k]; }
  focus() {}
  blur() {}
  select() {}
  scrollIntoView() {}
}

class FakeDocument {
  constructor() { this.elements = new Map(); this.listeners = {}; }
  getElementById(id) {
    if (!this.elements.has(id)) this.elements.set(id, new FakeElement(id));
    return this.elements.get(id);
  }
  createElement(tag) { return new FakeElement('', tag.toUpperCase()); }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  execCommand() { return true; }
}

// ─── Fake fetch ──────────────────────────────────────────────────────────────
const SHEET_ROUTES = {
  '/ability_parser/sheet_data': null, // every sheet
  '/status_decoder/sheet_data': ['status', 'other', 'extra'],
};

function makeFetch() {
  return async url => {
    const { battleJs, sheets } = snapshot();
    const ok = (body, json) => ({
      ok: true,
      status: 200,
      text: async () => (json ? JSON.stringify(body) : body),
      json: async () => body,
    });
    if (url === '/ability_parser/battle_js') return ok(battleJs, false);
    if (url in SHEET_ROUTES) {
      const names = SHEET_ROUTES[url] ?? Object.keys(sheets);
      return ok(Object.fromEntries(names.filter(n => sheets[n]).map(n => [n, sheets[n]])), true);
    }
    if (String(url).startsWith('https://translate.googleapis.com/')) {
      // Echo the input back so translation is deterministic and offline.
      const q = decodeURIComponent(new URL(url).searchParams.get('q') ?? '');
      return ok([[[q, q]]], true);
    }
    return { ok: false, status: 404, text: async () => '', json: async () => ({ error: 'not found' }) };
  };
}

// ─── Pages ───────────────────────────────────────────────────────────────────
const PAGES = {
  ability_parser: {
    ready: `['battlejs','sheets'].every(k => /\\b(ok|err)\\b/.test(document.getElementById('li-' + k + '-icon').className))`,
  },
  status_decoder: { ready: 'parseReady' },
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Boots a page's scripts against the snapshot and resolves once its data has loaded.
export async function loadPage(view, { timeoutMs = 60000 } = {}) {
  const page = PAGES[view];
  if (!page) throw new Error(`Unknown page: ${view}`);

  const document = new FakeDocument();
  const sandbox = {
    document,
    console,
    fetch: makeFetch(),
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    performance,
    URL, URLSearchParams,
    navigator: { clipboard: { writeText: async () => {} } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    requestAnimationFrame: fn => setTimeout(fn, 0),
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);

  for (const [i, code] of pageScripts(view).entries()) {
    vm.runInContext(code, context, { filename: `${view}/index.html.erb#script${i}` });
  }

  const evalIn = expr => vm.runInContext(expr, context);
  const deadline = Date.now() + timeoutMs;
  while (!evalIn(page.ready)) {
    if (Date.now() > deadline) throw new Error(`${view}: data did not load within ${timeoutMs} ms`);
    await sleep(5);
  }
  return { view, document, context, eval: evalIn };
}

// ─── Golden files ────────────────────────────────────────────────────────────
export const GOLDEN_DIR = path.join(FIXTURES, 'golden');
export const updatingGolden = () => process.env.UPDATE_GOLDEN === '1';

// Returns null when `actual` matches the stored golden file (or the file was
// just written because UPDATE_GOLDEN=1); otherwise a short readable diff.
export function checkGolden(name, actual) {
  const file = path.join(GOLDEN_DIR, name);
  if (updatingGolden() || !fs.existsSync(file)) {
    if (!updatingGolden() && !fs.existsSync(file)) {
      return `Golden file ${name} does not exist. Create it with: $env:UPDATE_GOLDEN='1'; node --test 'test/js/*.test.mjs'`;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, actual);
    return null;
  }
  const expected = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  if (expected === actual) return null;
  return lineDiff(expected, actual, name);
}

function lineDiff(expected, actual, name, maxLines = 40) {
  const a = expected.split('\n');
  const b = actual.split('\n');
  const out = [`${name} differs from golden output (- golden, + now):`];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n && out.length <= maxLines; i++) {
    if (a[i] === b[i]) continue;
    if (a[i] !== undefined) out.push(`- ${i + 1}: ${a[i]}`);
    if (b[i] !== undefined) out.push(`+ ${i + 1}: ${b[i]}`);
  }
  if (out.length > maxLines) out.push('… (more differences)');
  out.push(`If the change is intended, run: $env:UPDATE_GOLDEN='1'; node --test 'test/js/*.test.mjs'`);
  return out.join('\n');
}
