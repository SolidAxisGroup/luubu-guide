// Luubu Guide watcher
// Nightly: logs in to the demo sub-account, replays every tour step, and checks
// each anchor still resolves. Broken anchors get repointed by Claude and fixed
// in place. Copy changes and new-feature ideas are written as proposals for Tim.
//
// Env:
//   LUUBU_URL            https://app.luubu.software
//   LUUBU_LOCATION       demo location id (hey-FYI)
//   LUUBU_EMAIL          watcher user email
//   LUUBU_PASSWORD       watcher user password
//   LUUBU_STORAGE_STATE  optional base64 Playwright session (skips login / OTP)
//   ANTHROPIC_API_KEY    Claude API key
//   CLAUDE_MODEL         optional, defaults below
//   DRY_RUN=1            report only, change nothing
//   PLATFORM_CHANGELOG_URL optional, release notes page to scan

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TOURS = path.join(ROOT, 'tours');
const OUT = path.join(HERE, 'out');
fs.mkdirSync(OUT, { recursive: true });

const BASE = process.env.LUUBU_URL || 'https://app.luubu.software';
const LOC = process.env.LUUBU_LOCATION || 'zRK0moceMCOayumGoB8R';
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5';
const DRY = !!process.env.DRY_RUN;
// Brand terms the Guide must never show are kept encoded in build/brand-terms.b64.
const TERMS = JSON.parse(Buffer.from(fs.readFileSync(path.join(ROOT, 'build', 'brand-terms.b64'), 'utf8'), 'base64').toString());
const NEVER = `Never mention the underlying platform or any of these names: ${TERMS.names.join(', ')}. Always say Luubu.`;
const ENGINE = fs.readFileSync(path.join(ROOT, 'src', 'guide.js'), 'utf8');

const log = (...a) => console.log('[watcher]', ...a);

// ---------- Claude ----------
async function claude(system, user, maxTokens = 1200) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY missing');
  const r = await fetch((process.env.CLAUDE_BASE_URL || 'https://api.anthropic.com') + '/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] })
  });
  if (!r.ok) throw new Error('Claude ' + r.status + ' ' + (await r.text()).slice(0, 300));
  const j = await r.json();
  const text = j.content.map(c => c.text || '').join('');
  const m = text.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

// ---------- browser ----------
async function openSession() {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  let storageState;
  if (process.env.LUUBU_STORAGE_STATE) {
    storageState = JSON.parse(Buffer.from(process.env.LUUBU_STORAGE_STATE, 'base64').toString('utf8'));
  }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/v2/location/${LOC}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  if (!/\/v2\/location\//.test(page.url()) || await page.locator('input[type=password]').count()) {
    if (!process.env.LUUBU_EMAIL) throw new Error('Not logged in and no LUUBU_EMAIL set');
    log('logging in');
    await page.locator('input[type=email], input[name=email]').first().fill(process.env.LUUBU_EMAIL);
    await page.locator('input[type=password]').first().fill(process.env.LUUBU_PASSWORD || '');
    await page.getByRole('button', { name: /sign in|log in/i }).first().click();
    await page.waitForTimeout(8000);
    if (await page.getByText(/verification code|one.time|otp|security code/i).count()) {
      throw new Error('LOGIN_NEEDS_OTP: refresh LUUBU_STORAGE_STATE (see README)');
    }
    await page.goto(`${BASE}/v2/location/${LOC}/dashboard`, { waitUntil: 'domcontentloaded' });
  }
  // keep the session fresh for next run
  fs.writeFileSync(path.join(OUT, 'storage-state.b64'), Buffer.from(JSON.stringify(await ctx.storageState())).toString('base64'));
  return { browser, ctx, page };
}

