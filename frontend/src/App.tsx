import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, ChevronDown, FolderOpen, Info, ListChecks, Maximize, Maximize2, Minimize2, Puzzle, ScrollText, Settings as SettingsIcon, Terminal, Trash2, TriangleAlert, Wrench } from 'lucide-react';
import { useSocket } from './hooks/useSocket';
import type { PluginInfo } from './types';
import { parseToolpath, xyBoundsOf } from './gcode/parseToolpath';
import { renderThumbnail } from './gcode/renderThumbnail';
import { extractMetadata, formatMetadataSummary } from './gcode/extractMetadata';
import { currentPassAt, elapsedSecondsAt, estimateTiming, formatDuration } from './gcode/estimateTime';
import { Header } from './components/Header';
import { ConnectPanel } from './components/ConnectPanel';
import { StatusPanel } from './components/StatusPanel';
import { JogPanel } from './components/JogPanel';
import { ActionsPanel } from './components/ActionsPanel';
import { PluginPanels } from './components/PluginPanels';
import { PluginsManagerPanel } from './components/PluginsManagerPanel';
import { ToolsPanel } from './components/ToolsPanel';
import { PluginToolDialog } from './components/PluginToolDialog';
import { AppSettingsPanel } from './components/AppSettingsPanel';
import { AboutPanel } from './components/AboutPanel';
import { UpdateModal } from './components/UpdateModal';
import { ProgramPanel } from './components/ProgramPanel';
import { LogsPanel } from './components/LogsPanel';
import { APP_VERSION, useLatestAppVersion } from './version';
import { ToolpathPreview3D, type ToolpathPreviewHandle } from './components/ToolpathPreview3D';
import { ConsolePanel } from './components/ConsolePanel';
import { FileManagerPanel } from './components/FileManagerPanel';
import { Tabs } from './components/Tabs';
import { Card, CardHeader, CardContent } from './components/ui/Card';
import { Badge } from './components/ui/Badge';
import { IconButton } from './components/ui/IconButton';
import { Switch } from './components/ui/Switch';
import { Sidebar } from './components/ui/Sidebar';
import { Drawer } from './components/ui/Drawer';
import './App.css';

const GCODE_EXTENSIONS = /\.(nc|gcode|tap|txt|cnc)$/i;

// A display-only preference (which side of the grid the toolpath renders
// on), not machine state - localStorage is the right home for it, not the
// backend settings store, since it's purely how this browser likes to look.
const TOOLPATH_ABOVE_GRID_KEY = 'fluidnc.toolpathAboveGrid';

