# Luubu Guide: tour authoring spec

Luubu is a white-labelled CRM platform for New Zealand small businesses. You are writing in-app walkthroughs that a client clicks through inside Luubu.

## White-label rules (strict)

- Never write the underlying platform's name, its product names or its domains (the full list is encoded in `build/brand-terms.b64` and enforced by the linter). Say **Luubu**, **Luubu Phone**, **Luubu Email** instead.
- Never link to the underlying platform's help centre or any of its URLs. Support is **hello@luubu.com**.
- Do not copy help-article sentences. Read them for facts, then write fresh, shorter copy in your own words.
- If a feature is agency-only (the client can't do it), say "Ask us to switch this on: hello@luubu.com" instead of explaining agency steps.

## Voice

- NZ English (colour, organise, enrol). Short, plain sentences. Talk to a busy tradie or clinic owner, not a marketer.
- **Bold** exact on-screen labels with `**`. Only bold labels you are confident exist (from the inventory or the help article).
- No em dashes. No emojis. No exclamation marks except rarely.
- One action per step. 3 to 8 steps per how-to. 4 to 7 steps per page tour.

## Files

Write one JSON file per tour to `/home/claude/luubu-guide/tours/<id>.json`. `id` must be `<area>-<slug>`, lowercase, hyphens. Don't overwrite files you didn't create.

```json
{
  "id": "contacts-import-spreadsheet",
  "kind": "howto",
  "area": "contacts",
  "screen": "contacts.lists",
  "title": "Import contacts from a spreadsheet",
  "blurb": "Bring your existing customers in from Excel or a CSV.",
  "icon": "users",
  "minutes": 4,
  "keywords": ["import", "csv", "excel", "upload", "customers"],
  "steps": [ ... ]
}
```

- `kind`: `"page"` (what's on this screen, one per screen, id `<area>-page-<slug>`) or `"howto"` (a job to get done).
- `screen`: the `key` from `inventory/screens.json` where the how-to mainly happens.
- `icon`: one of `mail share flow globe page megaphone phone users calendar card chat bot star chart cog book image grid`.
- `keywords`: 4 to 10 words a client might type into search.

## Steps

Navigation steps come first and must use the exact anchors from `screens.json`:

```json
{ "id": "open-contacts", "title": "Open Contacts", "body": "Click **Contacts** in the left menu.",
  "target": [{ "css": "#sb_contacts" }, { "text": "Contacts", "tag": "a" }],
  "advance": { "route": "^/contacts/" } },
{ "id": "smart-lists", "title": "Open Smart Lists", "body": "Click **Smart Lists**.",
  "route": "^/contacts/", "go": "/contacts/smart_list/All",
  "target": [{ "css": "#tb_lists" }, { "text": "Smart Lists", "tag": "a" }],
  "advance": { "route": "^/contacts/smart_list" } }
```

- Main-menu anchors: the `sidebar` field (e.g. `#sb_contacts`). Tab anchors: the `anchor.css` field (e.g. `#tb_lists`).
- Settings pages: step 1 is `#sb_settings` with `"advance": {"route": "^/settings/"}`; step 2 is the Settings menu item using its `anchor.css` with `"route": "^/settings/", "go": "<its path>"`, and `"advance": {"route": "^<its path>"}`.
- `route` = regex the current path must match for the step (path after `/v2/location/<id>`). `go` = path to open if they're elsewhere. Add both to every step after the first.
- `advance`: `{"route": "..."}` when a click changes the screen, `"click"` when clicking the target opens something on the same screen, omit for a normal Next button.

In-page steps (buttons inside a screen) always use this fallback chain, so the step still works if the button sits inside a secure frame or has moved:

```json
{ "id": "import-button", "title": "Start the import", "body": "Click **Import Contacts**.",
  "route": "^/contacts/smart_list", "go": "/contacts/smart_list/All",
  "target": [{ "text": "Import Contacts", "tag": "button" }, { "frame": true }, { "coach": true }],
  "lookFor": "Import Contacts" }
```

- `lookFor`: the exact label the step is about. The nightly watcher checks it.
- `tip` (optional): one short helpful line.
- Pure explanation steps: `"target": [{ "coach": true }]` with `route`/`go`.

## Page tours

For every screen in your area, write one `kind: "page"` tour: navigate there, then walk the main regions and buttons: what each part is for, and what to do first. End with a step pointing at the most useful how-to ("Next: try **Import contacts** from the Guide.").

## How-tos (deep)

For each screen, write every common client job as its own how-to. Typical: 2 to 5 per screen. Cover setup, the everyday task, and one power-user task. Skip agency-only admin.

## Research

Use WebSearch and WebFetch on the platform help centre (`helpCentre` in `build/brand-terms.b64`) and its changelog for recent UI changes to get current, accurate button names and flows. Prefer articles updated in 2025 or 2026. Do NOT use any browser tools; you have no access to the Luubu account.

## Validate

Run `node /home/claude/luubu-guide/build/lint-tours.js <your files>` before finishing and fix every error.
