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
//   OTP_IMAP_USER        inbox that receives the checker's login codes (e.g. a Gmail address)
//   OTP_IMAP_PASSWORD    that inbox's app password
//   OTP_IMAP_HOST        optional, defaults to imap.gmail.com
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
const SCREENS = JSON.parse(fs.readFileSync(path.join(ROOT, 'inventory', 'screens.json'), 'utf8')).map(x => x.path.split('?')[0]);
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
    const since = new Date(Date.now() - 60000);
    await page.getByRole('button', { name: /sign in|log in/i }).first().click();
    await page.waitForTimeout(8000);
    if (await page.getByText(/verification code|one.time|otp|security code/i).count()) {
      await enterLoginCode(page, since);
    }
    await page.goto(`${BASE}/v2/location/${LOC}/dashboard`, { waitUntil: 'domcontentloaded' });
  }
  if (!/\/v2\/location\//.test(page.url())) throw new Error('LOGIN_FAILED: still on ' + new URL(page.url()).pathname);
  // keep the session for local runs only; never written in CI
  if (!process.env.CI) fs.writeFileSync(path.join(OUT, 'storage-state.b64'), Buffer.from(JSON.stringify(await ctx.storageState())).toString('base64'));
  return { browser, ctx, page };
}

// ---------- one-time login code ----------
// The platform emails a security code when the checker logs in from a new browser,
// which is every night in CI. We read it from the checker's inbox over IMAP.
async function enterLoginCode(page, since) {
  if (!process.env.OTP_IMAP_USER || !process.env.OTP_IMAP_PASSWORD) {
    await page.screenshot({ path: path.join(OUT, 'login-code-screen.png') }).catch(() => {});
    throw new Error('LOGIN_NEEDS_OTP: add the OTP_IMAP_USER and OTP_IMAP_PASSWORD secrets (see README)');
  }
  log('login code needed, sending to email');
  // pick email if there's a choice, then ask for the code
  const emailOpt = page.getByText(/^\s*email\s*$/i).first();
  if (await emailOpt.count()) await emailOpt.click().catch(() => {});
  const send = page.getByRole('button', { name: /send|get code|email me/i }).first();
  if (await send.count()) { await send.click().catch(() => {}); await page.waitForTimeout(3000); }
  const code = await waitForCode(since);
  log('code received');
  const boxes = page.locator('input[maxlength="1"]');
  if (await boxes.count() >= code.length) {
    for (let i = 0; i < code.length; i++) await boxes.nth(i).fill(code[i]);
  } else {
    const box = page.locator('input[autocomplete="one-time-code"], input[inputmode="numeric"], input[type="tel"], input[type="number"], input[type="text"]').first();
    await box.click(); await page.keyboard.type(code, { delay: 60 });
  }
  await page.waitForTimeout(800);
  const confirm = page.getByRole('button', { name: /confirm|verify|submit|continue|sign in|log in/i }).first();
  if (await confirm.count()) await confirm.click().catch(() => {});
  await page.waitForTimeout(8000);
}

async function waitForCode(since) {
  const { ImapFlow } = await import('imapflow');
  const deadline = Date.now() + 150000;
  while (Date.now() < deadline) {
    const client = new ImapFlow({ host: process.env.OTP_IMAP_HOST || 'imap.gmail.com', port: 993, secure: true, logger: false,
      auth: { user: process.env.OTP_IMAP_USER, pass: process.env.OTP_IMAP_PASSWORD } });
    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      try {
        const uids = await client.search({ since }, { uid: true });
        let best = null;
        for (const uid of (uids || []).slice(-10)) {
          const m = await client.fetchOne(uid, { source: true, internalDate: true }, { uid: true });
          if (!m || m.internalDate < since) continue;
          const text = decodeMail(m.source.toString('utf8'));
          if (!/code|verif|otp|sign.?in|log.?in/i.test(text)) continue;
          const c = text.match(/(?:code|otp)[^0-9]{0,80}(\d{6})\b/i) || text.match(/\b(\d{6})\b/);
          if (c && (!best || m.internalDate > best.at)) best = { code: c[1], at: m.internalDate };
        }
        if (best) return best.code;
      } finally { lock.release(); }
    } catch (e) {
      if (/auth|credentials|login/i.test(e.message || '')) throw new Error('OTP_IMAP_LOGIN_FAILED: check OTP_IMAP_USER / OTP_IMAP_PASSWORD');
    } finally { await client.logout().catch(() => {}); }
    await new Promise(r => setTimeout(r, 6000));
  }
  throw new Error('LOGIN_CODE_NOT_RECEIVED: no code email arrived within 2.5 minutes');
}

