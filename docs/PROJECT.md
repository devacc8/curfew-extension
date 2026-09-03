# Curfew — project doc (product spec & roadmap)

> The working product document. The public landing page lives in
> [README.md](../README.md); the deep technical design — in
> [TECHNICAL_DESIGN.md](TECHNICAL_DESIGN.md).
> Image paths below resolve from the repo root.

A privacy-first Chrome (Manifest V3) extension that tracks how long you spend
on chosen sites and enforces a **daily budget** per domain. When the budget
for the day is spent, the site is intercepted and replaced by a calm reminder
page until the next day.

Working name: **Curfew** (alternatives if ever needed: Recess, Curb — see
§9). Target order: use it yourself → prove the value → publish to the
Chrome Web Store.

## Screenshots

| | |
|---|---|
| ![Popup dashboard](docs/screenshots/popup.png) | ![Options](docs/screenshots/options.png) |
| ![The wall](docs/screenshots/wall.png) | ![Willpower challenge](docs/screenshots/challenge.png) |

Popup dashboard with budgets and passes · the settings · the wall · a
Willpower Protection challenge.

## 1. Why

"Block the whole site" tools (blocklist approach) are too blunt: YouTube is
needed for study, X for work — the problem is the *infinite scroll*, not the
site. "Screen time" dashboards show you wasted 3 hours but don't stop you.

Curfew combines both sides: **visibility** (what actually took time) and
**enforcement** (a hard wall after the budget is spent) — for the sites YOU
choose, with budgets YOU set.

## 2. Core idea

The metaphor is a curfew: the site is open during the day, and at a moment
you choose *it closes*. The extension's single job: meter time on
configured patterns and make the site unreachable when the meter hits the
budget.

- **Positivity is structural**: a curfew does not say "never", it says "not
  now". After the wall, the site comes back tomorrow (or on your reset rule).
- **Local only**: usage, budgets, config — all in `chrome.storage.local`.
  No accounts, no sync, no telemetry, no server, no remote code. This is
  also what a Web Store privacy policy can say in one sentence.
- **Privilege-minimal**: at install time the browser shows zero warnings
  and zero surprises; the extension sees URLs only on sites you explicitly
  grant it — one prompt per site, never a blanket `<all_urls>` (see §4.3).

## 3. Features (v1 — the build target)

### 3.1 Quotas and budgets
- Per-domain **daily budget** in minutes (default 30m, editable).
- Patterns: exact domain (`x.com`), subdomains (`*.reddit.com`), optional
  path rules (`github.com/hm...` — v1 keeps it domain-level; paths are a
  roadmap item). Grammar is defined once in `common/patterns.js` and
  tested: `example.com` = that host only; `*.example.com` = the domain
  AND all subdomains. Our matcher is the single source of truth; its
  mapping onto permission prompts (match-patterns) and DNR conditions
  is specified in the tech doc (§5.2, §9.3).
- Adding a site triggers a per-site permission prompt (§4.3). A declined
  grant keeps the item in config but marks it "no access" — nothing is
  tracked until granted.
- Per-item `enabled` toggle + global master switch (pause all budgets).
- Budget breaks: not needed (see §3.4 — the blocker is per-domain, not
  global).

### 3.2 Time tracking
- Active time only: the tab is focused AND the window is focused AND the
  browser is not idle (browser idle threshold = chrome.idle 60s).
- Counted per day, day boundary = local midnight (DOW-aware reset is a
  roadmap item).
- Grace: the first 10 seconds on a site do not count (accidental
  navigation) — configurable, default ON.

### 3.3 Blocking
- When the budget is exhausted → the tab is redirected to the **Curfew
  page** (`blocked.html`): shows the domain, the time spent today, and a
  "stay anyway" button ONLY inside a 15-minute unblock window with an
  honest counter (see §3.5).
- Redirect is request-level (declarativeNetRequest, see §4.4): no flash
  of the site, browser-enforced even when the service worker is asleep.
- Redirect is non-negotiable for the rest of the day (a navigation to the
  same domain bounces back to the Curfew page).
- **Restore on uninstall/disable**: removing the extension leaves no trace —
  no hosts file, no proxy. The JS-based approach keeps the "uninstall =
  fully back to normal" property.

