import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, File as FileIcon, Folder as FolderIcon, FolderPlus, Play, Trash2, Upload } from 'lucide-react';
import type { DiskUsage, FileEntry, Folder } from '../types';
import { parseToolpath } from '../gcode/parseToolpath';
import { renderThumbnail } from '../gcode/renderThumbnail';
import { extractMetadata, type GcodeMetadata } from '../gcode/extractMetadata';
import { formatDuration } from '../gcode/estimateTime';

interface Props {
  onLoad: (name: string, gcode: string) => void;
}

const DRAG_MIME = 'application/x-fluidnc-file-ids';

async function readJson(res: Response): Promise<{ ok: boolean; error?: string; [key: string]: unknown }> {
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error ?? 'Request failed');
  return data;
}

function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

/** Only lines the file actually had data for - most files won't have all of these. */
function metadataLines(m: GcodeMetadata): string[] {
  const lines: string[] = [];
  if (m.dimensions) {
    const { x, y, z } = m.dimensions;
    lines.push(`${x.toFixed(1)} × ${y.toFixed(1)} × ${z.toFixed(1)} mm`);
  }
  if (m.estimatedSeconds > 0) lines.push(`Est. time: ${formatDuration(m.estimatedSeconds)}`);
  if (m.feedRateRange) {
    const [lo, hi] = m.feedRateRange;
    lines.push(`Feed: ${lo === hi ? lo : `${lo}–${hi}`} mm/min`);
  }
  if (m.spindleSpeeds.length > 0) {
    const lo = m.spindleSpeeds[0];
    const hi = m.spindleSpeeds[m.spindleSpeeds.length - 1];
    lines.push(`Spindle: ${lo === hi ? lo : `${lo}–${hi}`} RPM`);
  }
  const tools = m.tools ?? []; // older saved entries predate this field
  if (tools.length > 0) {
    const label = tools.length > 1 ? 'Tools' : 'Tool';
    const desc = tools
      .map((t) => (t.diameter == null ? `T${t.number}` : `T${t.number} ⌀${t.diameter}mm${t.description ? ` – ${t.description}` : ''}`))
      .join(', ');
    lines.push(`${label}: ${desc}`);
  }
  if (m.units) lines.push(`Units: ${m.units}`);
  lines.push(`${m.lineCount.toLocaleString()} lines`);
  return lines;
}

