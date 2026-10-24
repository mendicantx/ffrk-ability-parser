// "<ability missing from Other Tab>" links to finding that ability: its Other-tab row when
// the paste has it, or else the Ability Parser, which asks for the soul break's JSON.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadPage, FIXTURES } from './harness.mjs';

const fixture = name => fs.readFileSync(path.join(FIXTURES, 'battles', name), 'utf8');
const { linkMissingAbilities } = await import('ffrk/status_context');

test('one missing ability links the placeholder; several are listed after the text', () => {
  const attrs = id => `href="/x/${id}"`;
  const text = 'casts &lt;ability missing from Other Tab&gt; after using Fire abilities';
  assert.match(linkMissingAbilities(text, [111], attrs), /casts <a class="missing-ability-link" href="\/x\/111"[^>]*>&lt;ability missing from Other Tab&gt;<\/a> after/);
  const two = linkMissingAbilities(text, [111, 222], attrs);
  assert.ok(two.startsWith(text), 'the text itself is unchanged');
  assert.match(two, /Missing from the Other tab: <a [^>]*href="\/x\/111"[^>]*>111<\/a>, <a [^>]*href="\/x\/222"[^>]*>222<\/a>/);
  assert.equal(linkMissingAbilities('no placeholder', [111], attrs), 'no placeholder');
  assert.equal(linkMissingAbilities(text, [], attrs), text);
});

test('the Status Decoder links a missing ability to the Ability Parser in a new tab', async () => {
  const page = await loadPage('status_decoder');
  // A status the Status tab doesn't have, whose description casts one missing ability.
  const found = page.eval(`Object.keys(DB.statusAilmentsForward).map(decodeStatus)
    .find(d => d.missingAbilities?.length === 1 && !DB.statusMap[d.id]?.effects)`);
  assert.ok(found, 'expected a status off the Status tab with a missing ability');
  page.document.getElementById('status-input').value = found.codedName;
  page.document.getElementById('decode-btn').dispatch('click');
  const html = page.document.getElementById('output').innerHTML;
  const href = `/ability_parser?ability=${found.missingAbilities[0]}&status=${found.id}`;
  assert.ok(html.includes(`<a class="missing-ability-link" href="${href}" target="_blank" rel="noopener"`), html.slice(0, 800));
});

test("the parser's missing-status list jumps to the ability's Other-tab row when the paste has it", async () => {
  const page = await loadPage('ability_parser');
  page.eval(`processBattleJson(${JSON.stringify(fixture('trey-dasb.txt'))})`);
  const html = page.document.getElementById('results').innerHTML;
  assert.match(html, /id="fup-tsv-31543742"/);
  assert.match(html, /<a class="missing-ability-link" href="#fup-tsv-31543742" data-jump-to="fup-tsv-31543742"/);
});

test('opened to find an ability, the parser asks for the soul break, then points at the row', async () => {
  const page = await loadPage('ability_parser', { search: '?ability=31543742&status=50344009' });
  const banner = page.document.getElementById('find-ability');
  assert.equal(banner.hidden, false);
  assert.match(banner.innerHTML, /Looking for ability <b>31543742<\/b>.*Paste the JSON of the soul break/);

  page.eval(`processBattleJson(${JSON.stringify(fixture('trey-dasb.txt'))})`);
  assert.match(banner.innerHTML, /status 50344009 \(DUAL_AWAKE_MODE_FIRST_TREY_SHOOTER_II\)/);
  assert.match(banner.innerHTML, /It's in this paste: <a href="#fup-tsv-31543742" data-jump-to="fup-tsv-31543742">/);

  page.eval(`processBattleJson(${JSON.stringify(fixture('rain-zsb.txt'))})`);
  assert.match(banner.innerHTML, /It isn't in this paste/);
});

test('without ?ability= the find-ability banner stays hidden', async () => {
  const page = await loadPage('ability_parser', { gameData: false });
  page.eval(`processBattleJson(${JSON.stringify(fixture('rain-zsb.txt'))})`);
  assert.equal(page.document.getElementById('find-ability').innerHTML, '');
});
