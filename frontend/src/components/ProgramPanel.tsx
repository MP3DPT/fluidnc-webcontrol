import { useRef } from 'react';
import { FileUp, Pause, Play, Square, Trash2 } from 'lucide-react';
import type { ProgramStatus } from '../types';
import { formatDuration, type TimingEstimate } from '../gcode/estimateTime';

interface Props {
  fileName: string | null;
  metadataSummary: string | null;
  programStatus: ProgramStatus;
  timing: TimingEstimate;
  elapsedSeconds: number;
  currentPass: number;
  hasMachineRates: boolean;
  disabled: boolean;
  onFileSelected: (file: File) => void;
  onClear: () => void;
  send: (message: Record<string, unknown>) => void;
}

const STATE_LABELS: Record<ProgramStatus['state'], string> = {
  idle: 'No program running',
  running: 'Running',
  paused: 'Paused',
  complete: 'Complete',
  stopped: 'Stopped',
  error: 'Error',
};

export function ProgramPanel({
  fileName,
  metadataSummary,
  programStatus,
  timing,
  elapsedSeconds,
  currentPass,
  hasMachineRates,
  disabled,
  onFileSelected,
  onClear,
  send,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const percent = programStatus.total > 0 ? Math.round((programStatus.sent / programStatus.total) * 100) : 0;
  const hasProgram = programStatus.total > 0;
  const isActive = programStatus.state === 'running' || programStatus.state === 'paused';
  const canRun = hasProgram && !disabled && (programStatus.state === 'idle' || programStatus.state === 'stopped' || programStatus.state === 'complete' || programStatus.state === 'error');
  const canPause = !disabled && programStatus.state === 'running';
  const canResume = !disabled && programStatus.state === 'paused';
  const canStop = !disabled && (programStatus.state === 'running' || programStatus.state === 'paused');

  const handleRun = () => {
    if (programStatus.state === 'complete') {
      if (!window.confirm(`"${fileName ?? 'This file'}" already finished — run it again from the start?`)) return;
    }
    send({ type: 'runProgram' });
  };

  return (
    <div className="button-stack">
      <div className="row">
        <input
          ref={fileInputRef}
          type="file"
          accept=".nc,.gcode,.tap,.txt,.cnc"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFileSelected(file);
            e.target.value = '';
          }}
        />
        <button onClick={() => fileInputRef.current?.click()} disabled={disabled}>
          <FileUp size={15} />
          Load File…
        </button>
        <button onClick={onClear} disabled={disabled || isActive || !hasProgram}>
          <Trash2 size={15} />
          Clear
        </button>
        <span className="file-chip">{fileName ?? 'No file loaded'}</span>
      </div>

      {hasProgram && (
        <>
          {metadataSummary && <p className="hint">{metadataSummary}</p>}
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${percent}%` }} />
          </div>
          <p className="hint">
            {STATE_LABELS[programStatus.state]} — {programStatus.sent} / {programStatus.total} lines ({percent}%)
          </p>
          <p className="hint">
            {isActive
              ? `Remaining: ${formatDuration(timing.totalSeconds - elapsedSeconds)} — pass ${currentPass || 1} of ${timing.passCount}`
              : `Estimated: ${formatDuration(timing.totalSeconds)} — ${timing.passCount} pass${timing.passCount === 1 ? '' : 'es'}`}
            {!hasMachineRates && ' (approximate — connect to the machine for an accurate estimate)'}
          </p>
        </>
      )}

      <div className="row">
        <button className="primary" disabled={!canRun} onClick={handleRun}>
          <Play size={15} />
          Run
        </button>
        <button disabled={!canPause} onClick={() => send({ type: 'pauseProgram' })}>
          <Pause size={15} />
          Pause
        </button>
        <button disabled={!canResume} onClick={() => send({ type: 'resumeProgram' })}>
          <Play size={15} />
          Resume
        </button>
        <button className="danger" disabled={!canStop} onClick={() => send({ type: 'stopProgram' })}>
          <Square size={15} />
          Stop
        </button>
      </div>
    </div>
  );
}
