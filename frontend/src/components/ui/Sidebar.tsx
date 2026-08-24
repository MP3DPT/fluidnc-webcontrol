import type { ReactNode } from 'react';

export interface SidebarItem {
  key: string;
  icon: ReactNode;
  label: string;
}

interface Props {
  items: SidebarItem[];
  /** Rendered as its own group pinned to the rail's bottom (e.g. About), visually separate from the main items. */
  footerItems?: SidebarItem[];
  /** Tiny, muted text under the footer group (e.g. "v0.1.0") - deliberately unobtrusive. */
  version?: string;
  /** When true, the version text becomes clickable (jumps to the given key, typically "about") and gets an attention dot - still just text-sized, not a competing badge. */
  updateAvailable?: boolean;
  active: string | null;
  onSelect: (key: string) => void;
}

function renderButton(item: SidebarItem, active: string | null, onSelect: (key: string) => void) {
  return (
    <button
      key={item.key}
      className={`side-rail-button${active === item.key ? ' active' : ''}`}
      onClick={() => onSelect(item.key)}
      title={item.label}
      aria-label={item.label}
    >
      {item.icon}
      <span className="side-rail-label">{item.label}</span>
    </button>
  );
}

/**
 * Icon rail docked to the left edge - a home for tools that don't fit
 * the main dashboard (File Manager today, room for more later) without
 * competing for space with it. Each button shows its label below the icon;
 * clicking toggles its Drawer open/closed.
 */
export function Sidebar({ items, footerItems, version, updateAvailable, active, onSelect }: Props) {
  return (
    <nav className="side-rail">
      {items.map((item) => renderButton(item, active, onSelect))}
      {footerItems && footerItems.length > 0 && (
        <div className="side-rail-footer">
          {footerItems.map((item) => renderButton(item, active, onSelect))}
          {version &&
            (updateAvailable ? (
              <button
                className="side-rail-version side-rail-version-update"
                onClick={() => onSelect('about')}
                title="An update is available - see About"
              >
                <span className="side-rail-version-dot" />
                {version}
              </button>
            ) : (
              <span className="side-rail-version">{version}</span>
            ))}
        </div>
      )}
    </nav>
  );
}
