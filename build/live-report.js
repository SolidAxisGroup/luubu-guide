#!/usr/bin/env node
// Maps live sweep results (label found / not found per screen) back to tour steps.
// Usage: node build/live-report.js build/live-results.json
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const R = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const checks = JSON.parse(fs.readFileSync(path.join(ROOT, 'build', 'live-checks.json'), 'utf8'));
const lab = x => x.css ? '#' + x.css : x.text + (x.tag ? '|' + x.tag : '');
let ok = 0, framed = 0, unseen = 0;
const perScreen = [], unseenSteps = [];
for (const [p, items] of Object.entries(checks)) {
  const r = R[p];
  if (!r) { perScreen.push({ p, status: 'not swept', n: items.length }); continue; }
  const found = new Set(r.f);
  let s = { p, framed: r.fr, ok: 0, unseen: 0 };
  for (const [tour, step, strats] of items) {
    if (strats.some(x => found.has(lab(x)))) { ok++; s.ok++; }
    else if (r.fr) { framed++; s.unseen++; }
    else { unseen++; s.unseen++; unseenSteps.push({ tour, step, labels: strats.map(lab), screen: p }); }
  }
  perScreen.push(s);
}
const out = { summary: { checked: ok + framed + unseen, confirmed: ok, insideFrame: framed, notOnLandingScreen: unseen }, perScreen, unseenSteps };
fs.writeFileSync(path.join(ROOT, 'build', 'live-report.json'), JSON.stringify(out, null, 1));
console.log(out.summary);
