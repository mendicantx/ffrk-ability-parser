// Display names shared by the Ability Parser and the Status Decoder.
// The community sheet is the reference (docs/decisions.md "Naming").

// battle.js SERIES_ID key → the Soul Breaks sheet's Realm column value.
export const REALM_NAMES = {
  FF1: 'I', FF2: 'II', FF3: 'III', FF4: 'IV', FF5: 'V', FF6: 'VI', FF7: 'VII', FF8: 'VIII',
  FF9: 'IX', FF10: 'X', FF11: 'XI', FF12: 'XII', FF13: 'XIII', FF14: 'XIV', FF15: 'XV', FF16: 'XVI',
  FFT: 'FFT', FF_TYPE0: 'Type-0', KH: 'KH', FF_GAIDEN: 'Beyond', JOB: 'Core',
};

// Realm name for a SERIES_ID key (e.g. 'FF7' → 'VII'); unknown keys are returned as-is.
export function realmName(seriesKey) {
  return REALM_NAMES[seriesKey] ?? seriesKey;
}

// battle.js ABILITY_CATEGORY_ID / JOB_ID key → the sheet's school name
// ('BLACK_MAGIC' → 'Black Magic', 'SHOOTER' → 'Sharpshooter').
const SCHOOL_NAMES = { SHOOTER: 'Sharpshooter' };
export function schoolName(key) {
  if (!key) return '';
  return SCHOOL_NAMES[key] ?? String(key).toLowerCase().split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Coded character names that don't title-case to the sheet's name: JP romanisations,
// collapsed multi-word names and compound names. Keys are title-cased coded names
// ('SHERUKU' → 'Sheruku'); the Characters sheet is matched case-insensitively after this.
export const CHAR_CORRECTIONS = {
  // JP romanisations that differ from EN localisation
  'Roza':        'Rosa',
  'Buts':        'Bartz',
  'Mash':        'Sabin',
  'Tina':        'Terra',
  'Frioniel':    'Firion',
  'Lock':        'Locke',
  'Balflear':    'Balthier',
  'Gradiolus':   'Gladiolus',
  'Cain':        'Kain',
  'Artimisia':   'Ultimecia',
  'Stragus':     'Strago',
  'Laan':        'Lann',
  'Serafi':      'Serafie',
  'Sheruku':     'Shelke',
  'Cayenne':     'Cyan',
  'Richard':     'Ricard',
  'Urara':       'Elarra',
  'Gilbert':     'Edward',
  'Arden':       'Ardyn',
  'Yshtola':     "Y'shtola",
  'Vann':        'Vaan',
  'Orlandu':     'Orlandeau',
  // Internal names that collapse multi-word names to one token
  'Drmog':       'Dr. Mog',
  'Dr Mog':      'Dr. Mog',
  'Ennakros':    'Enna Kros',
  'Exnine':      'Ex-Nine',
  // Internal names where the displayed EN name omits or changes parts
  'Yufi':        'Yuffie',
  'Haurchefan':  'Haurchefant',
  'Deshi':       'Tyro',
  'Zezae':       'Xezat',
  'Super Monk':  'Master',
  'Wor':         'Wol',
  // Compound names — CamelCase split produces a space-separated string
  'Shadow Smith':    'Shadowsmith',
  'Paladin Cecil':   'Cecil (Paladin)',
  'Dark Cecil':      'Cecil (Dark Knight)',
  'Red Xiii':        'Red XIII',
  'Cid Garlond':     'Cid (XIV)',
  'Cid Pollendina':  'Cid (IV)',
  'Cid Highwind':    'Cid (VII)',
  'Leo Christophe':  'Leo',
};

// 'BLACK_MAGIC' → 'Black Magic'
export function titleCase(key) {
  return String(key).replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

// battle.js ELEMENT_TYPE key → the sheet's element name ('NON_ELEMENTAL' → 'NE').
const ELEMENT_NAMES = {
  FIRE: 'Fire', ICE: 'Ice', LIGHTNING: 'Lightning', EARTH: 'Earth',
  WIND: 'Wind', WATER: 'Water', HOLY: 'Holy', DARK: 'Dark', POISON: 'Poison',
  NON_ELEMENTAL: 'NE', NOTHING: 'NE', NON: 'NE',
};
export function elementName(key) {
  return ELEMENT_NAMES[key] ?? titleCase(key);
}

// A title-cased coded character name → the sheet's name, given the Characters sheet's
// names keyed by lower case ('Sheruku' → 'Shelke', 'Cloud' → 'Cloud').
export function canonicalCharacterName(name, sheetNames = {}) {
  const corrected = CHAR_CORRECTIONS[name] ?? name;
  return sheetNames[corrected.toLowerCase()] ?? corrected;
}
