# Privacy policy

**Curfew** (the browser extension) · last updated 2026-09-12

**The short version: Curfew collects nothing.** No accounts, no analytics, no telemetry,
no remote code. Everything it knows stays inside your browser, and uninstalling it
deletes that.

## What Curfew stores

- The sites you add, their daily budgets, the patterns you typed, your settings, and the
  active time counted per site.
- All of it lives in `chrome.storage.local`, inside your browser profile.
- There is no server, no database, no sync and no account anywhere else.

## What Curfew does not do

- No analytics, no telemetry, no crash or error reporting.
- No advertising, no trackers, no third-party scripts, no remote code. Manifest V3's
  default content security policy blocks remote code, and the extension never makes a
  network request of its own. That last part is enforced by a test in the repository
  (`tests/invariants.test.js`), not only by intent.
- No reading of your browsing history. Curfew learns that a site exists only when you add
  it yourself.
- Nothing is sold, shared, or handed to a third party, because nothing leaves the
  browser in the first place.

## Permissions and why each one exists

| Permission | Why it is there |
|---|---|
| `storage` | keeps your sites, budgets, settings and counters in the browser profile |
| `declarativeNetRequestWithHostAccess` | blocks a site once its budget is spent, at the network request level |
| `alarms` | re-checks an already open tab, and triggers the reset at local midnight |
| `idle` | stops counting time while you are away from the keyboard |
| `contextMenus` | the "Add this site to Curfew" right-click item |
| `activeTab` | reads the current tab's address when you use that menu item |
| optional host access | asked for one site at a time, only for sites you add, revocable in `chrome://extensions` |

At install Chrome shows **no warnings**: the extension holds no site access until you add
a specific site and accept the prompt for it.

## Export and import

The only bytes that can ever leave your browser are ones you create yourself with Export:
a JSON file Chrome writes to your disk, to a location you choose. Import reads that file
back. No copy is kept anywhere else.

## Deleting your data

Uninstalling the extension deletes its storage. There is no external copy to delete,
because there is no external copy. You can also clear the extension's data from
`chrome://extensions` without uninstalling it.

## Children

Curfew is a general-purpose tool and is not directed at children. It collects no personal
data from anyone.

## Changes to this policy

If this policy changes, the new version is published in this repository with a new date
at the top. Since the extension collects nothing, a change can only be about wording, or
about a new feature that handles data in a new way. Any such feature is described here
before it ships.

## Contact

Questions, or a security report: open an issue at
https://github.com/devacc8/curfew-extension/issues or email devacc8@pm.me.
