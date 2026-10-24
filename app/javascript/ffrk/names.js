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
