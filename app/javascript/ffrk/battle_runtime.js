// Runs battle.js — the game's own battle code — and returns its data as plain objects,
// so the tools can read the game's real status configs and constant tables instead of
// picking them out of the source text with regexes (docs/decisions.md "Running battle.js").
//
// In the browser it runs in a Web Worker, isolated from the page. runBattleJs has no
// outside references so the Worker can be built from its source text.

const UNDERSCORE_URL = '/vendor/underscore-umd-1.13.7.min.js';

// Executes battle.js's AMD modules with stand-ins for the game framework it expects
// (an FF namespace, underscore, the game's util and ClassBase libraries) and returns:
//   conf:         FF.ns.battle.Conf — the battle constant tables (STATUS_AILMENTS_TYPE, …)
//   statusParams: { [statusId]: { durations, effects, … } } for every status with a config
//   errors:       [ 'module: message' ] for modules that failed to build
// scope is the global object battle.js runs in; evaluate(code) runs a script there.
export function runBattleJs(battleJs, underscoreJs, scope, evaluate) {
  const modules = new Map();

  // Namespace that creates nested plain objects on first read (FF.ns.battle.Conf…).
  const namespace = () => new Proxy({}, {
    get: (t, p) => (typeof p === 'symbol' || p in t ? t[p] : (t[p] = namespace())),
  });
  const cloneDeep = v => (Array.isArray(v) ? v.map(cloneDeep)
    : v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype
      ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cloneDeep(x)])) : v);
  // The game's util module: option() merges defaults like _.extend.
  const util = new Proxy({ option: (d, o) => ({ ...d, ...(o ?? {}) }), cloneDeep, forceArray: v => (Array.isArray(v) ? v : v == null ? [] : [v]) }, {
    get: (t, p) => (p in t || typeof p === 'symbol' ? t[p] : (...a) => a[0]),
  });
  // Backbone-style class helper: ClassBase.extend(protoProps, staticProps) → constructor.
  function ClassBase(...a) { this.initialize?.(...a); }
  ClassBase.extend = function (protoProps = {}, staticProps = {}) {
    const parent = this;
    const child = Object.prototype.hasOwnProperty.call(protoProps, 'constructor')
      ? protoProps.constructor : function (...a) { return parent.apply(this, a); };
    Object.assign(child, parent, staticProps);
    child.prototype = Object.assign(Object.create(parent.prototype), protoProps);
    child.prototype.constructor = child;
    return child;
  };
  const LIBS = { util, 'lib/ClassBase': ClassBase };

  scope.FF = namespace();
  scope.sprintf = f => f;
  scope.window = scope;
  scope.define = (name, deps, factory) => {
    if (typeof deps === 'function') { factory = deps; deps = []; }
    modules.set(name, { deps, factory, state: 'defined' });
  };
  scope.define.amd = {};
  scope.require = () => {}; // battle.js ends by require()-ing the game's boot module; not needed here

  evaluate(underscoreJs); // registers define('underscore')
  evaluate(battleJs);

  const absolute = (name, from) => {
    if (!name.startsWith('.')) return name;
    const parts = from.split('/').slice(0, -1);
    for (const seg of name.split('/')) { if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg); }
    return parts.join('/');
  };
  const resolve = name => {
    if (name in LIBS) return LIBS[name];
    const m = modules.get(name);
    if (!m) return {};
    if (m.state !== 'defined') return m.value;
    m.state = 'building';
    try { m.value = m.factory(...m.deps.map(d => resolve(absolute(d, name)))); } catch (e) { m.error = e.message; }
    m.state = 'built';
    return m.value;
  };
  scope._ = resolve('underscore');

  // Modules read FF.ns.battle.Conf at build time without declaring it, so build the
  // Conf modules first, as the game's own loading order does.
  for (const name of modules.keys()) if (name.endsWith('/Conf') || name === 'scenes/battle/Config') resolve(name);
  resolve('scenes/battle/StatusAilmentsConfig');

  const battle = scope.FF.ns.battle;
  const plain = v => JSON.parse(JSON.stringify(v ?? null));
  const statusConfig = battle.StatusAilmentsConfig;
  const statusParams = {};
  for (const id of Object.values(battle.Conf.STATUS_AILMENTS_TYPE ?? {})) {
    try { if (statusConfig.hasParamV2(id)) statusParams[id] = plain(statusConfig.getParam(id)); } catch { /* no config */ }
  }
  const errors = [...modules].filter(([, m]) => m.error).map(([n, m]) => `${n}: ${m.error}`);
  return { conf: plain(battle.Conf), statusParams, errors };
}

// Runs battle.js in a Web Worker and resolves to runBattleJs's result. Where Workers
// don't exist (the Node tests), globalThis.runBattleJsInline does the same in-process.
export async function startBattleRuntime(battleJs) {
  const underscoreJs = await (await fetch(UNDERSCORE_URL)).text();
  if (typeof Worker === 'undefined') return globalThis.runBattleJsInline(battleJs, underscoreJs);

  const source = `const runBattleJs = ${runBattleJs.toString()};
onmessage = e => {
  try { postMessage({ ok: true, result: runBattleJs(e.data.battleJs, e.data.underscoreJs, self, code => (0, eval)(code)) }); }
  catch (err) { postMessage({ ok: false, error: String(err && err.message || err) }); }
};`;
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  const worker = new Worker(url);
  try {
    return await new Promise((resolve, reject) => {
      worker.onmessage = e => (e.data.ok ? resolve(e.data.result) : reject(new Error(e.data.error)));
      worker.onerror = e => reject(new Error(e.message || 'battle.js worker failed'));
      worker.postMessage({ battleJs, underscoreJs });
    });
  } finally {
    worker.terminate();
    URL.revokeObjectURL(url);
  }
}
