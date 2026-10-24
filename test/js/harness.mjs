// Runs the Ability Parser and Status Decoder pages in Node against the frozen
// data snapshot in test/fixtures/snapshot.
//
// The page modules (app/javascript/pages) are imported as real ES modules: a
// resolve hook maps the importmap specifiers (ffrk/*, pages/*) to files, a
// minimal fake DOM and a fake fetch() that serves the snapshot are installed as
// globals, and classic inline scripts (the shared constants partial) run in the
// global scope first, as in a browser. Each loadPage() imports a fresh instance
// of the page module; page.eval('expr') evaluates an expression against the
// page module's exports (DB, decodeStatus, processBattleJson, ...).

import fs from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
export const JS_DIR = path.join(ROOT, 'app/javascript');
const JS_DIR_URL = pathToFileURL(JS_DIR).href;

// Mirrors config/importmap.rb: `ffrk/x` and `pages/x` are app/javascript/<dir>/x.js,
// and everything under app/javascript is an ES module.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const m = /^(ffrk|pages)\/([\w/]+)$/.exec(specifier);
    if (m) return { url: pathToFileURL(path.join(JS_DIR, m[1], `${m[2]}.js`)).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    return url.startsWith(JS_DIR_URL) ? { ...result, format: 'module' } : result;
  },
});

// Expands `<%= render 'shared/x' %>` and drops ERB comments, then returns the
// page's scripts in the order a browser runs them: inline classic <script>
// blocks first, then modules from `javascript_import_module_tag` (deferred).
// Each entry is { code, file, module }.
export function pageScripts(view) {
  const expand = file => fs.readFileSync(file, 'utf8')
    .replace(/<%#[\s\S]*?%>/g, '')
    .replace(/<%=\s*render\s+['"]([\w/]+)['"]\s*%>/g, (_, partial) => {
      const [dir, name] = partial.split('/');
      return expand(path.join(VIEWS, dir, `_${name}.html.erb`));
    });
  const html = expand(path.join(VIEWS, view, 'index.html.erb'));

  const classic = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m, i) => {
    if (m[1].includes('<%')) throw new Error(`${view}: ERB inside a <script> block is not supported by the harness`);
    return { code: m[1], file: `${view}/index.html.erb#script${i}`, module: false };
  });
  const modules = [...html.matchAll(/<%=\s*javascript_import_module_tag\s+["']([\w/]+)["']\s*%>/g)].map(m => {
    const file = path.join(JS_DIR, `${m[1]}.js`);
    return { code: fs.readFileSync(file, 'utf8'), file: path.relative(ROOT, file), module: true };
  });
  return [...classic, ...modules];
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
// Mirrors config/routes.rb: path → default sheet names (null = every sheet).
const SHEET_ROUTES = {
  '/data/sheets': null,
  '/ability_parser/sheet_data': null,
  '/status_decoder/sheet_data': ['status', 'other', 'extra'],
};
const BATTLE_JS_ROUTES = ['/data/battle_js', '/ability_parser/battle_js'];

// battleJsOverride replaces the snapshot's battle.js (e.g. a simulated repack).
function makeFetch(battleJsOverride) {
  return async url => {
    const { sheets } = snapshot();
    const battleJs = battleJsOverride ?? snapshot().battleJs;
    const ok = (body, json) => ({
      ok: true,
      status: 200,
      text: async () => (json ? JSON.stringify(body) : body),
      json: async () => body,
    });
    const { pathname, searchParams } = new URL(url, 'http://localhost');
    if (BATTLE_JS_ROUTES.includes(pathname)) return ok(battleJs, false);
    if (pathname in SHEET_ROUTES) {
      const names = searchParams.get('names')?.split(',') ?? SHEET_ROUTES[pathname] ?? Object.keys(sheets);
      const body = Object.fromEntries(names.filter(n => sheets[n]).map(n => [n, sheets[n]]));
      body.last_refreshed_at = '2026-01-01T00:00:00Z';
      return ok(body, true);
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
// Browser globals the pages use, installed on globalThis for each page load.
function installGlobals(globals) {
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
}

let pageInstance = 0;

// Boots a page against the snapshot and resolves once its data has loaded.
// Load one page at a time: the globals belong to the most recently loaded page.
export async function loadPage(view, { timeoutMs = 60000, battleJs } = {}) {
  const page = PAGES[view];
  if (!page) throw new Error(`Unknown page: ${view}`);

  const document = new FakeDocument();
  installGlobals({
    document,
    window: globalThis,
    fetch: makeFetch(battleJs),
    navigator: { clipboard: { writeText: async () => {} } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { reload() {} },
    requestAnimationFrame: fn => setTimeout(fn, 0),
  });

  let exports = {};
  for (const { code, file, module } of pageScripts(view)) {
    if (module) {
      // A fresh module instance per load; shared ffrk/* modules are stateless.
      exports = await import(`${pathToFileURL(path.join(ROOT, file)).href}?instance=${++pageInstance}`);
    } else {
      vm.runInThisContext(code, { filename: file });
    }
  }

  const evalIn = expr => new Function(...Object.keys(exports), `return (${expr});`)(...Object.values(exports));
  const deadline = Date.now() + timeoutMs;
  while (!evalIn(page.ready)) {
    if (Date.now() > deadline) throw new Error(`${view}: data did not load within ${timeoutMs} ms`);
    await sleep(5);
  }
  return { view, document, exports, eval: evalIn };
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
