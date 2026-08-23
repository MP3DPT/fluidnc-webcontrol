import { MonitorPlay } from 'lucide-react';
import { Card, CardHeader, CardContent } from './ui/Card';
import type { PluginInfo } from '../types';

interface Props {
  plugins: PluginInfo[];
}

/**
 * Renders one sandboxed iframe per enabled plugin that declares a manifest
 * "panel" (e.g. a webcam preview) - each iframe is just whatever HTML the
 * plugin's own /api/plugins/<id>/panel route returns, fully self-contained.
 * Same full-trust model as the rest of the plugin system: no postMessage
 * bridge or restricted API, just same-origin access to hit the plugin's own
 * routes directly.
 */
export function PluginPanels({ plugins }: Props) {
  const panels = plugins.filter((p) => p.manifest.panel && p.config.enabled);
  if (panels.length === 0) return null;

  return (
    <>
      {panels.map((p) => (
        <Card key={p.manifest.id}>
          <CardHeader>
            <MonitorPlay size={14} />
            {p.manifest.name}
          </CardHeader>
          <CardContent>
            <iframe
              src={`/api/plugins/${p.manifest.id}/panel`}
              title={p.manifest.name}
              className="plugin-panel-frame"
              sandbox="allow-scripts allow-same-origin allow-popups"
              allowFullScreen
            />
          </CardContent>
        </Card>
      ))}
    </>
  );
}