async function appReady(page) {
  await page.waitForSelector('[id^=sb_]', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(4000);
  // load the real engine in inert mode (no UI) so anchors resolve exactly as clients see them
  await page.evaluate(src => {
    window.LUUBU_GUIDE_CONFIG = { locations: ['__watcher__'], tours: [] };
    delete window.__luubuGuide;
    (0, eval)(src);
  }, ENGINE);
}

async function gotoRel(page, rel) {
  await page.goto(`${BASE}/v2/location/${LOC}${rel}`, { waitUntil: 'domcontentloaded' });
  await appReady(page);
}

async function resolves(page, target) {
  return page.evaluate(t => {
    const el = window.__luubuGuide.resolve(t);
    if (!el) return null;
    return { tag: el.tagName, id: el.id || null, text: (el.innerText || '').trim().slice(0, 60) };
  }, target);
}

async function frameHasText(page, text) {
  if (!text) return true;
  for (const f of page.frames()) {
    try { if (await f.getByText(text, { exact: false }).first().isVisible({ timeout: 1500 })) return true; } catch {}
  }
  return false;
}

async function candidates(page) {
  return page.evaluate(() => {
    const vis = e => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    return [...document.querySelectorAll('a,button,[role=tab],[role=button],[id^=sb_],[id^=tb_]')]
      .filter(vis).slice(0, 250)
      .map(e => ({ tag: e.tagName.toLowerCase(), id: e.id || undefined, text: (e.innerText || e.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 60) }))
      .filter(c => c.text || c.id);
  });
}

async function frameTexts(page) {
  const out = [];
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    try {
      const t = await f.evaluate(() => [...document.querySelectorAll('button,a,h1,h2,h3,[role=tab],label')].map(e => (e.innerText || '').trim()).filter(Boolean).slice(0, 200));
      out.push(...t);
    } catch {}
  }
  return [...new Set(out)].slice(0, 250);
}

// the UI "fingerprint": every stable id + label on each screen we visit
async function fingerprint(page) {
  return page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[id^=sb_],[id^=tb_],[id^=sp-v3-platform]')]
    .map(e => [e.id, (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40)])));
}

// ---------- main ----------
const report = { at: new Date().toISOString(), ok: [], fixed: [], broken: [], proposals: [], uiChanges: [] };

