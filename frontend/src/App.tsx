import { useMemo, useRef, useState } from 'react';
import { Box, FolderOpen, ListChecks, RotateCcw, Terminal } from 'lucide-react';
import { useSocket } from './hooks/useSocket';
import { parseToolpath } from './gcode/parseToolpath';
import { renderThumbnail } from './gcode/renderThumbnail';
import { extractMetadata, formatMetadataSummary } from './gcode/extractMetadata';
import { currentPassAt, elapsedSecondsAt, estimateTiming } from './gcode/estimateTime';
import { Header } from './components/Header';
import { SettingsModal } from './components/SettingsModal';
import { ConnectPanel } from './components/ConnectPanel';
import { StatusPanel } from './components/StatusPanel';
import { JogPanel } from './components/JogPanel';
import { ActionsPanel } from './components/ActionsPanel';
import { EmergencyStopButton } from './components/EmergencyStopButton';
import { PluginPanels } from './components/PluginPanels';
import { ProbePanel } from './components/ProbePanel';
import { ProgramPanel } from './components/ProgramPanel';
import { ToolpathPreview3D, type ToolpathPreviewHandle } from './components/ToolpathPreview3D';
import { ConsolePanel } from './components/ConsolePanel';
import { FileManagerPanel } from './components/FileManagerPanel';
import { Tabs } from './components/Tabs';
import { Card, CardHeader, CardContent } from './components/ui/Card';
import { IconButton } from './components/ui/IconButton';
import { Sidebar } from './components/ui/Sidebar';
import { Drawer } from './components/ui/Drawer';
import './App.css';

const GCODE_EXTENSIONS = /\.(nc|gcode|tap|txt|cnc)$/i;

export default function App() {
  const {
    wsReady,
    connectionOpen,
    status,
    workPosition,
    ports,
    log,
    lastProbeResult,
    programStatus,
    settings,
    machineRates,
    plugins,
    send,
  } = useSocket();
  const controlsDisabled = !connectionOpen;

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

  const applyLoadedFile = (name: string, text: string) => {
    setFileName(name);
    setGcodeText(text);
    send({ type: 'loadProgram', name, gcode: text });
  };

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<string | null>(null);

  return (
    <>
      <Sidebar
        items={[{ key: 'files', icon: <FolderOpen size={19} />, label: 'File Manager' }]}
        active={activePanel}
        onSelect={(key) => setActivePanel((prev) => (prev === key ? null : key))}
      />

      <Drawer open={activePanel === 'files'} title="File Manager" onClose={() => setActivePanel(null)}>
        <FileManagerPanel onLoad={loadFromLibrary} />
      </Drawer>

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
        programRunning={programStatus.state === 'running'}
        onOpenSettings={() => setSettingsOpen(true)}
        send={send}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        plugins={plugins}
        settings={settings}
        send={send}
      />

      <main>
        <div className="column">
          <ConnectPanel ports={ports} connectionOpen={connectionOpen} wsReady={wsReady} send={send} />
          <StatusPanel status={status} />
          <ActionsPanel disabled={controlsDisabled} send={send} />
          <EmergencyStopButton visible={connectionOpen} send={send} />
          <PluginPanels plugins={plugins} />
        </div>
        <div className="column wide">
          <Card>
            <CardHeader
              actions={
                <IconButton aria-label="Reset view" title="Reset view" onClick={() => toolpathRef.current?.resetView()}>
                  <RotateCcw size={14} />
                </IconButton>
              }
            >
              <Box size={14} />
              Toolpath
            </CardHeader>
            <CardContent className="toolpath-content">
              <div
                onDoubleClick={() => toolpathFileInputRef.current?.click()}
                title="Double-click to load a G-code file"
              >
                <ToolpathPreview3D
                  ref={toolpathRef}
                  segments={segments}
                  currentPosition={workPosition}
                  sentLines={programStatus.sent}
                />
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
                        disabled={controlsDisabled}
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
                    content: (
                      <ConsolePanel
                        log={log}
                        disabled={controlsDisabled}
                        autoFeedEnabled={settings?.general.consoleAutoFeedEnabled ?? true}
                        defaultFeed={settings?.general.consoleDefaultFeed ?? 300}
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
          <JogPanel disabled={controlsDisabled} workPosition={workPosition} send={send} />
          <ProbePanel
            disabled={controlsDisabled}
            lastResult={lastProbeResult}
            settings={settings?.probe ?? null}
            send={send}
          />
        </div>
      </main>
      </div>
    </>
  );
}
