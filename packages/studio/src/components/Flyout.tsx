import clsx from 'clsx';
import type { Visualization } from '../types';
import { formatTimestamp } from '../utils/format';

interface FlyoutProps {
  isOpen: boolean;
  onClose: () => void;
  viz: Visualization | null;
  edgeKey: string | null;
}

export default function Flyout({ isOpen, onClose, viz, edgeKey }: FlyoutProps) {
  const interaction =
    edgeKey && viz
      ? (viz.interactions ?? []).find((e) => e.key === edgeKey)
      : undefined;

  return (
    <>
      <aside className={clsx('flyout', isOpen && 'is-open')}>
        <div className="flyout-head">
          <h3>Edge History</h3>
          <button
            type="button"
            className="flyout-close-btn"
            onClick={onClose}
          >
            &times;
          </button>
        </div>
        <div className="flyout-body">
          {interaction?.key && (
            <div className="flyout-edge-label">
              {interaction.a.replace(/^[^:]+:/, '')}
              {' \u2194 '}
              {interaction.b.replace(/^[^:]+:/, '')}
              <span className="flyout-edge-count">
                {interaction.total} event{interaction.total !== 1 ? 's' : ''}
              </span>
            </div>
          )}
          <div className="edge-history">
            {!interaction?.history?.length ? (
              <div className="empty">이력 데이터가 없습니다.</div>
            ) : (
              interaction.history.map((item, i) => (
                <div key={i} className="history-item">
                  <div className="history-meta">
                    <span className="history-time">
                      {formatTimestamp(item.at)}
                    </span>
                    <span className="history-dir">{item.direction}</span>
                    <span className="history-kind">{item.kind}</span>
                  </div>
                  {item.detail && (
                    <div className="history-detail">{item.detail}</div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </aside>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        className={clsx('flyout-scrim', isOpen && 'is-open')}
        onClick={onClose}
      />
    </>
  );
}
