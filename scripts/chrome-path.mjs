/** Shared Chrome executable resolution for dev scripts:
 *  env override -> puppeteer resolution -> newest cache hit. */
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export async function findChrome() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  try {
    const { default: puppeteer } = await import("puppeteer");
    const resolved = puppeteer.executablePath();
    if (existsSync(resolved)) return resolved;
  } catch {
    // not downloaded for the pinned version — fall through to the cache scan
  }
  const cacheDir = join(homedir(), ".cache", "puppeteer", "chrome");
  if (existsSync(cacheDir)) {
    for (const version of readdirSync(cacheDir).sort().reverse()) {
      const candidate = join(cacheDir, version, "chrome-linux64", "chrome");
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}
