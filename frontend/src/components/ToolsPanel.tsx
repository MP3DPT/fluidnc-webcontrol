import { Wrench } from 'lucide-react';
import type { PluginInfo } from '../types';

interface Props {
  plugins: PluginInfo[];
  onOpen: (plugin: PluginInfo) => void;
}

/**
 * Lists every enabled "tool" plugin (manifest "tool": true) - one-off
 * generators/wizards configured occasionally, not live dashboard panels -
 * with an Open button that hands off to PluginToolDialog. Disabled tool
 * plugins are enabled from the Plugins tab, same as any other plugin; they
 * don't show up here until then, matching PluginPanels' same filter for
 * dashboard panels.
 */
export function ToolsPanel({ plugins, onOpen }: Props) {
  const tools = plugins.filter((p) => p.manifest.tool && p.config.enabled);

  return (
    <div className="drawer-panel">
      <p className="hint">
        One-off generators and setup wizards - configure, generate, and it loads straight into the Program tab. Install
        more from the Plugins tab.
      </p>

      {tools.length === 0 && (
        <p className="hint">
          No tools enabled yet. Install one from the Plugins tab (e.g. Surfacing / Facing), then enable it there.
        </p>
      )}

      {tools.map((plugin) => (
        <div className="plugin-card" key={plugin.manifest.id}>
          <div className="plugin-card-title-row">
            <strong>{plugin.manifest.name}</strong>
            <div className="plugin-card-actions">
              <button className="primary" onClick={() => onOpen(plugin)}>
                <Wrench size={14} />
                Open
              </button>
            </div>
          </div>
          <p className="hint" style={{ margin: '0.2rem 0 0' }}>
            {plugin.manifest.description}
          </p>
        </div>
      ))}
    </div>
  );
}
