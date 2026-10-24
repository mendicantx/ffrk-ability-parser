// Status Decoder page script, loaded as an ES module by
// app/views/status_decoder/index.html.erb via javascript_import_module_tag.

import { refreshServerData, splitSheetsResponse } from 'ffrk/server_data';
import { createStatusDecoder, collectSourceDefs } from 'ffrk/status_decoder';
import { startBattleRuntime } from 'ffrk/battle_runtime';

// ─── Decoder (ffrk/status_decoder) ───────────────────────────────────────────
const decoder = createStatusDecoder();
const DB = decoder.DB;
const { decodeStatus } = decoder;

// ─── Load state helpers ──────────────────────────────────────────────────────
let battleJsReady = false;
let sheetsReady   = false;
let parseReady    = false;

function setLoadState(key, state, detail) {
  const icon = document.getElementById(`li-${key}-icon`);
  const det  = document.getElementById(`li-${key}-detail`);
  if (icon) { icon.className = `load-icon ${state}`; icon.textContent = state === 'ok' ? '✓' : state === 'err' ? '✗' : state === 'loading' ? '…' : '○'; }
  if (det)  det.textContent = detail ?? '';
}

function checkAllLoaded() {
  if (battleJsReady && sheetsReady) {
    setLoadState('parse', 'loading', 'parsing status assignments…');
    setTimeout(() => {
      try {
        const t0 = performance.now();
        decoder.buildStatusAssignments();
        const ms = Math.round(performance.now() - t0);
        setLoadState('parse', 'ok', `${Object.keys(DB.statusAssignments).length} assignments in ${ms}ms`);
      } catch(e) {
        setLoadState('parse', 'err', e.message);
      }
      parseReady = true;
      enableSearch();
    }, 10); // yield to browser before heavy parse
  }
}

function enableSearch() {
  document.getElementById('status-input').disabled = false;
  document.getElementById('decode-btn').disabled   = false;
  document.getElementById('status-input').focus();
}

// ─── battle.js stored raw ────────────────────────────────────────────────────
let _rawBattleJs = '';

async function loadBattleJs() {
  setLoadState('battlejs', 'loading', 'fetching…');
  try {
    const resp = await fetch('/data/battle_js');
    if (!resp.ok) throw new Error(resp.status === 503 ? 'no cached data — run rake data:refresh' : `HTTP ${resp.status}`);
    _rawBattleJs = await resp.text();
    setLoadState('battlejs', 'loading', 'extracting constants…');
    decoder.ingestBattleJs(_rawBattleJs);

    const statCount = Object.keys(DB.statusAilmentsForward).length;
    setLoadState('battlejs', 'ok', `${statCount} statuses, ${Object.keys(DB.abilityIdOf).length} abilities`);
    battleJsReady = true;
    loadGameData();
  } catch(e) {
    setLoadState('battlejs', 'err', e.message);
  }
  checkAllLoaded();
}

// ─── Game data: battle.js run in a Web Worker ──────────────────────────────────
// Gives every status's real config (effects, durations, values) as the game defines it.
async function loadGameData() {
  setLoadState('game', 'loading', 'running battle.js…');
  try {
    const t0 = performance.now();
    const { conf, statusParams, errors } = await startBattleRuntime(_rawBattleJs);
    DB.game = { conf, statusParams };
    const ms = Math.round(performance.now() - t0);
    const note = errors.length ? ` · ${errors.length} module errors` : '';
    setLoadState('game', errors.length ? 'err' : 'ok', `${Object.keys(statusParams).length} status configs in ${ms}ms${note}`);
  } catch (e) {
    setLoadState('game', 'err', e.message);
  }
}

// Game names for a status config's numeric enums, from battle.js's Conf tables.
const GAME_ENUMS = {
  effects:   'STATUS_AILMENTS_PARAM_EFFECT_TYPE',
  durations: 'STATUS_AILMENTS_PARAM_DURATION_TYPE',
};

