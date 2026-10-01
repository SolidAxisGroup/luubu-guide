#!/usr/bin/env node
// Builds tours/index.json: the screen map plus lightweight metadata for every tour.
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), T = path.join(ROOT, 'tours');
const screens = JSON.parse(fs.readFileSync(path.join(ROOT, 'inventory', 'screens.json'), 'utf8'))
  .map(s => {
    // a sidebar id that opens this exact screen lets the Guide navigate by clicking it (no page reload)
    const m = ((s.anchor && s.anchor.css) || '').match(/^(?:#|\[id='?)(sb_[^'\]]+)/);
    return { key: s.key, label: s.label.replace(/ \(gear icon\)/, ''), path: s.path, area: s.area, ...(m ? { sb: m[1] } : {}) };
  });
const tours = fs.readdirSync(T).filter(f => f.endsWith('.json') && f !== 'index.json').map(f => {
  const t = JSON.parse(fs.readFileSync(path.join(T, f), 'utf8'));
  return { id: t.id, kind: t.kind || 'howto', area: t.area, screen: t.screen, title: t.title, blurb: t.blurb, icon: t.icon, minutes: t.minutes, keywords: t.keywords, steps: t.steps.length };
}).sort((a, b) => a.id.localeCompare(b.id));
fs.writeFileSync(path.join(T, 'index.json'), JSON.stringify({ version: 2, built: new Date().toISOString(), screens, tours }) + '\n');
console.log(`index.json: ${screens.length} screens, ${tours.length} tours, ${(fs.statSync(path.join(T, 'index.json')).size / 1024).toFixed(1)} KB`);
