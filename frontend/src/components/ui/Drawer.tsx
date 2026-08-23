import { X } from 'lucide-react';
import type { ReactNode } from 'react';

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A panel docked against the side rail, not a centered modal dialog - it
 * overlays the dashboard rather than blocking it, so there's no
 * backdrop-click-to-close; the rail icon or the X closes it.
 */
export function Drawer({ open, title, onClose, children }: Props) {
  if (!open) return null;
  return (
    <div className="drawer">
      <div className="drawer-header">
        <h2>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
      </div>
      <div className="drawer-content">{children}</div>
    </div>
  );
}
