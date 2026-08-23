import { useEffect, useRef, useState } from 'react';
import { MonitorPlay } from 'lucide-react';
import { Card, CardHeader, CardContent } from './ui/Card';
import type { PluginInfo, ProbeResult } from '../types';

interface Props {
  plugins: PluginInfo[];
  column: 'left' | 'right';
  connectionOpen: boolean;
  lastProbeResult: ProbeResult | null;
  send: (message: Record<string, unknown>) => void;
  invokePluginAction: (pluginId: string, actionId: string, params?: unknown) => Promise<unknown>;
}

interface PanelProps {
  plugin: PluginInfo;
  connectionOpen: boolean;
  lastProbeResult: ProbeResult | null;
  send: (message: Record<string, unknown>) => void;
  invokePluginAction: (pluginId: string, actionId: string, params?: unknown) => Promise<unknown>;
}

/**
 * One plugin's on-dashboard iframe, plus the postMessage bridge that lets it
 * stay live like a real dashboard card instead of a static, isolated embed:
 *
 *  parent -> iframe: "coreState" (connectionOpen + this plugin's own config,
 *    re-sent whenever either changes) and "probeResult" (so a probe run from
 *    a *different* open browser tab still shows up here).
 *  iframe -> parent: "invokeAction" (runs one of this plugin's registered
 *    backend actions and replies with "actionResult"/"actionError",
 *    correlated by the request's own requestId), "updateSettings" (patches
 *    this plugin's settings bag same as the Settings modal would), and
 *    "contentHeight" (the panel reports its own natural height so the
 *    iframe can size to it exactly, instead of a fixed video-shaped box).
 *
 * Deliberately per-origin-checked (same-origin only) even though the
 * sandbox already restricts the iframe - postMessage has no implicit origin
 * scoping of its own.
 */
function PluginPanel({ plugin, connectionOpen, lastProbeResult, send, invokePluginAction }: PanelProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const origin = window.location.origin;

  const postCoreState = () => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'coreState', connectionOpen, config: plugin.config },
      origin,
    );
  };

  useEffect(() => {
    postCoreState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionOpen, plugin.config]);

  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage({ type: 'probeResult', data: lastProbeResult }, origin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastProbeResult]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'invokeAction') {
        invokePluginAction(plugin.manifest.id, msg.actionId, msg.params)
          .then((result) => {
            iframeRef.current?.contentWindow?.postMessage(
              { type: 'actionResult', requestId: msg.requestId, result },
              origin,
            );
          })
          .catch((err) => {
            iframeRef.current?.contentWindow?.postMessage(
              { type: 'actionError', requestId: msg.requestId, error: err instanceof Error ? err.message : String(err) },
              origin,
            );
          });
      } else if (msg.type === 'updateSettings') {
        send({ type: 'updatePluginSettings', pluginId: plugin.manifest.id, settings: msg.settings });
      } else if (msg.type === 'contentHeight' && typeof msg.height === 'number') {
        setHeight(Math.ceil(msg.height));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugin.manifest.id, send, invokePluginAction]);

  return (
    <Card>
      <CardHeader>
        <MonitorPlay size={14} />
        {plugin.manifest.name}
      </CardHeader>
      <CardContent>
        <iframe
          ref={iframeRef}
          src={`/api/plugins/${plugin.manifest.id}/panel`}
          title={plugin.manifest.name}
          // A panel that reports its own height (anything using the bridge
          // above) is form/content-shaped and should blend into the card
          // like native content; one that doesn't (e.g. Webcam Preview,
          // which predates this bridge) keeps the original fixed
          // video-shaped box with its own border.
          className={height === null ? 'plugin-panel-frame' : 'plugin-panel-frame plugin-panel-frame-auto'}
          style={height !== null ? { height } : undefined}
          sandbox="allow-scripts allow-same-origin allow-popups"
          allowFullScreen
          onLoad={postCoreState}
        />
      </CardContent>
    </Card>
  );
}

/**
 * Renders one sandboxed iframe per enabled plugin that declares a manifest
 * "panel" (e.g. a webcam preview, or Z-Probe | Touch Plate) - each iframe is
 * whatever HTML the plugin's own /api/plugins/<id>/panel route returns.
 */
export function PluginPanels({ plugins, column, connectionOpen, lastProbeResult, send, invokePluginAction }: Props) {
  const panels = plugins.filter(
    (p) => p.manifest.panel && p.config.enabled && (p.manifest.panelColumn ?? 'left') === column,
  );
  if (panels.length === 0) return null;

  return (
    <>
      {panels.map((p) => (
        <PluginPanel
          key={p.manifest.id}
          plugin={p}
          connectionOpen={connectionOpen}
          lastProbeResult={lastProbeResult}
          send={send}
          invokePluginAction={invokePluginAction}
        />
      ))}
    </>
  );
}
