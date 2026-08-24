import { useEffect, useState } from 'react';

// Single source of truth - was previously hardcoded separately in the
// Sidebar, AboutPanel, and (still is, necessarily - separate runtime/bundle)
// the backend's own APP_VERSION constant in index.ts.
export const APP_VERSION = '0.3.0';

const GITHUB_LATEST_RELEASE_URL = 'https://api.github.com/repos/MP3DPT/fluidnc-webcontrol/releases/latest';

/** "v0.2.1" > "0.2.0" -> true. Plain major.minor.patch integer comparison - no prerelease/build-metadata handling, since this project doesn't use those. */
export function isNewerVersion(remote: string, local: string): boolean {
  const parts = (v: string) => v.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const r = parts(remote);
  const l = parts(local);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const rv = r[i] ?? 0;
    const lv = l[i] ?? 0;
    if (rv !== lv) return rv > lv;
  }
  return false;
}

export interface LatestAppVersion {
  version: string;
  url: string;
}

/**
 * Checks GitHub's latest release once per page load. Silently gives up on
 * any failure (offline Pi, GitHub unreachable, rate-limited) - same "ignore
 * if no internet" handling Browse already has for the plugin index, and for
 * the same reason: this app must keep working fully offline, an update
 * check is a pure nicety on top.
 */
export function useLatestAppVersion(): LatestAppVersion | null {
  const [latest, setLatest] = useState<LatestAppVersion | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(GITHUB_LATEST_RELEASE_URL)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { tag_name?: string; html_url?: string } | null) => {
        if (cancelled || !data?.tag_name || !isNewerVersion(data.tag_name, APP_VERSION)) return;
        setLatest({ version: data.tag_name.replace(/^v/, ''), url: data.html_url ?? 'https://github.com/MP3DPT/fluidnc-webcontrol/releases' });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return latest;
}
