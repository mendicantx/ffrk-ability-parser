// Measures how closely the Ability Parser's sheet-preview rows match the
// community sheet, for every captured ability that already has a sheet row.
// The sheet is the reference (docs/decisions.md "Sheet conventions"), so the
// match counts may only go up: raise FLOORS when a change improves them.
//
// Only generated cells are scored; cells the preview copies from the sheet
// itself (marked sbp-sheet) would match trivially.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadPage, snapshot, FIXTURES } from './harness.mjs';

// Preview id prefix → sheet tab it previews.
const TABS = { sbp: 'soul_breaks', ekp: 'extra', fup: 'other' };

// Matching generated cells, as of the last improvement.
const FLOOR_TOTAL = 111;

const decode = s => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const norm = v => String(v ?? '').replace(/\s+/g, ' ').trim();

// Each preview: its id, the TSV fields, and the column names with a flag for sheet-sourced cells.
export function previews(html) {
  const out = [];
  const re = /<textarea class="sbp-tsv-area" id="([a-z]+)-tsv-(\d+)"[^>]*>([\s\S]*?)<\/textarea>[\s\S]*?<table class="sb-preview-table">([\s\S]*?)<\/table>/g;
  for (const [, prefix, id, tsv, table] of html.matchAll(re)) {
    const cols = [...table.matchAll(/<td class="sbp-col">([\s\S]*?)<\/td>\s*<td([^>]*)>/g)]
      .map(m => ({ name: decode(m[1]).trim(), fromSheet: /sbp-sheet/.test(m[2]) }));
    out.push({ prefix, id, fields: decode(tsv).split('\t'), cols });
  }
  return out;
}

test('generated sheet-preview cells match the sheet at least as often as before', async t => {
  const sheets = snapshot().sheets;
  const byId = Object.fromEntries(Object.entries(TABS).map(([p, tab]) => [p, new Map(sheets[tab].map(r => [String(r.ID), r]))]));
  const files = fs.readdirSync(path.join(FIXTURES, 'battles')).filter(f => /\.(json|txt)$/.test(f)).sort();

  const perColumn = {};
  let total = 0, matched = 0;
  for (const file of files) {
    const page = await loadPage('ability_parser');
    page.eval(`processBattleJson(${JSON.stringify(fs.readFileSync(path.join(FIXTURES, 'battles', file), 'utf8'))})`);
    for (const p of previews(page.document.getElementById('results').innerHTML)) {
      const row = byId[p.prefix]?.get(p.id);
      if (!row) continue;
      assert.equal(p.fields.length, p.cols.length, `${file} ${p.prefix}-${p.id}: TSV has ${p.fields.length} fields, table ${p.cols.length} columns`);
      p.cols.forEach((col, i) => {
        // Skip copied cells, the image formula, and sheet cells nobody has filled in yet.
        if (col.fromSheet || col.name === 'Img' || ['', '?', '-'].includes(norm(row[col.name])) && norm(row[col.name]) !== norm(p.fields[i])) return;
        const ok = norm(p.fields[i]) === norm(row[col.name]);
        const c = (perColumn[`${p.prefix} ${col.name}`] ??= { matched: 0, total: 0, misses: [] });
        c.total++; total++;
        if (ok) { c.matched++; matched++; } else c.misses.push(`${file}#${p.id}: "${norm(p.fields[i]).slice(0, 60)}" vs sheet "${norm(row[col.name]).slice(0, 60)}"`);
      });
    }
  }
  for (const [col, c] of Object.entries(perColumn).sort()) {
    t.diagnostic(`${col}: ${c.matched}/${c.total}${c.misses.length ? `  — ${c.misses.join(' | ')}` : ''}`);
  }
  t.diagnostic(`total: ${matched}/${total} generated cells match the sheet`);
  assert.ok(matched >= FLOOR_TOTAL, `matches fell to ${matched} (floor ${FLOOR_TOTAL})`);
});
