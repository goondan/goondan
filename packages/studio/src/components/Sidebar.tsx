import clsx from 'clsx';
import type { InstanceSummary } from '../types';

interface SidebarProps {
  instances: InstanceSummary[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

export default function Sidebar({ instances, selectedKey, onSelect }: SidebarProps) {
  return (
    <aside className="left-panel">
      <div className="brand">
        <div className="brand-kicker">GOONDAN</div>
        <h1>Studio</h1>
      </div>
      <div className="instance-list">
        {instances.length === 0 ? (
          <div className="empty">실행 중인 인스턴스가 없습니다.</div>
        ) : (
          instances.map((item) => (
            <button
              key={item.key}
              type="button"
              className={clsx('instance-btn', item.key === selectedKey && 'is-active')}
              onClick={() => onSelect(item.key)}
            >
              <div className="inst-key">{item.key}</div>
              <div className="inst-meta">
                {item.status || 'unknown'} &middot; {item.agent || 'orchestrator'}
              </div>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}