export default function App() {
  const {
    wsReady,
    connectionOpen,
    isHomed,
    status,
    workPosition,
    ports,
    log,
    lastProbeResult,
    programStatus,
    settings,
    machineRates,
    fluidncSettings,
    plugins,
    backendLog,
    updateStatus,
    send,
    invokePluginAction,
    clearConsole,
  } = useSocket();
  const controlsDisabled = !connectionOpen;
  // Park additionally needs soft limits enabled and max travel configured -
  // see connection.ts's park() for why (both are what stop a miscalculated
  // corner from being a real crash risk instead of just a refused move).
  const parkReady = fluidncSettings !== null && fluidncSettings['$20'] === 1 && !!fluidncSettings['$130'] && !!fluidncSettings['$131'];
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const programRunning = programStatus.state === 'running';
  const latestAppVersion = useLatestAppVersion();

  const [fileName, setFileName] = useState<string | null>(null);
  const [gcodeText, setGcodeText] = useState('');
  const segments = useMemo(() => parseToolpath(gcodeText), [gcodeText]);
  const timing = useMemo(() => estimateTiming(segments, machineRates), [segments, machineRates]);
  const elapsedSeconds = useMemo(
    () => elapsedSecondsAt(segments, timing, programStatus.sent),
    [segments, timing, programStatus.sent],
  );
  const currentPass = useMemo(
    () => currentPassAt(segments, programStatus.sent),
    [segments, programStatus.sent],
  );
  const metadataSummary = useMemo(() => formatMetadataSummary(extractMetadata(gcodeText)), [gcodeText]);

  // Duplicates ProgramPanel's own percent/isActive - deliberately, so this
  // big at-a-glance readout over the Toolpath view (see jobProgressOverlay
  // below) doesn't need ProgramPanel to lift state up just to share it.
  // ProgramPanel keeps the detailed line-count/pass-count text; this is
  // just the two numbers someone glances at from across the room.
  const jobActive = programStatus.state === 'running' || programStatus.state === 'paused';
  const jobPercent = programStatus.total > 0 ? Math.round((programStatus.sent / programStatus.total) * 100) : 0;

  // Every load path (the button, double-click, drag-drop, File Manager)
  // funnels through here on purpose - it's the one place that must refuse
  // to load while a program is running/paused. The backend's own runner.load()
  // refuses too, but by then the UI has already swapped to the new file's
  // name/toolpath while the old one may still be streaming - catching it
  // here keeps what's displayed honest even before the backend responds.
  const applyLoadedFile = (name: string, text: string) => {
    if (programStatus.state === 'running' || programStatus.state === 'paused') {
      window.alert('A program is currently running - stop it before loading a new file.');
      return;
    }
    setFileName(name);
    setGcodeText(text);
    send({ type: 'loadProgram', name, gcode: text });
  };

  // A heads-up, not a load-blocking safety check - the spoilboard size is
  // optional (0 = not configured, see AppSettingsPanel's Working Area
  // section) and even an oversized job might be intentional (e.g. only part
  // of it actually needs to fit). Keyed on `segments` (not just on load) and
  // on the spoilboard settings themselves, so this re-evaluates live if the
  // user tweaks the working area size with a file already loaded, instead
  // of only catching it on the next load. Rendered as a banner over the
  // Toolpath preview rather than a blocking window.alert, so it stays
  // visible without needing to be dismissed.
  const [boundaryWarning, setBoundaryWarning] = useState<string | null>(null);
  useEffect(() => {
    const width = settings?.general.spoilboardWidth ?? 0;
    const height = settings?.general.spoilboardHeight ?? 0;
    const bounds = width > 0 || height > 0 ? xyBoundsOf(segments) : null;
    if (!bounds) {
      setBoundaryWarning(null);
      return;
    }
    const sides: string[] = [];
    if (width > 0) {
      if (bounds.minX < 0) sides.push('X-');
      if (bounds.maxX > width) sides.push('X+');
    }
    if (height > 0) {
      if (bounds.minY < 0) sides.push('Y-');
      if (bounds.maxY > height) sides.push('Y+');
    }
    setBoundaryWarning(sides.length > 0 ? `Toolpath exceeds the working area at ${sides.join(', ')}` : null);
  }, [segments, settings?.general.spoilboardWidth, settings?.general.spoilboardHeight]);

  // Centralized so every way of picking a local file - the Program panel's
  // button, double-clicking the toolpath preview, or dragging a file onto
  // the window - all go through the same load path, and all land in the
  // File Manager's library automatically. A failed save is a background
  // nicety, not something that should block actually running the file.
  const loadFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      applyLoadedFile(file.name, text);
      const thumbnail = renderThumbnail(parseToolpath(text));
      const metadata = extractMetadata(text);
      fetch('/api/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, gcode: text, thumbnail, metadata }),
      }).catch(() => {});
    };
    reader.readAsText(file);
  };

  // A file loaded from the library is already saved there - re-loading it
  // shouldn't create a duplicate entry.
  const loadFromLibrary = (name: string, gcode: string) => {
    applyLoadedFile(name, gcode);
    setActivePanel(null);
  };

  const clearFile = () => {
    setFileName(null);
    setGcodeText('');
    send({ type: 'clearProgram' });
  };

  const toolpathFileInputRef = useRef<HTMLInputElement>(null);
  const toolpathRef = useRef<ToolpathPreviewHandle>(null);
  const dragCounter = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const [activePanel, setActivePanel] = useState<string | null>(null);
  const [openToolPlugin, setOpenToolPlugin] = useState<PluginInfo | null>(null);
  // Lives here, not inside LogsPanel itself - the Logs Drawer fully
  // unmounts when closed (see ui/Drawer.tsx's `if (!open) return null`), so
  // state local to LogsPanel was silently forgotten every time the drawer
  // closed, making "Clear" reappear-on-reopen instead of actually staying
  // cleared for the rest of the browser session (confirmed the hard way -
  // clicking Home to reach the Actions panel closes the Logs drawer first).
  // Backend log history itself still survives a real page reload either
  // way, by design (see LogsPanel's own comment) - only this filter resets.
  const [logsClearedAt, setLogsClearedAt] = useState(0);
  const [toolpathViewOpen, setToolpathViewOpen] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [consoleExpanded, setConsoleExpanded] = useState(false);
  const [toolpathAboveGrid, setToolpathAboveGrid] = useState(
    () => localStorage.getItem(TOOLPATH_ABOVE_GRID_KEY) !== 'false',
  );
  useEffect(() => {
    localStorage.setItem(TOOLPATH_ABOVE_GRID_KEY, String(toolpathAboveGrid));
  }, [toolpathAboveGrid]);

  // Stable reference across renders (not a fresh object literal every time) -
  // PluginToolDialog's postCoreState effect depends on this, and a new
  // object identity on every unrelated App re-render (WS traffic arrives
  // constantly) would re-fire it with whatever `plugin.config` currently is,
  // which can still be a render behind the just-persisted optimistic update
  // in the dialog's own iframe and stomp it back to stale data.
  const workingArea = useMemo(
    () => ({ width: settings?.general.spoilboardWidth ?? 0, height: settings?.general.spoilboardHeight ?? 0 }),
    [settings?.general.spoilboardWidth, settings?.general.spoilboardHeight],
  );

  return (
    <>
      <Sidebar
        items={[
          { key: 'files', icon: <FolderOpen size={22} />, label: 'Files' },
          { key: 'tools', icon: <Wrench size={22} />, label: 'Tools' },
          { key: 'plugins', icon: <Puzzle size={22} />, label: 'Plugins' },
          { key: 'settings', icon: <SettingsIcon size={22} />, label: 'Settings' },
          { key: 'logs', icon: <ScrollText size={22} />, label: 'Logs' },
        ]}
        footerItems={[{ key: 'about', icon: <Info size={22} />, label: 'About' }]}
        version={`v${APP_VERSION}`}
        updateAvailable={latestAppVersion !== null}
        active={activePanel}
        onSelect={(key) => setActivePanel((prev) => (prev === key ? null : key))}
      />

      <Drawer open={activePanel === 'files'} title="File Manager" onClose={() => setActivePanel(null)}>
        <FileManagerPanel onLoad={loadFromLibrary} />
      </Drawer>

      <Drawer open={activePanel === 'logs'} title="Logs" onClose={() => setActivePanel(null)}>
        <LogsPanel
          log={backendLog}
          connectionOpen={connectionOpen}
          status={status}
          programStatus={programStatus}
          settings={settings}
          plugins={plugins}
          clearedAt={logsClearedAt}
          onClear={() => setLogsClearedAt(Date.now())}
        />
      </Drawer>

      <Drawer open={activePanel === 'tools'} title="Tools" onClose={() => setActivePanel(null)}>
        <ToolsPanel
          plugins={plugins}
          onOpen={(plugin) => {
            setOpenToolPlugin(plugin);
            setActivePanel(null);
          }}
        />
      </Drawer>

      <Drawer open={activePanel === 'plugins'} title="Plugins" onClose={() => setActivePanel(null)}>
        <PluginsManagerPanel plugins={plugins} send={send} />
      </Drawer>

      <Drawer open={activePanel === 'settings'} title="Settings" onClose={() => setActivePanel(null)}>
        <AppSettingsPanel settings={settings} send={send} connectionOpen={connectionOpen} fluidncSettings={fluidncSettings} />
      </Drawer>

      <Drawer open={activePanel === 'about'} title="About" onClose={() => setActivePanel(null)}>
        <AboutPanel latestVersion={latestAppVersion} onOpenUpdate={() => setUpdateModalOpen(true)} />
      </Drawer>

      {openToolPlugin && (
        <PluginToolDialog
          plugin={openToolPlugin}
          onClose={() => setOpenToolPlugin(null)}
          send={send}
          invokePluginAction={invokePluginAction}
          onLoadGcode={applyLoadedFile}
          workingArea={{ width: settings?.general.spoilboardWidth ?? 0, height: settings?.general.spoilboardHeight ?? 0 }}
        />
      )}

      {updateModalOpen && latestAppVersion && (
        <UpdateModal
          latestVersion={latestAppVersion}
          plugins={plugins}
          settings={settings}
          updateStatus={updateStatus}
          jobActive={programStatus.state === 'running' || programStatus.state === 'paused'}
          onClose={() => setUpdateModalOpen(false)}
        />
      )}

      <div
        className={`app ${isDragging ? 'drag-active' : ''}`}
      onDragEnter={(e) => {
        e.preventDefault();
        dragCounter.current += 1;
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        dragCounter.current -= 1;
        if (dragCounter.current <= 0) setIsDragging(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        dragCounter.current = 0;
        setIsDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file && GCODE_EXTENSIONS.test(file.name)) loadFile(file);
      }}
    >
      {isDragging && (
        <div className="drop-overlay">
          <p>Drop G-code file to load</p>
        </div>
      )}

      <input
        ref={toolpathFileInputRef}
        type="file"
        accept=".nc,.gcode,.tap,.txt,.cnc"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) loadFile(file);
          e.target.value = '';
        }}
      />

      <Header
        wsReady={wsReady}
        connectionOpen={connectionOpen}
        status={status}
        programRunning={programRunning}
        send={send}
      />

      <main>
        <div className="column">
          <ConnectPanel ports={ports} connectionOpen={connectionOpen} wsReady={wsReady} send={send} />
          <StatusPanel status={status} />
          <ActionsPanel
            disabled={controlsDisabled}
            estopActive={connectionOpen}
            needsHoming={connectionOpen && !isHomed}
            send={send}
          />
          <PluginPanels
            plugins={plugins}
            column="left"
            connectionOpen={connectionOpen}
            lastProbeResult={lastProbeResult}
            send={send}
            invokePluginAction={invokePluginAction}
          />
        </div>
        <div className="column wide">
          <Card>
            <CardHeader
              actions={
                <div className="toolpath-view-controls">
                  <button aria-label="Fit view to toolpath" title="Fit view to toolpath" onClick={() => toolpathRef.current?.resetView()}>
                    <Maximize size={14} />
                    Fit
                  </button>
                  <IconButton
                    aria-label="Toolpath display options"
                    title="Toolpath display options"
                    onClick={() => setToolpathViewOpen((v) => !v)}
                  >
                    <ChevronDown size={16} />
                  </IconButton>
                  {toolpathViewOpen && (
                    <div className="dropdown-panel right">
                      <Switch
                        checked={toolpathAboveGrid}
                        onChange={setToolpathAboveGrid}
                        label={toolpathAboveGrid ? 'Showing job above grid' : 'Showing job below grid'}
                      />
                    </div>
                  )}
                </div>
              }
            >
              <Box size={14} />
              Toolpath
            </CardHeader>
            <CardContent className="toolpath-content">
              <div
                className="toolpath-canvas-host"
                onDoubleClick={() => toolpathFileInputRef.current?.click()}
                title="Double-click to load a G-code file"
              >
                <ToolpathPreview3D
                  ref={toolpathRef}
                  segments={segments}
                  currentPosition={workPosition}
                  sentLines={programStatus.sent}
                  aboveGrid={toolpathAboveGrid}
                  spoilboardWidth={settings?.general.spoilboardWidth ?? 0}
                  spoilboardHeight={settings?.general.spoilboardHeight ?? 0}
                />
                {boundaryWarning && (
                  <div className="boundary-warning-overlay">
                    <TriangleAlert size={16} />
                    <div>
                      <strong>
                        Job Info <Badge tone="warning">Warning</Badge>
                      </strong>
                      <p className="hint">{boundaryWarning}</p>
                    </div>
                  </div>
                )}
                {jobActive && (
                  <div className="job-progress-overlay">
                    <div className="job-progress-percent">{jobPercent}%</div>
                    <div className="job-progress-remaining">
                      {formatDuration(timing.totalSeconds - elapsedSeconds)} left
                    </div>
                  </div>
                )}
              </div>
              <div className="toolpath-legend">
                <span>Drag to orbit, scroll to zoom, right-drag to pan</span>
                <span className="legend-swatch" style={{ color: 'var(--primary)' }}>
                  pending
                </span>
                <span className="legend-swatch" style={{ color: 'var(--success)' }}>
                  done
                </span>
                <span className="legend-swatch" style={{ color: 'var(--text-muted)' }}>
                  rapid
                </span>
              </div>
              <p className="hint">Double-click the preview, or drag a file anywhere onto the window, to load it.</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <Tabs
                tabs={[
                  {
                    key: 'program',
                    label: (
                      <>
                        <ListChecks size={14} />
                        Program
                      </>
                    ),
                    content: (
                      <ProgramPanel
                        fileName={fileName}
                        metadataSummary={metadataSummary}
                        programStatus={programStatus}
                        timing={timing}
                        elapsedSeconds={elapsedSeconds}
                        currentPass={currentPass}
                        hasMachineRates={machineRates !== null}
                        disabled={controlsDisabled || updateStatus.status === 'running'}
                        onFileSelected={loadFile}
                        onClear={clearFile}
                        send={send}
                      />
                    ),
                  },
                  {
                    key: 'console',
                    label: (
                      <>
                        <Terminal size={14} />
                        Console
                      </>
                    ),
                    actions: (
                      <div className="row console-tab-actions">
                        <Switch
                          size="sm"
                          tone="success"
                          labelPosition="start"
                          checked={autoScroll}
                          onChange={setAutoScroll}
                          label="Auto-scroll"
                        />
                        <IconButton
                          aria-label="Clear console"
                          title="Clear console"
                          onClick={clearConsole}
                          disabled={log.length === 0}
                        >
                          <Trash2 size={14} />
                        </IconButton>
                        <IconButton
                          aria-label={consoleExpanded ? 'Collapse console' : 'Expand console'}
                          title={consoleExpanded ? 'Collapse console' : 'Expand console'}
                          onClick={() => setConsoleExpanded((v) => !v)}
                        >
                          {consoleExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                        </IconButton>
                      </div>
                    ),
                    content: (
                      <ConsolePanel
                        log={log}
                        disabled={controlsDisabled}
                        autoFeedEnabled={settings?.general.consoleAutoFeedEnabled ?? true}
                        defaultFeed={settings?.general.consoleDefaultFeed ?? 300}
                        autoScroll={autoScroll}
                        expanded={consoleExpanded}
                        send={send}
                      />
                    ),
                  },
                ]}
              />
            </CardContent>
          </Card>
        </div>
        <div className="column">
          <JogPanel
            disabled={controlsDisabled}
            parkReady={parkReady}
            machineState={status?.state ?? null}
            isHomed={isHomed}
            workPosition={workPosition}
            settings={settings}
            send={send}
          />
          <PluginPanels
            plugins={plugins}
            column="right"
            connectionOpen={connectionOpen}
            lastProbeResult={lastProbeResult}
            send={send}
            invokePluginAction={invokePluginAction}
          />
        </div>
      </main>
      </div>
    </>
  );
}
