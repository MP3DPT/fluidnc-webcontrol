import type { ReactNode } from 'react';

export interface SidebarItem {
  key: string;
  icon: ReactNode;
  label: string;
}

interface Props {
  items: SidebarItem[];
  active: string | null;
  onSelect: (key: string) => void;
}

/**
 * Icon-only rail docked to the left edge - a home for tools that don't fit
 * the main dashboard (File Manager today, room for more later) without
 * competing for space with it. Each icon's tooltip is a native title attr;
 * clicking toggles its Drawer open/closed.
 */
export function Sidebar({ items, active, onSelect }: Props) {
  return (
    <nav className="side-rail">
      {items.map((item) => (
        <button
          key={item.key}
          className={`side-rail-button${active === item.key ? ' active' : ''}`}
          onClick={() => onSelect(item.key)}
          title={item.label}
          aria-label={item.label}
        >
          {item.icon}
        </button>
      ))}
    </nav>
  );
}