// plain text out of a raw email: undo quoted-printable and base64 parts, strip tags
function decodeMail(raw) {
  let out = raw.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  out += '\n' + [...raw.matchAll(/Content-Transfer-Encoding:\s*base64[\s\S]*?\r?\n\r?\n([A-Za-z0-9+\/=\r\n]+)/gi)]
    .map(m => { try { return Buffer.from(m[1].replace(/\s/g, ''), 'base64').toString('utf8'); } catch { return ''; } }).join('\n');
  return out.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/#[0-9a-f]{6}\b/gi, ' ');
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

// What a client admin actually sees on given screens: buttons, tabs and headings (no table data).
// SNAPSHOT_PATHS="/a,/b>Button to click first". Written to the run summary.
async function snapshot(page) {
  const md = ['# Client view snapshot', ''];
  for (const entry of process.env.SNAPSHOT_PATHS.split(',').map(x => x.trim()).filter(Boolean)) {
    const [where, click] = entry.split('>').map(x => x.trim());
    log('snapshot ' + entry);
    await gotoRel(page, where);
    if (click) {
      const b = page.getByRole('button', { name: click }).first();
      if (await b.count()) { await b.click().catch(() => {}); await page.waitForTimeout(4000); }
      else md.push(`_couldn't find "${click}" to click_`);
    }
    const at = new URL(page.url()).pathname.replace(/^.*\/location\/[^/]+/, '');
    const seen = new Set();
    for (const f of page.frames()) {
      try {
        const labels = await f.evaluate(() => {
          const vis = e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden'; };
          return [...document.querySelectorAll('button,[role=button],[role=tab],[role=menuitem],[id^=tb_],h1,h2,h3,[role=dialog] a,[role=dialog] label')]
            .filter(e => vis(e) && !e.closest('table,tbody,[role=row],[role=grid],[id^=sb_]'))
            .map(e => ((e.id && e.id.startsWith('tb_') ? '[' + e.id + '] ' : '') + (e.innerText || e.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()).slice(0, 60))
            .filter(t => t.replace(/\[[^\]]+\]/, '').trim());
        });
        labels.forEach(l => seen.add(l));
      } catch {}
    }
    md.push(`## ${entry}`, `landed on \`${at}\``, '', [...seen].slice(0, 120).map(l => '- ' + l.replace(/[<>]/g, '')).join('\n'), '');
  }
  const out = md.join('\n');
  fs.writeFileSync(path.join(OUT, 'snapshot.md'), out);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, out + '\n');
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
  // a step must be missing two runs in a row before anything is changed or proposed (screens load flakily)
  const missFile = path.join(HERE, 'missing.json');
  const missing = fs.existsSync(missFile) ? JSON.parse(fs.readFileSync(missFile, 'utf8')) : {};
  const { browser, page } = await openSession();
  if (process.env.SNAPSHOT_PATHS) { try { await snapshot(page); } finally { await browser.close(); } return; }
  const fpNow = {};
  // group every checkable step by the screen it lives on, so each screen loads once
  const tours = {}, byWhere = {};
  for (const meta of index.tours) {
    const tour = JSON.parse(fs.readFileSync(path.join(TOURS, meta.id + '.json'), 'utf8'));
    tours[meta.id] = { tour, changed: false };
    tour.steps.forEach(st => {
      const where = (checkPath(st) || '').split('?')[0];
      if (!where || !st.target) return;
      (byWhere[where] = byWhere[where] || []).push({ id: meta.id, st });
    });
  }
  report.unverified = []; report.recheck = [];
  try {
    for (const [where, items] of Object.entries(byWhere).slice(0, +process.env.WATCH_LIMIT || Infinity)) {
      log(`checking ${where} (${items.length} steps)`);
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
        if (seen) { report.ok.push(key); confirmed[key] = new Date().toISOString().slice(0, 10); delete missing[key]; continue; }
        missing[key] = (missing[key] || 0) + 1;
        if (missing[key] < 2 && (precise[0] && precise[0].css || confirmed[key])) { report.recheck.push(key); continue; }

        const first = precise[0];
        if (first && first.css) {
          // a stable id vanished: a real UI change. Repoint with Claude, prove it, keep old as backup.
          const cands = await candidates(page);
          const fix = await claude(SYS_ANCHOR, JSON.stringify({ step: { title: st.title, body: st.body, lookFor: st.lookFor, oldTarget: st.target }, candidates: cands }), 600).catch(e => ({ error: e.message }));
          const hit = fix && fix.strategy && (fix.confidence || 0) >= 0.75 ? await resolves(page, fix.strategy) : null;
          if (hit && sameThing(st, list, hit)) {
            st.target = [fix.strategy, ...list.filter(o => JSON.stringify(o) !== JSON.stringify(fix.strategy))].slice(0, 5);
            tours[id].changed = true;
            report.fixed.push({ key, to: fix.strategy, why: fix.reason });
          } else report.broken.push({ key, target: st.target, suggestion: hit ? { ...fix, reason: `Best match was "${hit.text || hit.id}", which doesn't match what the step describes. If the checker user can't see this, give it full permissions. ` + (fix.reason || '') } : fix });
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
  if (!DRY) fs.writeFileSync(missFile, JSON.stringify(missing, null, 0) + '\n');

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

// Only auto-repoint when the new element is clearly the same control: its label must match a
// label the step already names. A different control (another tab, another button) is never
// swapped in automatically; it goes to "Needs a look" instead.
function norm(x) { return String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function sameThing(st, list, hit) {
  const want = new Set();
  list.forEach(o => { if (o.text) want.add(norm(o.text)); });
  if (st.lookFor) want.add(norm(st.lookFor));
  (String(st.body || '').match(/\*\*([^*]+)\*\*/g) || []).forEach(b => want.add(norm(b)));
  const got = norm(hit.text);
  for (const w of want) if (w && got && (got === w || (got.length >= 4 && w.includes(got)) || (w.length >= 4 && got.includes(w)))) return true;
  if (!want.size || !got) {
    // icon-only controls: accept only a near-identical id (e.g. a suffix change)
    const id = norm((hit.id || '').replace(/^(tb|sb)_/, ''));
    return list.some(o => { const old = norm((o.css || '').replace(/^#(tb|sb)_/, '#').replace(/^#/, '')); let n = 0; while (n < old.length && n < id.length && old[n] === id[n]) n++; return old.length >= 6 && n >= Math.max(6, Math.ceil(old.length * 0.75)); });
  }
  return false;
}

// The screen a step is checked on: where the client is when they see it. That's the step's
// "go" page when it satisfies the step's route, otherwise the page its route points at.
function checkPath(st) {
  const rx = r => { try { return r ? new RegExp(r, 'i') : null; } catch { return null; } };
  const re = rx(st.route), adv = rx(st.advance && st.advance.route);
  const alts = (String(st.route || '').match(/^\^?\/\(([a-z0-9_\-\/|]+)\)/i) || [, ''])[1].split('|').filter(Boolean).map(a => '/' + a);
  const cands = [st.go, guessPath(st), ...alts].filter(Boolean);
  // prefer real screens from the inventory (a bare prefix like /funnels-websites isn't a page)
  const real = SCREENS.filter(p => cands.some(c => p.startsWith(c.split('?')[0])));
  cands.splice(1, 0, ...real.filter(p => cands.slice(1).some(c => p.startsWith(c))));
  // the engine skips a step when the client is already where it leads, so never check it there
  for (const c of cands) { const p = c.split('?')[0]; if ((!re || re.test(p)) && !(adv && adv.test(p))) return c; }
  return st.go;
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
  L.push(`**${r.ok.length}** steps confirmed on screen, **${(r.unverified||[]).length}** inside dialogs (coach card), **${r.fixed.length}** auto-repointed, **${r.broken.length}** broken, **${r.proposals.length}** copy proposals, **${r.uiChanges.length}** UI changes, **${(r.recheck||[]).length}** missing once (rechecked next run).`, '');
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
