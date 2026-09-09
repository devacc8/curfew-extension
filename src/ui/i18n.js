/** Page-side i18n helpers. These touch `chrome.i18n`, which is why they live
 *  outside `common/` (whose modules stay chrome-free and unit-testable). */

/** @param {string} key @returns {string} */
export const msg = (key) => chrome.i18n.getMessage(key);

/**
 * Fill every element carrying a `data-i18n*` attribute.
 * @param {ParentNode} [root]
 */
export function applyI18n(root = document) {
  for (const el of /** @type {NodeListOf<HTMLElement>} */ (
    root.querySelectorAll("[data-i18n]")
  )) {
    el.textContent = msg(el.dataset.i18n ?? "");
  }
  for (const el of /** @type {NodeListOf<HTMLInputElement>} */ (
    root.querySelectorAll("[data-i18n-placeholder]")
  )) {
    el.placeholder = msg(el.dataset.i18nPlaceholder ?? "");
  }
  for (const el of /** @type {NodeListOf<HTMLElement>} */ (
    root.querySelectorAll("[data-i18n-title]")
  )) {
    el.title = msg(el.dataset.i18nTitle ?? "");
  }
}