### 3.4 Daily-usage dashboard
- Popup: today's total + top-domains (the frontend of tracking);
- Remaining time per configured site (progress bar);
- "Block now" (hard block without waiting for the budget) — free;
- Adding sites: via the form or right-click → "Add this site to Curfew" —
  free;
- **Protected mode** (optional): instead of a password, RELAXING the rules
  asks you to solve a challenge first — a multi-term equation with brackets
  (5-7 terms, random every time, integer answer) or a 15-puzzle: disabling
  a site or the app, raising a budget or the passes limit, removes, import.
  **Tightening stays free** (Block now, lower budgets), and so do adding
  sites and planned 15-minute passes. The friction IS the lock — deliberate
  by design.
- Global daily cap on 15-min passes across all sites (default 3,
  0 = none).

The model is deliberately two-way: either you play by the rules (budget +
passes), or you consciously opt out (disable the site or the whole app —
both password-gated). No in-between "allow today" loophole.

### 3.5 Anti-circumvention posture (honest, not paranoid)
- The "stay anyway" escape exists ON PURPOSE. A tool that only stops you
  when you allow it to stop you has zero long-term effect; a tool with NO
  escape feeds the habit of disabling the extension.
- The 15-minute window is logged into usage and shown in the popup
  ("you added 15m twice today"). Renaming the site in another tab is
  visible next day in the dashboard — the dashboard is the real feedback
  loop.
- v1 deliberately does NOT block `chrome://` extensions page, devtools,
  incognito, or other browsers. Be honest in the README: this is a habit
  tool, not a lock.

### 3.6 Export / import
- Config + usage history export to JSON (one file);
- Import restores it. Versioned schema (see §4) so future formats can
  migrate.

## 4. Architecture (Chrome MV3)

> Deep technical specification — full stack, module contracts, algorithms,
> DNR rule lifecycle, testing: **[docs/TECHNICAL_DESIGN.md](docs/TECHNICAL_DESIGN.md)**.
> Where details differ, the tech doc wins; this section stays the summary.

```
curfew-extension/
  manifest.json
  docs/                      # technical design doc (see §4 intro)
  icons/                     (#16/32/48/128 — later, M3)
  _locales/                  # en, ru — strings only in UI
  src/
    service-worker.js        # event-driven core (see below)
    blocked.html/.js/.css    # the Curfew page
    popup.html/.js/.css      # the dashboard
    options.html/.js/.css    # settings + budgets editor
    common/
      time.js                # day key, minutes helpers (pure, testable)
      patterns.js            # pattern → URL match (pure, testable)
      budget.js              # open/closed decision, state machine (pure)
      storage.js             # typed storage wrapper + migrations
  tests/                     # node --test for common/*.js + invariants
  package.json               # no build step for v1: tests/runner only
  README.md
```

### 4.1 Service worker (no build, vanilla JS)
Event-driven only; no timers that must survive sleep (storage persists,
SW restarts on events):

| Event | Action |
|---|---|
| `tabs.onUpdated` / `onActivated` + `windows.onFocusChanged` | compute current tracked pattern — `tab.url` is visible ONLY for hosts the user granted (browser-enforced); the events themselves need no `tabs` permission |
| `chrome.idle.onStateChanged` (idle 60s) | stop/start counting |
| `chrome.alarms` (every 5 min) | flush usage; daily reset at local midnight; re-check the still-open tab — if it hit its budget while sitting on it → add block rule + redirect it (covers the "tab was already open" gap) |
| `chrome.permissions` (optional per-site host access) | one prompt per site the user adds (see §4.3) |
| DNR dynamic rules | budget exhausted → request-level redirect to `blocked.html`; rule removed on reset / "allow rest of day" (see §4.4) |

### 4.2 Data model (storage.local, versioned under one key)