async function main() {
  const index = JSON.parse(fs.readFileSync(path.join(TOURS, 'index.json'), 'utf8'));
  const confFile = path.join(HERE, 'confirmed.json');
  const confirmed = fs.existsSync(confFile) ? JSON.parse(fs.readFileSync(confFile, 'utf8')) : {};
  const { browser, page } = await openSession();
  const fpNow = {};
  // group every checkable step by the screen it lives on, so each screen loads once
  const tours = {}, byWhere = {};
  for (const meta of index.tours) {
    const tour = JSON.parse(fs.readFileSync(path.join(TOURS, meta.id + '.json'), 'utf8'));
    tours[meta.id] = { tour, changed: false };
    tour.steps.forEach(st => {
      const where = (st.go || guessPath(st) || '').split('?')[0];
      if (!where || !st.target) return;
      (byWhere[where] = byWhere[where] || []).push({ id: meta.id, st });
    });
  }
  report.unverified = [];
  try {
    for (const [where, items] of Object.entries(byWhere).slice(0, +process.env.WATCH_LIMIT || Infinity)) {
      await gotoRel(page, where);
      fpNow[where] = await fingerprint(page);
      for (const { id, st } of items) {
        const key = `${id}/${st.id}`;
        const list = Array.isArray(st.target) ? st.target : [st.target];
        const precise = list.filter(x => x.css || x.text);
        const label = st.lookFor || (precise.find(x => x.text) || {}).text;
        let seen = precise.length ? !!(await resolves(page, precise)) : false;
        if (!seen && label) seen = await frameHasText(page, label);
        if (!precise.length && !label) { report.ok.push(key); continue; }   // explanation-only step
        if (seen) { report.ok.push(key); confirmed[key] = new Date().toISOString().slice(0, 10); continue; }

        const first = precise[0];
        if (first && first.css) {
          // a stable id vanished: a real UI change. Repoint with Claude, prove it, keep old as backup.
          const cands = await candidates(page);
          const fix = await claude(SYS_ANCHOR, JSON.stringify({ step: { title: st.title, body: st.body, lookFor: st.lookFor, oldTarget: st.target }, candidates: cands }), 600).catch(e => ({ error: e.message }));
          if (fix && fix.strategy && (fix.confidence || 0) >= 0.75 && await resolves(page, fix.strategy)) {
            st.target = [fix.strategy, ...list.filter(o => JSON.stringify(o) !== JSON.stringify(fix.strategy))].slice(0, 5);
            tours[id].changed = true;
            report.fixed.push({ key, to: fix.strategy, why: fix.reason });
          } else report.broken.push({ key, target: st.target, suggestion: fix });
          continue;
        }
        if (confirmed[key]) {
          // label was on screen before and has gone: Luubu changed. Draft new copy for approval.
          const texts = await frameTexts(page);
          const cands = (await candidates(page)).map(c => c.text).filter(Boolean);
          const p = await claude(SYS_COPY, JSON.stringify({ step: st, visibleLabels: [...new Set([...cands, ...texts])].slice(0, 300) }), 900).catch(e => ({ error: e.message }));
          report.proposals.push({ key, reason: `"${label}" was on this screen before and is gone`, proposal: p });
        } else {
          // never seen on the landing screen: usually inside a dialog or builder. Coach card covers it.
          report.unverified.push(key);
        }
      }
    }
    if (!DRY) for (const [id, t] of Object.entries(tours)) if (t.changed) fs.writeFileSync(path.join(TOURS, id + '.json'), JSON.stringify(t.tour, null, 2) + '\n');
  } finally {
    await browser.close();
  }
  if (!DRY) fs.writeFileSync(confFile, JSON.stringify(confirmed, null, 0) + '\n');

  // UI change detection against last run
  const fpFile = path.join(HERE, 'fingerprint.json');
  const fpPrev = fs.existsSync(fpFile) ? JSON.parse(fs.readFileSync(fpFile, 'utf8')) : null;
  if (fpPrev) {
    for (const [route, ids] of Object.entries(fpNow)) {
      const prev = fpPrev[route] || {};
      for (const id of Object.keys(ids)) if (!(id in prev)) report.uiChanges.push({ route, added: id, label: ids[id] });
      for (const id of Object.keys(prev)) if (!(id in ids)) report.uiChanges.push({ route, removed: id, label: prev[id] });
      for (const id of Object.keys(ids)) if (id in prev && prev[id] !== ids[id]) report.uiChanges.push({ route, renamed: id, from: prev[id], to: ids[id] });
    }
  }
  if (!DRY) fs.writeFileSync(fpFile, JSON.stringify(fpNow, null, 1) + '\n');

  // new platform releases that might deserve a tour or change one
  report.releases = await releaseScan(index).catch(e => ({ error: e.message }));

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT, 'summary.md'), summary(report));
  log(`ok ${report.ok.length} | fixed ${report.fixed.length} | broken ${report.broken.length} | proposals ${report.proposals.length} | unverified ${report.unverified.length} | ui changes ${report.uiChanges.length}`);
}

function guessPath(st) {
  if (!st.route) return null;
  const m = st.route.replace(/^\^/, '').match(/^\/[a-z0-9_\-\/]+/i);
  return m ? m[0].replace(/\/$/, '') : null;
}

async function releaseScan(index) {
  const r = await fetch(process.env.PLATFORM_CHANGELOG_URL || TERMS.changelog);
  if (!r.ok) return { skipped: r.status };
  const html = await r.text();
  const titles = [...html.matchAll(/<h[23][^>]*>([^<]{8,140})<\/h[23]>/g)].map(m => m[1].trim()).slice(0, 40);
  if (!titles.length) return { titles: [] };
  const verdict = await claude(SYS_RELEASES, JSON.stringify({ tours: index.tours.map(t => ({ id: t.id, title: t.title })), recentReleaseTitles: titles }), 1500);
  return verdict;
}

