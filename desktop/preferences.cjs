const { readFileSync, writeFileSync, renameSync, mkdirSync } = require('node:fs');
const { dirname } = require('node:path');

// Permission records are local consent, not authentication or automatic mic activation.
module.exports.createPreferences = file => {
  let saved = {};
  try { saved = JSON.parse(readFileSync(file, 'utf8')); } catch {}
  const persist = () => { mkdirSync(dirname(file), { recursive: true }); const tmp = file + '.tmp'; writeFileSync(tmp, JSON.stringify(saved), { mode: 0o600 }); renameSync(tmp, file); };
  const validOrigin = origin => /^http:\/\/127\.0\.0\.1:(4317|4327)$/.test(origin);
  return {
    mode: () => saved.mode === 'orb' ? 'orb' : 'island',
    codingEnabled: () => saved.codingEnabled !== false,
    setCodingEnabled(value) { if (typeof value !== 'boolean') throw new Error('Invalid coding preference.'); saved.codingEnabled = value; persist(); },
    setMode(mode) { if (!['orb', 'island'].includes(mode)) throw new Error('Unknown assistant style.'); saved.mode = mode; persist(); },
    allowed(kind, origin) { return ['wake', 'microphone'].includes(kind) && validOrigin(origin) && saved.permissions?.[origin]?.[kind] === true; },
    allow(kind, origin) { if (!['wake', 'microphone'].includes(kind) || !validOrigin(origin)) throw new Error('Unknown microphone permission.'); saved.permissions ||= {}; saved.permissions[origin] ||= {}; saved.permissions[origin][kind] = true; persist(); },
    forget() { saved.permissions = {}; persist(); },
  };
};
