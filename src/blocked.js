import { load } from "./common/storage.js";
import { dayKey } from "./common/time.js";
import { parsePattern, matchesHost } from "./common/patterns.js";
import { secondsUsedToday, passesLeftToday } from "./common/budget.js";
import { guarded } from "./protect.js";

const msg = (key) => chrome.i18n.getMessage(key);

for (const el of document.querySelectorAll("[data-i18n]")) {
  el.textContent = msg(el.dataset.i18n);
}

const domain = new URLSearchParams(location.search).get("domain");

if (!domain) {
  document.getElementById("actions").hidden = true;
} else {
  document.getElementById("domain").textContent = domain;
  init(domain).catch((error) => {
    if (String(error?.message).includes("context invalidated")) {
      location.reload();
      return;
    }
    console.error("curfew: blocked page failed", error);
  });
}

async function init(domain) {
  const state = await load();
  const item = state.config.items.find((i) => {
    const parsed = parsePattern(i.pattern);
    return parsed.ok && matchesHost(parsed.pattern, domain);
  });
  if (!item) return;

  const day = dayKey();
  const used = secondsUsedToday(state, item.pattern, day);
  const left = passesLeftToday(state, day, state.config.unblockPassesPerDay);

  document.getElementById("used").textContent =
    `${msg("usedTodayLabel")} ${Math.round(used / 60)} ${msg("minutesShort")}`;
  document.getElementById("passes").textContent = `${msg("passesLeftLabel")} ${left}`;

  const stay = document.getElementById("stay");
  if (left <= 0) {
    stay.disabled = true;
    document.getElementById("hint").textContent = msg("limitReached");
  }

  stay.addEventListener("click", async () => {
    stay.disabled = true;
    let response;
    const done = await guarded(async () => {
      try {
        response = await chrome.runtime.sendMessage({
          type: "unblock:request",
          itemId: item.id,
        });
      } catch {
        response = null;
      }
      return Boolean(response?.ok);
    });
    if (done && response?.ok) {
      location.href = `https://${domain}/`;
    } else if (response?.reason === "limit") {
      stay.disabled = true;
      document.getElementById("hint").textContent = msg("limitReached");
    } else if (!done) {
      stay.disabled = false;
    } else {
      stay.disabled = false;
      document.getElementById("hint").textContent = msg("unblockFailed");
    }
  });
}