function summary(r) {
  const L = [];
  L.push(`# Luubu Guide watcher report`, '', `${r.at}`, '');
  L.push(`**${r.ok.length}** steps confirmed on screen, **${(r.unverified||[]).length}** inside dialogs (coach card), **${r.fixed.length}** auto-repointed, **${r.broken.length}** broken, **${r.proposals.length}** copy proposals, **${r.uiChanges.length}** UI changes.`, '');
  if (r.fixed.length) { L.push('## Auto-fixed (already live)'); r.fixed.forEach(f => L.push(`- \`${f.key}\` now points at ${JSON.stringify(f.to)} (${f.why || ''})`)); L.push(''); }
  if (r.broken.length) { L.push('## Needs a look'); r.broken.forEach(b => L.push(`- \`${b.key}\`: ${b.suggestion && b.suggestion.reason ? b.suggestion.reason : 'no confident match'}`)); L.push(''); }
  if (r.proposals.length) { L.push('## Copy changes for your approval'); r.proposals.forEach(p => L.push(`- \`${p.key}\` (${p.reason})\n  \`\`\`json\n  ${JSON.stringify(p.proposal)}\n  \`\`\``)); L.push(''); }
  if (r.uiChanges.length) { L.push('## Luubu UI changes spotted'); r.uiChanges.slice(0, 40).forEach(c => L.push(`- ${c.route}: ${c.added ? 'added ' + c.added + ' "' + c.label + '"' : c.removed ? 'removed ' + c.removed + ' "' + c.label + '"' : 'renamed ' + c.renamed + ' "' + c.from + '" to "' + c.to + '"'}`)); L.push(''); }
  if (r.releases && r.releases.items && r.releases.items.length) { L.push('## New platform releases worth a tour'); r.releases.items.forEach(i => L.push(`- **${i.title}**: ${i.why}${i.affects ? ' (affects `' + i.affects + '`)' : ''}`)); }
  return L.join('\n');
}

const SYS_ANCHOR = `You maintain in-app walkthrough tours for a white-labelled CRM platform called Luubu.
A tour step's anchor no longer matches. From the candidate elements on the current screen, pick the one the step is about.
Reply ONLY with JSON: {"strategy": {"css": "#id"} or {"text": "Exact label", "tag": "button|a"}, "confidence": 0-1, "reason": "short"}.
Prefer stable ids (sb_*, tb_*, sp-v3-*, create-new-button). Never pick an unrelated element. If nothing fits, confidence 0.`;

const SYS_COPY = `You maintain in-app walkthrough copy for Luubu, a white-labelled CRM platform used by NZ small businesses.
A step points at a label that is no longer visible. Using the visible labels, propose an updated step.
Keep the tone: short, plain NZ English, bold the exact button names with **, no em dashes. ${NEVER}
Reply ONLY with JSON: {"lookFor": "new label", "title": "...", "body": "...", "confidence": 0-1, "reason": "short"}.`;

const SYS_RELEASES = `You maintain walkthrough tours for Luubu, a white-labelled CRM platform for NZ small businesses.
Given existing tours and recent release titles from the underlying platform, pick releases that (a) change how an existing tour works, or (b) are client-facing features worth a new tour.
Ignore agency-only, API and minor fixes. Reply ONLY with JSON: {"items":[{"title":"release title","why":"one line","affects":"tour-id or null","newTour":true|false}]}.`;

main().catch(e => {
  report.fatal = e.message;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT, 'summary.md'), `# Luubu Guide watcher failed\n\n${e.message}\n`);
  console.error(e);
  process.exit(1);
});