> Orientation copy. The authoritative schema (per-pattern `unblocks`,
> `session` for SW-restart recovery, `runtime` for unblock windows) is
> tech doc §6.1.
```jsonc
{
  "schema": 1,
  "config": {
    "masterEnabled": true,
    "graceSeconds": 10,
    "unblockMinutes": 15,
    "items": [
      { "id": "u1", "pattern": "*.reddit.com",
        "budgetMinutes": 30, "enabled": true }
      // pattern grammar: hostname with optional leading *.
      // No port/path in v1.
    ]
  },
  "usage": {
    "days": {
      "2026-09-02": {
        "patternSeconds": { "*.reddit.com": 772 },
        "unblocks": 1,
        "bySite": { "reddit.com": 772 }   // resolved site for dashboard
      }
    }
  },
  "settings": { "version": 1 }
}
```
- Day key = local date at first write of the day (`YYYY-MM-DD` based on
  the local timezone; DST handled by comparing `date` hour-by-hour).
- `storage.local` quota (10MB) is enough for years of one-day rows; prune
  > 60 days on import/reset (default keep 60).
- Timezone change: cap on the current day's totals (the day is local by
  definition; a travel across timezones can only shorten the day, and the
  daily reset recomputes).

### 4.3 Permissions ("zero-warning + per-site consent" — the design)

Manifest permissions (all SILENT: the browser shows no install warnings):

```jsonc
"permissions": [
  "storage",                        // budgets + usage, local only
  "idle",                           // active-time detection (idle 60s)
  "alarms",                         // flush, midnight reset, open-tab re-check
  "declarativeNetRequestWithHostAccess",  // request-level redirects; no
                                          // implicit host access, no warning
  "contextMenus"                    // right-click "Add this site to Curfew"
],
"optional_host_permissions": ["*://*/*"]  // nothing granted at install
```

Deliberately NOT present (this is the positioning, verified against
Chrome docs):
- no `tabs` — no history/URL visibility as a blanket (url/title/favIcon
  are only present for hosts the user granted — browser-enforced);
- no static `host_permissions` / `<all_urls>` — no "read and change all
  your data" warning, ever;
- no `webNavigation`, `scripting`, `cookies`, `notifications`,
  `identity`, `unlimitedStorage`.

Per-site consent model — the only way access ever grows:
1. User adds a site in popup/options → `chrome.permissions.request`
   (must come from an extension page with a user gesture — by design)
   for that site's pattern, e.g. `*://*.reddit.com/*`;
2. Grant = DNR rules for that site activate + `tab.url` becomes readable
   for that host (and only that host — browser-enforced);
3. Deny = item stays in config marked "no access", nothing tracked;
4. Revoke = chrome://extensions → site access removed → rule removed,
   data for it can stay or be wiped (options toggle).

Note on `chrome.tabs.update`/`reload`/`create`: per the tabs API docs
these need NO permission at all — so the fallback redirect (and the
alarm re-check) require nothing extra.

Onboarding copy: "Curfew sees only the sites you add. Data never leaves
your browser. Uninstall = gone."

### 4.4 Blocking mechanics (decision: declarativeNetRequest dynamic rules)

