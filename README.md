# Luubu Guide

Click-by-click walkthroughs for every screen in Luubu. Clients press **Guide** (bottom right). It knows which screen they're on and offers **Show me this page** plus every how-to for that screen, with search and browse-by-area for everything else. An AI watcher checks every screen nightly and repoints anything Luubu moves.

## What's in here

| Path | What it is |
|---|---|
| `src/guide.js` | The engine. Launcher, search, spotlight, coach cards, resume after reload. No dependencies. |
| `src/guide.min.js` | Minified build served to clients (run `build/build.sh` after editing). |
| `tours/*.json` | One file per tour. Edit copy here, then run `build/make-index.js`. |
| `inventory/` | Screen map and authoring spec. |
| `loader/custom-js-snippet.html` | The loader installed in Luubu's Custom JS. Loads the Guide from GitHub Pages. |
| `watcher/watch.mjs` | Nightly AI watcher. |
| `.github/workflows/watcher.yml` | Runs the watcher at 2:07am NZ time and ships fixes. |

## Library

450 tours across 108 screens in 16 areas:

- **108 page tours**: one "Show me this page" walkthrough for every main-menu item, tab and Settings page.
- **342 how-tos**: every common job on each screen, written from the official product documentation and fully white-labelled.

`inventory/screens.json` is the screen map (route + stable anchor for each). `inventory/AUTHORING.md` is the writing spec. `node build/lint-tours.js` checks every tour; `node build/make-index.js` rebuilds `tours/index.json` after any change.

## How a tour step works

```json
{
  "id": "new-website",
  "title": "Create a new website",
  "body": "Click **New website**.",
  "route": "^/funnels-websites/websites",
  "go": "/funnels-websites/websites",
  "target": [{ "css": "#create-new-button" }, { "text": "New website", "tag": "button" }],
  "advance": "click"
}
```

- `route` is the screen the step belongs on. If the client is elsewhere they get a **Take me there** button (`go`).
- `target` is a list of ways to find the element, tried in order. Stable Luubu ids first (`sb_*` sidebar, `tb_*` top tabs), visible text as backup.
- `target: { "frame": true }` is coach mode for screens Luubu renders in a secure frame (Workflows, Email Services, Email campaigns, Integrations). The frame gets a gold outline and the card docks inside it. `lookFor` is the label the watcher checks for.
- `advance`: `"next"` (button), `"click"` (moves on when they click the target), or `{ "route": "regex" }` (moves on when the screen changes).
- `target: [{ "coach": true }]` is an instruction card with no highlight. In-page buttons use `[{text}, {frame}, {coach}]` so the step always works: exact highlight if the button is visible, gold frame outline if it's inside a secure frame, plain card otherwise.

## The AI watcher

Every night it logs into the demo account, opens each of the 108 screens once, and checks every step that lives there:

- **Button moved or renamed:** Claude picks the new element, the watcher proves it resolves, then saves it with the old pointer kept as backup. GitHub Pages republishes and it's live within minutes, no action needed.
- **A label that used to be on screen has gone:** Claude drafts new copy from what's there now, and it lands as a GitHub issue for your approval. Nothing client-facing is rewritten without you.
- **Luubu UI changes:** every sidebar and tab id is fingerprinted per screen and diffed against the night before.
- **New platform releases:** the release notes are scanned and anything worth a new tour, or affecting an existing one, is listed in the same issue.

## Hosting and install

- **Hosting:** GitHub Pages serves this repo at https://solidaxisgroup.github.io/luubu-guide/. Any commit to `main` is live in about a minute. Clients' browsers pick up a new engine within 10 minutes (the loader refreshes it every 10 minutes); tour files are rechecked every time they're opened.
- **Installed:** `loader/custom-js-snippet.html` sits at the end of Agency Settings > Company > White Label > Custom JS. The agency's original Custom JS above it is untouched. To remove the Guide, delete from the `<!-- Luubu Guide` line down and save.
- **Demo only for now:** the `locations` line limits it to hey-FYI. Delete that line to switch the Guide on for every sub-account.

## Turn on the nightly watcher

1. **Watcher login:** in hey-FYI, add a user (for example watcher@luubu.com) with access to Settings, Marketing, Automation and Sites.
2. **Repo secrets** (Settings > Secrets and variables > Actions): `LUUBU_EMAIL`, `LUUBU_PASSWORD`, `ANTHROPIC_API_KEY`.
   If the login asks for a one-time code, also add `LUUBU_STORAGE_STATE`: run the watcher once locally, log in, and paste the contents of `watcher/out/storage-state.b64`.
3. **Run it once by hand:** Actions > Luubu Guide watcher > Run workflow. After that it runs at 2:07am NZ time every night.

## Handy

- Alt+H brings the Guide back if a client hid it.
- `window.__luubuGuide.start('phone-number')` launches a tour from anywhere, for example from a workflow email link or the AI chat later.
- Every start, step, finish and missing anchor fires a `luubu-guide` browser event. Set `telemetry` in the config to a URL to collect them.
