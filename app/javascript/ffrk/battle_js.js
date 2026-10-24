// Helpers for reading constants out of the unpacked battle.js text.
// Shared by the Ability Parser, the Status Decoder and the dashboard.
// Keep this module stateless: pages own their data.

// Extract a simple {KEY:num, KEY:num} map from battle.js text.
// Returns { NAME: number } (forward map).
export function extractConstantMap(js, name) {
  // Merge ALL occurrences — STATUS_AILMENTS_TYPE is spread across 13
  // sub-module blocks, each covering a different slice of status IDs.
  const marker = name + ':{';
  const merged = {};
  let searchFrom = 0;
  while (true) {
    const idx = js.indexOf(marker, searchFrom);
    if (idx === -1) break;
    let depth = 0, start = idx + name.length + 1, i = start;
    for (; i < js.length; i++) {
      if (js[i] === '{') depth++;
      else if (js[i] === '}') { depth--; if (depth === 0) break; }
    }
    const block = js.slice(start + 1, i);
    for (const m of block.matchAll(/([A-Z][A-Z0-9_]*):(\d+)/g)) {
      merged[m[1]] = parseInt(m[2]);
    }
    searchFrom = idx + 1;
  }
  return merged;
}

// Invert: {NAME: num} → {num: NAME}
export function invert(map) {
  const inv = {};
  for (const [k, v] of Object.entries(map)) inv[v] = k;
  return inv;
}