// A status config as readable text: one line per effect and duration, with enum
// names (effect/duration types, elements, statuses) spelled out.
function formatGameParams(params) {
  const conf = DB.game.conf;
  const nameOf = (table, value) => Object.keys(conf[table] ?? {}).find(k => conf[table][k] === value);
  const show = (key, value) => {
    if (key === 'anyElementIds' || key === 'elementId') {
      return [].concat(value).map(v => nameOf('ELEMENT_TYPE', v) ?? v).join(', ');
    }
    if (key === 'saId' || key === 'saIds') return [].concat(value).map(v => DB.statusById[v] ?? v).join(', ');
    return typeof value === 'object' ? JSON.stringify(value, (k, v) => (k === 'anyElementIds' ? v.map(id => nameOf('ELEMENT_TYPE', id) ?? id) : v)) : String(value);
  };
  const lines = [];
  for (const [part, table] of Object.entries(GAME_ENUMS)) {
    for (const entry of params[part] ?? []) {
      const fields = Object.entries(entry).filter(([k]) => k !== 'key' && k !== 'type')
        .map(([k, v]) => `${k}: ${show(k, v)}`);
      lines.push(`${part === 'effects' ? 'Effect' : 'Duration'} ${entry.key}: ${nameOf(table, entry.type) ?? entry.type}${fields.length ? `\n    ${fields.join('\n    ')}` : ''}`);
    }
  }
  const flags = Object.entries(params).filter(([k]) => !(k in GAME_ENUMS)).map(([k, v]) => `${k}: ${show(k, v)}`);
  if (flags.length) lines.unshift(flags.join(', '));
  return lines.join('\n');
}

// ─── Sheet data (served from the server's cache; see Refresh data) ───────────
async function loadSheets() {
  setLoadState('sheets', 'loading', 'fetching…');
  try {
    const resp = await fetch('/data/sheets?names=status,other,extra,characters');
    const raw = await resp.json();
    if (raw.error) throw new Error(raw.error);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const { sheets: data, lastRefreshedAt } = splitSheetsResponse(raw);
    decoder.ingestSheets(data);

    const refreshed = lastRefreshedAt ? ` · refreshed ${new Date(lastRefreshedAt).toLocaleString()}` : '';
    setLoadState('sheets', 'ok', `${Object.keys(DB.statusMap).length} status rows${refreshed}`);
    sheetsReady = true;
  } catch(e) {
    setLoadState('sheets', 'err', e.message);
  }
  checkAllLoaded();
}

