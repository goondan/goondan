import clsx from 'clsx';

export type ViewMode = 'graph' | 'flow' | 'logs';

interface TopBarProps {
  instanceKey?: string;
  participantCount: number;
  eventCount: number;
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
}

const MODES: { value: ViewMode; label: string }[] = [
  { value: 'graph', label: 'Graph' },
  { value: 'flow', label: 'Flow' },
  { value: 'logs', label: 'Logs' },
];

export default function TopBar({
  instanceKey,
  participantCount,
  eventCount,
  mode,
  onModeChange,
}: TopBarProps) {
  return (
    <header className="top-bar">
      <div className="title-wrap">
        <h2>{instanceKey ?? '인스턴스를 선택하세요'}</h2>
        <p>
          {instanceKey
            ? `participants ${participantCount} / events ${eventCount}`
            : 'runtime event stream'}
        </p>
      </div>
      <div className="mode-toggle">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            className={clsx('mode-btn', mode === m.value && 'is-active')}
            onClick={() => onModeChange(m.value)}
          >
            {m.label}
          </button>
        ))}
      </div>
    </header>
  );
}
