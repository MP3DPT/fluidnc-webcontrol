import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { PluginInfo } from '../types';

interface Props {
  plugin: PluginInfo;
  onClose: () => void;
  send: (message: Record<string, unknown>) => void;
  invokePluginAction: (pluginId: string, actionId: string, params?: unknown) => Promise<unknown>;
  /** Same path File Manager and drag-and-drop use (see App.tsx's applyLoadedFile) - keeps the toolpath preview and Program tab filename as a single source of truth, always set by the browser itself rather than a server-side broadcast the frontend doesn't listen for. */
  onLoadGcode: (name: string, gcode: string) => void;
  /** Settings → Working Area (0 means "not configured") - handed to the dialog so a plugin like Surfacing / Facing can offer "use my working area size" without duplicating that setting. */
  workingArea: { width: number; height: number };
}

/**
 * The on-demand counterpart to PluginPanels - a "tool" plugin (manifest
 * "tool": true) isn't glanced at during a job like Z-Probe's panel is, so it
 * has no permanent spot on the dashboard. Opening it from the sidebar's
 * Tools tab renders this modal instead, iframing the plugin's own
 * /api/plugins/<id>/dialog route.
 *
 * Same postMessage bridge as PluginPanel (coreState down, invokeAction +
 * updateSettings up), plus two additions:
 *  - "contentHeight": the dialog reports its own natural height (same
 *    bridge zprobe-touchplate's panel uses) so the iframe sizes to fit
 *    exactly, instead of a fixed height that risks a scrollbar.
 *  - "closeToolDialog": the iframe can ask to be closed - typically right
 *    after successfully generating something and loading it via
 *    "loadGcode" below.
 */
export function PluginToolDialog({ plugin, onClose, send, invokePluginAction, onLoadGcode, workingArea }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const origin = window.location.origin;

  const postCoreState = () => {
    iframeRef.current?.contentWindow?.postMessage({ type: 'coreState', config: plugin.config, workingArea }, origin);
  };

  // Deliberately sent from iframe onLoad only, not also from an effect keyed
  // on [plugin.config, workingArea] - both plugin.config (openToolPlugin is
  // a one-time snapshot, see App.tsx) and workingArea (memoized) are stable
  // for the dialog's whole lifetime, so a mount-time effect send would just
  // be a second, redundant delivery of the identical initial state. Having
  // two independent senders raced in practice: if the effect's copy landed
  // *after* onLoad's, it silently overwrote the iframe's live, just-edited
  // config with the original snapshot the instant a user clicked something
  // quickly after the dialog opened - exactly the "click doesn't stick"
  // symptom this fixes. onLoad alone is sufficient and race-free: it fires
  // once, only once the iframe's document (and its message listener) is
  // actually ready to receive it.

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'invokeAction') {
        invokePluginAction(plugin.manifest.id, msg.actionId, msg.params)
          .then((result) => {
            iframeRef.current?.contentWindow?.postMessage({ type: 'actionResult', requestId: msg.requestId, result }, origin);
          })
          .catch((err) => {
            iframeRef.current?.contentWindow?.postMessage(
              { type: 'actionError', requestId: msg.requestId, error: err instanceof Error ? err.message : String(err) },
              origin,
            );
          });
      } else if (msg.type === 'updateSettings') {
        send({ type: 'updatePluginSettings', pluginId: plugin.manifest.id, settings: msg.settings });
      } else if (msg.type === 'loadGcode' && typeof msg.name === 'string' && typeof msg.gcode === 'string') {
        onLoadGcode(msg.name, msg.gcode);
      } else if (msg.type === 'closeToolDialog') {
        onClose();
      } else if (msg.type === 'contentHeight' && typeof msg.height === 'number') {
        setHeight(Math.ceil(msg.height));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugin.manifest.id, send, invokePluginAction, onClose, onLoadGcode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="tool-dialog-overlay" onClick={onClose}>
      <div className="tool-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="tool-dialog-header">
          <h3>{plugin.manifest.name}</h3>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <iframe
          ref={iframeRef}
          src={`/api/plugins/${plugin.manifest.id}/dialog`}
          title={plugin.manifest.name}
          className="tool-dialog-frame"
          style={height !== null ? { height } : undefined}
          sandbox="allow-scripts allow-same-origin allow-popups"
          onLoad={postCoreState}
        />
      </div>
    </div>
  );
}
