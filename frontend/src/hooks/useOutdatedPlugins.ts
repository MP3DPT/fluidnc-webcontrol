import { useEffect, useState } from 'react';
import type { PluginInfo } from '../types';
import { isNewerVersion } from '../version';

// Same public index PluginsManagerPanel already browses/installs from - see
// that file's own PLUGIN_INDEX_URL for the "why this repo, not an open
// marketplace" reasoning. Fetched independently here rather than sharing
// PluginsManagerPanel's in-flight fetch, since this hook needs to work from
// UpdateModal without that panel necessarily being mounted at all - the
// extra request is a small, browser-cached, one-time cost.
const PLUGIN_INDEX_URL = 'https://raw.githubusercontent.com/MP3DPT/fluidnc-webcontrol/master/plugins.json';

export interface OutdatedPlugin {
  id: string;
  name: string;
  version: string;
  download: string;
}

/** Cross-references installed plugins against the community index for
 * UpdateModal's "also update these plugins?" checklist. Silently returns []
 * on any failure (offline Pi, index unreachable) - same "pure nicety, must
 * never block the app" reasoning useLatestAppVersion already follows. */
export function useOutdatedPlugins(plugins: PluginInfo[]): OutdatedPlugin[] {
  const [outdated, setOutdated] = useState<OutdatedPlugin[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(PLUGIN_INDEX_URL)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { plugins?: OutdatedPlugin[] } | null) => {
        if (cancelled || !data?.plugins) return;
        const result: OutdatedPlugin[] = [];
        for (const plugin of plugins) {
          const entry = data.plugins.find((e) => e.id === plugin.manifest.id);
          if (entry && isNewerVersion(entry.version, plugin.manifest.version)) result.push(entry);
        }
        setOutdated(result);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [plugins]);

  return outdated;
}
