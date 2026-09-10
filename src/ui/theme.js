/**
 * The stored colour-scheme choice. "system" deliberately does nothing here:
 * theme.css already answers `prefers-color-scheme`, so the default works
 * before any script runs and a light-mode user never sees a dark flash.
 * @param {{ settings?: { theme?: string } } | null} state
 */
export function applyTheme(state) {
  const theme = state?.settings?.theme;
  const root = document.documentElement;
  if (theme === "light" || theme === "dark") root.dataset.theme = theme;
  else delete root.dataset.theme;
}