// ─── JS prettifier ───────────────────────────────────────────────────────────
// Simple formatter for minified battle.js snippets.
function prettyJs(src) {
  const TAB = '    ';
  let out = '';
  let depth = 0;
  let i = 0;
  const stack = []; // tracks '{', '[', '('

  function trimEnd() { out = out.replace(/[ \t]+$/, ''); }
  function nl()      { trimEnd(); out += '\n' + TAB.repeat(depth); }
  function skipWs()  { while (i < src.length && ' \t\n\r'.includes(src[i])) i++; }

  while (i < src.length) {
    const ch = src[i];

    // String literals
    if (ch === '"' || ch === "'") {
      const q = ch; out += q; i++;
      while (i < src.length) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
        if (src[i] === q)    { out += q; i++; break; }
        out += src[i++];
      }
      continue;
    }

    if (ch === '{') {
      if (out.length && !' \n('.includes(out[out.length - 1])) out += ' ';
      out += '{'; stack.push('{'); depth++; i++; skipWs();
      if (i < src.length && src[i] !== '}') nl();
      continue;
    }
    if (ch === '}') {
      stack.pop(); depth = Math.max(0, depth - 1); nl(); out += '}'; i++;
      continue;
    }
    if (ch === '[') { stack.push('['); out += '['; i++; continue; }
    if (ch === ']') { stack.pop();    out += ']'; i++; continue; }
    if (ch === '(') { stack.push('('); out += '('; i++; continue; }
    if (ch === ')') { stack.pop();    out += ')'; i++; continue; }

    if (ch === ';') { out += ';'; i++; skipWs(); nl(); continue; }

    if (ch === ',') {
      out += ','; i++; skipWs();
      if (stack[stack.length - 1] === '{') nl();
      else out += ' ';
      continue;
    }

    if (ch === ':' && stack[stack.length - 1] === '{') {
      out += ': '; i++; skipWs(); continue;
    }

    // Pad = assignment (not ==, !=, <=, >=)
    if (ch === '=' && src[i + 1] !== '=' && !'!<>'.includes(src[i - 1] ?? '')) {
      out += ' = '; i++; skipWs(); continue;
    }

    // Whitespace normalisation
    if (' \t\n\r'.includes(ch)) {
      const last = out[out.length - 1] ?? '';
      if (last !== ' ' && last !== '\n') out += ' ';
      i++; continue;
    }

    out += ch; i++;
  }
  return out.trim();
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderResult(result) {
  if (result.error) {
    document.getElementById('output').innerHTML = `<div class="err-box">${escHtml(result.error)}</div>`;
    return;
  }
  if (result.warning) {
    // Show warning inline but continue rendering the card
    let warnHtml = `<div class="err-box" style="margin-bottom:8px;">${escHtml(result.warning)}</div>`;
    document.getElementById('output').innerHTML = warnHtml;
  } else {
    document.getElementById('output').innerHTML = '';
  }

  const sheetRow = DB.statusMap[result.id];

  // The Status tab's row comes first (owner decision); the decoder fills only the cells
  // the tab doesn't have yet.
  const fromSheet = v => (v && v !== '-' && v !== '?' ? v : null);
  const displayName     = fromSheet(sheetRow?.commonName) ?? result.commonName      ?? '—';
  const displayEffects  = fromSheet(sheetRow?.effects)    ?? result.effects         ?? '—';
  const displayDuration = fromSheet(sheetRow?.duration)   ?? result.defaultDuration ?? '—';
  const onSheet = !!fromSheet(sheetRow?.commonName);

  let html = `<div class="status-card">`;
  html += `<div class="status-card-title">${escHtml(result.codedName)}</div>`;
  html += `<div class="status-source">${onSheet ? 'From the Status tab' : 'Not on the Status tab: generated by the decoder'}</div>`;

  html += `<table class="sheet-row-table">`;
  html += `<tr><th>ID</th><td class="col-id">${result.id}</td></tr>`;
  html += `<tr><th>Common Name</th><td class="col-name">${escHtml(displayName)}</td></tr>`;
  html += `<tr><th>Effects</th><td class="col-effects">${escHtml(displayEffects)}</td></tr>`;
  html += `<tr><th>Default Duration</th><td class="col-duration">${escHtml(displayDuration)}</td></tr>`;
  html += `<tr><th>MND Modifier</th><td class="col-dash">${result.mndModifier}</td></tr>`;
  html += `<tr><th>Exclusive Status</th><td class="col-dash">${result.exclusiveStatus}</td></tr>`;
  html += `<tr><th>Coded Name</th><td class="col-coded">${escHtml(result.codedName)}</td></tr>`;
  html += `<tr><th>Notes</th><td class="col-dash">${escHtml(result.notes) || '—'}</td></tr>`;
  html += `</table>`;

  // TSV copy row (tab-separated in sheet column order: ID, Common Name, Effects, Duration, MND, Exclusive, Coded Name, Notes)
  const tsvCols = [
    result.id,
    displayName,
    displayEffects,
    displayDuration,
    result.mndModifier,
    result.exclusiveStatus,
    result.codedName,
    result.notes,
  ];
  const tsv = tsvCols.join('\t');

  html += `<div class="copy-row">`;
  html += `<button class="copy-btn">Copy row (TSV)</button>`;
  html += `<textarea class="tsv-area" readonly id="tsv-out">${escHtml(tsv)}</textarea>`;
  html += `</div>`;

  // When the tab has the status, show the decoder's own text too if it reads differently.
  const generated = [['Common Name', result.commonName, displayName], ['Effects', result.effects, displayEffects], ['Default Duration', result.defaultDuration, displayDuration]]
    .filter(([, mine, shown]) => onSheet && mine && mine !== shown);
  if (generated.length) {
    html += `<table class="sheet-row-table generated-table"><caption>Generated by the decoder</caption>`;
    for (const [col, mine] of generated) html += `<tr><th>${col}</th><td>${escHtml(mine)}</td></tr>`;
    html += `</table>`;
  }

  // Decoder note
  if (!result.decoded) {
    html += `<div class="decoder-unknown">`;
    html += `Decoder not yet implemented for function <strong>${escHtml(result.funcName)}</strong> in <em>${escHtml(result.defineModule ?? '?')}</em>.<br>`;
    html += `Raw call: <span class="raw-func">${escHtml(result.funcName)}</span>(<span class="raw-args">${escHtml(result.argsText ?? '')}</span>)`;
    html += `</div>`;
  } else {
    html += `<div class="decoder-note">Decoded via <strong>${escHtml(result.funcName)}</strong>()</div>`;
  }

  // Source code expandable
  if (result._block != null && result._funcName != null) {
    const defs = collectSourceDefs(result._funcName, result._block);
    const assignVar = result._statusKey ?? '?';
    const rawCall   = `${result._funcName}(${result._argsText ?? ''})`;
    let srcText = `// Assignment\n${assignVar} = ${rawCall}`;
    if (defs.length > 0) {
      srcText += '\n\n// Function definition(s)\n';
      srcText += defs.map(d => prettyJs(d.def)).join('\n\n');
    }
    html += `<div class="raw-section"><details>`;
    html += `<summary>Source code</summary>`;
    html += `<div class="raw-block">${escHtml(srcText)}</div>`;
    html += `</details></div>`;
  }

  // The game's own config for this status (battle.js run in a Worker)
  const gameParams = DB.game?.statusParams[result.id];
  html += `<div class="raw-section"><details${result.decoded ? '' : ' open'}>`;
  html += `<summary>Game data (battle.js)</summary>`;
  html += `<div class="raw-block">${escHtml(!DB.game ? 'Still running battle.js…' : gameParams ? formatGameParams(gameParams) : 'No config for this status in battle.js.')}</div>`;
  html += `</details></div>`;

  // Sheet row (if exists)
  if (sheetRow) {
    html += `<div class="raw-section"><details>`;
    html += `<summary>Existing sheet row</summary>`;
    html += `<div class="raw-block">Common Name: ${escHtml(sheetRow.commonName)}\nEffects: ${escHtml(sheetRow.effects)}\nDuration: ${escHtml(sheetRow.duration)}</div>`;
    html += `</details></div>`;
  }

  html += `</div>`;
  document.getElementById('output').innerHTML += html;
}