- Enforcement is **declarative**: when a budget hits zero (or "block
  now"), the service worker adds one dynamic rule:
  `redirect → extensionPath "/src/blocked.html"`, `main_frame`,
  condition mapped from `common/patterns.js` (`||domain/` for wildcard
  patterns, anchored filter for exact ones — the mapping is pure and
  tested). The browser enforces it at the request boundary: no flash of
  the site, no race, works even while the SW is asleep.
- The rule exists only while the item is "closed": removed on midnight
  reset and on "allow rest of day". Positivity is structural — the wall
  comes down by itself.
- "Stay anyway" (15-min window, §3.5) is not a DNR hack: the SW owns the
  decision and simply doesn't have the rule installed while the window is
  open; the alarm re-adds it at the exact expiry.
- `blocked.html` must be listed in `web_accessible_resources` (required
  for DNR redirect to an extension path). It is the ONLY resource
  exposed; it contains local display + bundled JS, no remote anything.
- Fallback if DNR is ever unusable: `chrome.tabs.update` redirect (no
  permission needed per tabs API docs; slower, flashy — not the default).
- Known gap, documented: in-page SPA routing (site-internal path
  changes) does not fire a network request, so DNR never sees it. Before
  the budget that's irrelevant; after it, the still-open tab is caught
  by the 5-min alarm re-check, and every subsequent navigation bounces
  at request level.

## 5. Milestones

| M | What | Acceptance |
|---|---|---|
| **M0** | Skeleton: manifest v3 (§4.3 permission set), popup w/ add-current-tab, options page w/ pattern+budget editor, local storage wrapper | loads unpacked; add `x.com` → permission prompt → appears in both pages; no crashes |
| **M1** | Tracker + quota + interstitial | 10 min on reddit → wall at budget-0; grace does not count; idle pauses counting; midnight reset; "add side note" not yet |
| **M2** | Dashboard (daily totals, per-site bars, unblock counter) + export/import + usage pruning | popup shows yesterday vs today; export→import round-trip |
| **M3** | Store package: icons, screenshots (3), privacy policy page, listing copy, review checklist (permissions, offstore repo, no tracking), publish | appears in store, installs, works |
| **M4+** | Ideas: weekday-aware budgets; path rules; per-site "blocked until" button; optional sync via file; Firefox WebExtension port; stats export CSV |

v1 = M0..M2 as the personal product; M3 once you are happy.

## 6. Design principles (all future code reads against them)

1. **The user trusts the tool; the tool never trusts the user's impulse.**
   Rules are read from storage at decision time; the blocked page is
   served from the extension itself (`chrome.runtime.getURL`), never a
   remote page.
2. **No build step.** Vanilla JS. Small codebase (~1.5-2k LOC total) —
   can be reviewed by a human in one sitting; 5 years later it still
   builds with nothing.
3. **Pure logic separate from chrome APIs** (`common/*` has no chrome
   import) — `node --test` covers time/day/pattern/budget decision; a
   DOM/db harness is not needed for v1.
4. **Honesty surfaces**: the "stay anyway" button, the unblock counter,
   the "extension can be disabled by design" note in the README. No
   fake-hard-to-get-around; the feedback loop is the product.
5. **New features only if they survive the "would I still use this in a
   year" test.** No gamification, no streaks, no notifications — those
   become the distraction.
6. **No network layer, ever.** No `fetch`, no XHR, no external scripts
   (default MV3 CSP blocks remote code anyway — keep it that way), no
   update polls, no error reporting. The only "bytes out" in the whole
   extension is the user-initiated export file.

## 7. Privacy policy (v1, to ship in store)

- No data leaves the browser. No accounts, no sync, no external calls,
  no analytics, no error reporting, no remote code (default MV3 CSP).
- Data lives in `chrome.storage.local` until you export/import manually;
  no permission asks for anything else while you use it.
- At install: zero browser warnings. The extension can access a site
  only after you add it and agree to the prompt (see §4.3) — the whole
  permission surface is visible in that prompt and revocable in
  chrome://extensions.
- Uninstalling deletes everything (the extension has no external copy).

## 8. Competition / references (what was studied; what to improve)

- **LeechBlock NG** (MPL-2.0): the quota reference; user found the UX
  dated; we take the *semantics* (daily per-site quota), improve the
  dashboard and honesty surfaces.
- **Detox-Extension** (Apache-2.0): dashboard layout reference; we differ
  on scope (no YouTube/IG feed surgery in v1 — that is 2x the surface).
- **WasteNoTime** (source no longer public): the cautionary tale —
  a quota tool whose source disappeared. Our repo stays public.
- **HabitLab** (GPL-3.0, Stanford): the "interventions" idea; not a
  direct competitor because the product is an experiment lab.

## 9. Naming backstop

If `curfew` fails a name check (store / npm scope / GitHub):
- **Recess** (calmer, "break" flavor);
- **Curb** (action-flavored, generic word — highest collision risk);
- **Keep** — verdict: pick one quickly, the extension name inside the
  code is one constant in `manifest.json` and `package.json`.

## 10. Dev workflow

- Load: chrome://extensions → Developer mode → Load unpacked →
  `curfew-extension/`.
- Tests & lint: `npm test` (runs ESLint then `node --test`; dev-only deps,
  nothing of them ships in the extension package).
- Git: init the repo from this folder on day one (this README is the
  project doc; fix it upstream, don't fork).
- Store later: M3 checklist includes verified developer email, package
  zip, 2-3 screenshots, the privacy policy text from §7.
