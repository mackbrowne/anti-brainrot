// Variants are separately installable copies of the app (own app ID, name,
// icon and login). variants.json holds the public ones; local/variants.json is
// git-ignored and adds personal ones (or overrides public ones by id).
//
// Shared by app.config.ts, scripts/build-android.sh and the release workflow.
//   node scripts/variants.js ids        # space-separated ids (all files)
//   node scripts/variants.js json-ids   # JSON array of ids (for CI matrices)

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUBLIC_FILE = 'variants.json';
const LOCAL_FILE = 'local/variants.json';
const IMAGE_FIELDS = ['icon', 'adaptiveForeground', 'adaptiveBackground', 'monochrome'];

/**
 * @typedef {{
 *   id: string, name: string, appId: string, icon: string,
 *   adaptiveForeground?: string, adaptiveBackground?: string, monochrome?: string,
 *   color?: string, accent?: string,
 * }} Variant
 */

/** @returns {Variant[]} */
function readFile(file) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) return [];
  let list;
  try {
    list = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (e) {
    throw new Error(`${file} is not valid JSON: ${e.message}`);
  }
  if (!Array.isArray(list)) throw new Error(`${file} must be a JSON array of variants`);
  for (const v of list) validate(v, file);
  return list;
}

function validate(v, file) {
  const label = `${file}: variant ${JSON.stringify(v && (v.id || v.name))}`;
  for (const key of ['id', 'name', 'appId', 'icon']) {
    if (!v || typeof v[key] !== 'string' || !v[key]) throw new Error(`${label} is missing "${key}"`);
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(v.id)) {
    throw new Error(`${label}: "id" may only use lowercase letters, digits and dashes`);
  }
  if (!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(v.appId)) {
    throw new Error(`${label}: "appId" must look like com.example.app`);
  }
  for (const key of IMAGE_FIELDS) {
    if (v[key] && !fs.existsSync(path.join(ROOT, v[key]))) throw new Error(`${label}: "${key}" file not found: ${v[key]}`);
  }
}

/** Public variants first, then local ones; a local entry replaces a public one with the same id. */
function loadVariants() {
  const byId = new Map();
  for (const v of [...readFile(PUBLIC_FILE), ...readFile(LOCAL_FILE)]) byId.set(v.id, v);
  if (byId.size === 0) throw new Error(`No variants defined in ${PUBLIC_FILE}`);
  const appIds = new Set();
  for (const v of byId.values()) {
    if (appIds.has(v.appId)) throw new Error(`Two variants share appId ${v.appId}; each needs its own`);
    appIds.add(v.appId);
  }
  return [...byId.values()];
}

/** APP_VARIANT, else the first local variant, else the first public one. */
function defaultVariantId() {
  return process.env.APP_VARIANT || (readFile(LOCAL_FILE)[0] || readFile(PUBLIC_FILE)[0]).id;
}

module.exports = { loadVariants, defaultVariantId };

if (require.main === module) {
  const ids = loadVariants().map((v) => v.id);
  const mode = process.argv[2];
  if (mode === 'ids') console.log(ids.join(' '));
  else if (mode === 'json-ids') console.log(JSON.stringify(ids));
  else {
    console.error('usage: node scripts/variants.js ids|json-ids');
    process.exit(1);
  }
}
