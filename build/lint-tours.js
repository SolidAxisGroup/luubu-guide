#!/usr/bin/env node
// Lints tour JSON files against the authoring spec.
// Usage: node build/lint-tours.js [files...]   (no args = every tour)
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const TOURS = path.join(ROOT, 'tours');
const screens = JSON.parse(fs.readFileSync(path.join(ROOT, 'inventory', 'screens.json'), 'utf8'));
const screenKeys = new Set(screens.map(s => s.key));
const knownCss = new Set(['#sb_settings', '#create-new-button', '#positive-empty-state']);
screens.forEach(s => { knownCss.add(s.anchor.css); const m = s.anchor.css.match(/^\[id='(sb_[^'.]+)'\]$/); if (m) knownCss.add('#' + m[1]); if (s.sidebar && s.sidebar.startsWith('#sb_')) knownCss.add(s.sidebar.split(' ')[0]); });
const ICONS = 'mail share flow globe page megaphone phone users calendar card chat bot star chart cog book image grid'.split(' ');
// Brand terms that must never appear are kept encoded in build/brand-terms.b64.
const TERMS = JSON.parse(Buffer.from(fs.readFileSync(path.join(__dirname, 'brand-terms.b64'), 'utf8'), 'base64').toString());
const BANNED = new RegExp(TERMS.banned + '|\u2014', 'i');

let files = process.argv.slice(2);
if (!files.length) files = fs.readdirSync(TOURS).filter(f => f.endsWith('.json') && f !== 'index.json').map(f => path.join(TOURS, f));
let errors = 0, warns = 0;
const ids = new Map();
const err = (f, m) => { errors++; console.log(`ERROR ${path.basename(f)}: ${m}`); };
const warn = (f, m) => { warns++; console.log(`warn  ${path.basename(f)}: ${m}`); };

for (const f of files) {
  let t;
  try { t = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { err(f, 'invalid JSON: ' + e.message); continue; }
  if (path.basename(f) !== t.id + '.json') err(f, `file name must be ${t.id}.json`);
  if (ids.has(t.id)) err(f, 'duplicate id ' + t.id); ids.set(t.id, f);
  for (const k of ['id', 'title', 'blurb', 'steps']) if (!t[k]) err(f, 'missing ' + k);
  if (t.kind && !['page', 'howto'].includes(t.kind)) err(f, 'kind must be page or howto');
  if (t.screen && !screenKeys.has(t.screen)) err(f, 'unknown screen ' + t.screen);
  if (t.icon && !ICONS.includes(t.icon)) err(f, 'unknown icon ' + t.icon);
  const text = JSON.stringify(t);
  const b = text.match(BANNED); if (b) err(f, `banned text "${b[0]}"`);
  const n = (t.steps || []).length;
  if (t.kind === 'howto' && (n < 3 || n > 9)) warn(f, `${n} steps (aim 3-8)`);
  if (t.kind === 'page' && (n < 3 || n > 8)) warn(f, `${n} steps (aim 4-7)`);
  const sids = new Set();
  (t.steps || []).forEach((s, i) => {
    const at = `step ${i + 1} (${s.id || '?'})`;
    if (!s.id) err(f, at + ' missing id'); else if (sids.has(s.id)) err(f, at + ' duplicate step id'); sids.add(s.id);
    if (!s.title || !s.body) err(f, at + ' missing title/body');
    if (s.body && s.body.length > 420) warn(f, at + ' body is long');
    for (const r of [s.route, s.advance && s.advance.route]) if (r) { try { new RegExp(r); } catch (e) { err(f, at + ' bad regex ' + r); } }
    if (i > 0 && !s.route) warn(f, at + ' has no route');
    if (s.route && !s.go) warn(f, at + ' has route but no go');
    const tg = s.target == null ? [] : (Array.isArray(s.target) ? s.target : [s.target]);
    tg.forEach(x => {
      if (x.css && !knownCss.has(x.css)) warn(f, `${at} css ${x.css} not in inventory (fine if you verified it)`);
      if (!x.css && !x.text && !x.frame && !x.coach) err(f, at + ' target strategy needs css, text, frame or coach');
    });
    const inPage = tg.some(x => x.text) && !tg.some(x => x.css);
    if (inPage && !tg.some(x => x.coach)) warn(f, at + ' in-page target should end with {"coach": true}');
    if (inPage && !s.lookFor) warn(f, at + ' in-page step missing lookFor');
  });
}
console.log(`\n${files.length} files, ${errors} errors, ${warns} warnings`);
process.exit(errors ? 1 : 0);
