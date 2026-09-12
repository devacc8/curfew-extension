const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const HOST_RE = new RegExp(`^${LABEL}(?:\\.${LABEL})+$`);

/**
 * Grammar: hostname with optional leading "*."; no port/path in storage.
 * Input is tolerant: pasted URLs are normalized. The scheme ("https://",
 * "*://"), path/query/hash and a trailing ":port" are stripped.
 * Returns { ok, pattern: {wildcard, host}, error }.
 */
export function parsePattern(input) {
  if (typeof input !== "string") {
    return { ok: false, pattern: null, error: "not-a-string" };
  }
  let s = input.trim().toLowerCase();
  s = s.replace(/^[a-z0-9*+.-]+:\/\//, "");
  s = s.split(/[/?#]/)[0];
  s = s.replace(/\.$/, "");
  let wildcard = false;
  if (s.startsWith("*.")) {
    wildcard = true;
    s = s.slice(2);
  }
  s = s.replace(/:\d{1,5}$/, "");
  if (s.includes(":")) return { ok: false, pattern: null, error: "port" };
  if (s.includes("/")) return { ok: false, pattern: null, error: "path" };
  if (!HOST_RE.test(s)) return { ok: false, pattern: null, error: "host" };
  return { ok: true, pattern: { wildcard, host: s }, error: null };
}

/** Canonical config form: "*.reddit.com" | "x.com". */
export function patternToString(pattern) {
  return (pattern.wildcard ? "*." : "") + pattern.host;
}

/** Pure grammar decision. wildcard: apex or any subdomain; exact: apex only. */
export function matchesHost(pattern, host) {
  if (typeof host !== "string") return false;
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  if (!HOST_RE.test(h)) return false;
  if (pattern.wildcard) {
    return h === pattern.host || h.endsWith("." + pattern.host);
  }
  return h === pattern.host;
}

/** Mapping for the permissions API (browser match-patterns). */
export function toMatchOrigins(pattern) {
  const host = pattern.wildcard ? "*." + pattern.host : pattern.host;
  return ["*://" + host + "/*"];
}

/** Mapping for DNR rule conditions (request-level semantics). */
export function toDnrCondition(pattern) {
  if (pattern.wildcard) {
    return { urlFilter: "||" + pattern.host + "/" };
  }
  const escaped = pattern.host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return { regexFilter: "^https?://" + escaped + "/" };
}
