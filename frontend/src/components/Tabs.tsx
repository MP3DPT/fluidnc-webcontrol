import { useState, type ReactNode } from 'react';

interface TabDef {
  key: string;
  label: ReactNode;
  content: ReactNode;
}

export function Tabs({ tabs }: { tabs: TabDef[] }) {
  const [active, setActive] = useState(0);

  return (
    <div className="tabs">
      <div className="tab-bar">
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
      <div className="tab-content">{tabs[active].content}</div>
    </div>
  );
}