function copyTsv(btn) {
  const area = document.getElementById('tsv-out');
  if (!area) return;
  navigator.clipboard.writeText(area.value).then(() => {
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = orig, 1500);
  });
}

function escHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Search & autocomplete ────────────────────────────────────────────────────
const input = document.getElementById('status-input');
const acBox  = document.getElementById('autocomplete');
let acItems  = [];
let acIndex  = -1;

function runDecode() {
  const raw = input.value.trim();
  if (!raw) return;

  let statusKey = null;

  // Try as numeric ID
  const asNum = parseInt(raw);
  if (!isNaN(asNum) && String(asNum) === raw) {
    statusKey = DB.statusById[asNum];
    if (!statusKey) {
      document.getElementById('output').innerHTML = `<div class="err-box">No status found with ID ${asNum}</div>`;
      return;
    }
  } else {
    statusKey = raw.toUpperCase().replace(/\s+/g, '_');
    if (!DB.statusAilmentsForward[statusKey]) {
      document.getElementById('output').innerHTML = `<div class="err-box">Status key not found: ${escHtml(statusKey)}</div>`;
      return;
    }
  }

  closeAc();
  renderResult(decodeStatus(statusKey));
}

function showAc(query) {
  if (!query || query.length < 2) { closeAc(); return; }
  const q = query.toUpperCase().replace(/\s+/g, '_');
  const allKeys = Object.keys(DB.statusAilmentsForward);
  const matches = allKeys.filter(k => k.includes(q)).slice(0, 20);

  if (!matches.length) { closeAc(); return; }

  acItems = matches;
  acIndex = -1;
  acBox.innerHTML = matches.map((k, i) =>
    `<div class="ac-item" data-key="${escHtml(k)}" data-idx="${i}">
      ${escHtml(k)}<span class="ac-id">${DB.statusAilmentsForward[k]}</span>
    </div>`
  ).join('');
  acBox.style.display = 'block';

  for (const item of acBox.querySelectorAll('.ac-item')) {
    item.addEventListener('mousedown', e => {
      e.preventDefault();
      input.value = item.dataset.key;
      closeAc();
      runDecode();
    });
  }
}