export function FileManagerPanel({ onLoad }: Props) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [disk, setDisk] = useState<DiskUsage | null>(null);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoverPreview, setHoverPreview] = useState<{
    src: string;
    top: number;
    left: number;
    metadata: GcodeMetadata | null;
  } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null); // folder id being dragged over, or 'root'
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    try {
      const data = await readJson(await fetch('/api/files'));
      setFiles(data.files as FileEntry[]);
      setFolders(data.folders as Folder[]);
      setDisk((data.disk as DiskUsage | null) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const uploadFiles = async (fileList: FileList) => {
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(fileList)) {
        const text = await file.text();
        const segments = parseToolpath(text);
        const thumbnail = renderThumbnail(segments);
        const metadata = extractMetadata(text);
        await readJson(
          await fetch('/api/files', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: file.name, gcode: text, thumbnail, folderId: currentFolder, metadata }),
          }),
        );
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const deleteFiles = async (ids: string[]) => {
    const label = ids.length === 1 ? '1 file' : `${ids.length} files`;
    if (!confirm(`Delete ${label}? This can't be undone.`)) return;
    try {
      await readJson(
        await fetch('/api/files/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        }),
      );
      setSelected((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const moveFiles = async (ids: string[], folderId: string | null) => {
    try {
      await readJson(
        await fetch('/api/files/move', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids, folderId }),
        }),
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const createFolder = async () => {
    const name = prompt('Folder name?');
    if (!name) return;
    try {
      await readJson(
        await fetch('/api/folders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        }),
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const deleteFolder = async (folder: Folder) => {
    const count = files.filter((f) => f.folderId === folder.id).length;
    const warning =
      count === 0
        ? `Delete empty folder "${folder.name}"?`
        : `Delete folder "${folder.name}" and the ${count} file${count === 1 ? '' : 's'} inside it? This can't be undone.`;
    if (!confirm(warning)) return;
    try {
      await readJson(await fetch(`/api/folders/${folder.id}/delete`, { method: 'POST' }));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const loadFile = async (entry: FileEntry) => {
    try {
      const data = await readJson(await fetch(`/api/files/${entry.id}`));
      onLoad(entry.name, data.gcode as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const startDrag = (e: React.DragEvent, id: string) => {
    const ids = selected.has(id) ? [...selected] : [id];
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'move';
  };

  const acceptDrop = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(DRAG_MIME)) e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, folderId: string | null) => {
    e.preventDefault();
    setDropTarget(null);
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    const ids: string[] = JSON.parse(raw);
    moveFiles(ids, folderId);
  };

  const visibleFiles = files.filter((f) => f.folderId === currentFolder);
  const currentFolderName = folders.find((f) => f.id === currentFolder)?.name ?? null;

  return (
    <div className="file-manager">
      {disk && (
        <p className="hint disk-usage">
          {formatBytes(disk.freeBytes)} free of {formatBytes(disk.totalBytes)} on the SD card
        </p>
      )}
      <div className="row">
        <button disabled={uploading} onClick={() => fileInputRef.current?.click()}>
          <Upload size={15} />
          {uploading ? 'Uploading…' : 'Add files…'}
        </button>
        <button onClick={createFolder}>
          <FolderPlus size={15} />
          New Folder
        </button>
        {selected.size > 0 && (
          <button className="danger" onClick={() => deleteFiles([...selected])}>
            <Trash2 size={15} />
            Delete {selected.size} selected
          </button>
        )}
      </div>

      {currentFolder !== null && (
        <button
          className={`breadcrumb-back${dropTarget === 'root' ? ' drop-active' : ''}`}
          onClick={() => setCurrentFolder(null)}
          onDragOver={(e) => {
            acceptDrop(e);
            setDropTarget('root');
          }}
          onDragLeave={() => setDropTarget(null)}
          onDrop={(e) => handleDrop(e, null)}
        >
          <ChevronLeft size={15} />
          All Files / {currentFolderName}
        </button>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".nc,.gcode,.tap,.txt,.cnc"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) uploadFiles(e.target.files);
          e.target.value = '';
        }}
      />
      {error && <p className="hint error-text">{error}</p>}
      {loading ? (
        <p className="hint">Loading…</p>
      ) : (
        <div className="file-list">
          {currentFolder === null &&
            folders.map((folder) => {
              const count = files.filter((f) => f.folderId === folder.id).length;
              return (
                <div
                  key={folder.id}
                  className={`file-row folder-row${dropTarget === folder.id ? ' drop-active' : ''}`}
                  onClick={() => setCurrentFolder(folder.id)}
                  onDragOver={(e) => {
                    acceptDrop(e);
                    setDropTarget(folder.id);
                  }}
                  onDragLeave={() => setDropTarget(null)}
                  onDrop={(e) => handleDrop(e, folder.id)}
                >
                  <div className="file-thumb">
                    <FolderIcon size={20} />
                  </div>
                  <div className="file-meta">
                    <span className="file-name">{folder.name}</span>
                    <span className="hint">
                      {count} file{count === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="file-actions">
                    <button
                      className="danger"
                      title="Delete folder"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteFolder(folder);
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}

          {visibleFiles.length === 0 && folders.length === 0 && (
            <p className="hint">No files saved yet - loading one from the Program tab saves it here automatically, or add one directly above.</p>
          )}

          {visibleFiles.map((entry) => (
            <div
              className="file-row"
              key={entry.id}
              draggable
              onDragStart={(e) => startDrag(e, entry.id)}
            >
              <input type="checkbox" checked={selected.has(entry.id)} onChange={() => toggleSelected(entry.id)} />
              <div
                className="file-thumb"
                onMouseEnter={(e) => {
                  if (!entry.thumbnail) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  setHoverPreview({ src: entry.thumbnail, top: rect.top, left: rect.right + 8, metadata: entry.metadata });
                }}
                onMouseLeave={() => setHoverPreview(null)}
              >
                {entry.thumbnail ? <img src={entry.thumbnail} alt="" /> : <FileIcon size={20} />}
              </div>
              <div className="file-meta">
                <span className="file-name">{entry.name}</span>
                <span className="hint">
                  {(entry.size / 1024).toFixed(1)} KB · {new Date(entry.savedAt).toLocaleDateString()}
                </span>
              </div>
              <div className="file-actions">
                <button className="primary" title="Load into Program tab" onClick={() => loadFile(entry)}>
                  <Play size={14} />
                </button>
                <button className="danger" title="Delete" onClick={() => deleteFiles([entry.id])}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {folders.length > 0 && (
        <p className="hint">Drag a file onto a folder to move it in{currentFolder !== null ? ', or onto "All Files" above to move it out' : ''}.</p>
      )}

      {hoverPreview && (
        <div className="file-thumb-preview" style={{ top: hoverPreview.top, left: hoverPreview.left }}>
          <img src={hoverPreview.src} alt="" />
          {hoverPreview.metadata && (
            <div className="file-thumb-info">
              {metadataLines(hoverPreview.metadata).map((line, i) => (
                <div key={i}>{line}</div>
              ))}
              {hoverPreview.metadata.headerComments.length > 0 && (
                <div className="file-thumb-comments">
                  {hoverPreview.metadata.headerComments.slice(0, 4).map((c, i) => (
                    <div key={i}>{c}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
