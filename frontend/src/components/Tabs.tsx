import { useState, type ReactNode } from 'react';

interface TabDef {
  key: string;
  label: ReactNode;
  content: ReactNode;
  /** Right-aligned slot in the tab bar, shown only while this tab is active (e.g. Console's Auto-scroll toggle). */
  actions?: ReactNode;
}

export function Tabs({ tabs }: { tabs: TabDef[] }) {
  const [active, setActive] = useState(0);

  return (
    <div className="tabs">
      <div className="tab-bar">
        <div className="tab-bar-tabs">
          {tabs.map((tab, i) => (
            <button
              key={tab.key}
              className={`tab-button ${i === active ? 'active' : ''}`}
              onClick={() => setActive(i)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {tabs[active].actions && <div className="tab-bar-actions">{tabs[active].actions}</div>}
      </div>
      <div className="tab-content">{tabs[active].content}</div>
    </div>
  );
}
