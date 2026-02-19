interface TopBarProps {
  instanceKey?: string;
  participantCount: number;
  eventCount: number;
  mode: 'graph' | 'flow';
  onModeChange: (mode: 'graph' | 'flow') => void;
}

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
        <button
          type="button"
          className={`mode-btn${mode === 'graph' ? ' is-active' : ''}`}
          onClick={() => onModeChange('graph')}
        >
          Graph
        </button>
        <button
          type="button"
          className={`mode-btn${mode === 'flow' ? ' is-active' : ''}`}
          onClick={() => onModeChange('flow')}
        >
          Flow
        </button>
      </div>
    </header>
  );
}