function closeAc() {
  acBox.style.display = 'none';
  acBox.innerHTML = '';
  acItems = [];
  acIndex = -1;
}

function setAcIndex(idx) {
  const items = acBox.querySelectorAll('.ac-item');
  items.forEach(el => el.classList.remove('ac-selected'));
  if (idx >= 0 && idx < items.length) {
    items[idx].classList.add('ac-selected');
    acIndex = idx;
  }
}

input.addEventListener('input', () => showAc(input.value));
input.addEventListener('blur',  () => setTimeout(closeAc, 150));
input.addEventListener('keydown', e => {
  if (e.key === 'Enter') { runDecode(); closeAc(); return; }
  if (e.key === 'Escape') { closeAc(); return; }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    const next = Math.min(acIndex + 1, acItems.length - 1);
    setAcIndex(next);
    if (acItems[next]) input.value = acItems[next];
    return;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    const prev = Math.max(acIndex - 1, 0);
    setAcIndex(prev);
    if (acItems[prev]) input.value = acItems[prev];
  }
});

document.getElementById('decode-btn').addEventListener('click', runDecode);

// Copy buttons are rendered into #output, so listen there (module functions
// aren't reachable from inline onclick attributes).
document.getElementById('output').addEventListener('click', e => {
  const btn = e.target.closest?.('.copy-btn');
  if (btn) copyTsv(btn);
});

// Asks the server to re-fetch the sheets and battle.js (rate-limited server-side),
// then reloads the page so every derived map is rebuilt from the new data.
// "Reload Status & Other tabs" does the same for just those two sheets, after rows
// have been added to them.
async function refreshAndReload(btn, sheets) {
  const detail = document.getElementById('refresh-detail');
  btn.disabled = true;
  detail.textContent = sheets ? 'reloading the Status and Other tabs on the server…' : 'refreshing on the server…';
  const error = await refreshServerData(sheets);
  if (!error) { location.reload(); return; }
  detail.textContent = error;
  btn.disabled = false;
}
document.getElementById('refresh-btn').addEventListener('click', () => refreshAndReload(document.getElementById('refresh-btn')));
document.getElementById('reload-statuses-btn').addEventListener('click', () => refreshAndReload(document.getElementById('reload-statuses-btn'), ['status', 'other']));

// ─── Boot ─────────────────────────────────────────────────────────────────────
Promise.all([loadBattleJs(), loadSheets()]);

// Exposed for the Node tests (test/js); the page itself doesn't import anything from here.
export { DB, decodeStatus, parseReady, formatGameParams };
