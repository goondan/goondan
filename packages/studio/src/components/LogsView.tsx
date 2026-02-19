import { useState, useRef, useEffect, useMemo } from 'react';
import clsx from 'clsx';
import type { Visualization, Participant, TimelineEntry } from '../types';
import { formatTime } from '../utils/format';

interface LogsViewProps {
  viz: Visualization | null;
}

function pickFilterParticipants(participants: Participant[]): Participant[] {
  return participants.filter(
    (p) => p.kind === 'agent' || p.kind === 'connector',
  );
}

function kindLabel(kind: TimelineEntry['kind']): string {
  if (kind === 'message') return 'MSG';
  if (kind === 'runtime-event') return 'EVT';
  if (kind === 'connector-log') return 'LOG';
  return kind;
}

function stripPrefix(id: string): string {
  const idx = id.indexOf(':');
  return idx >= 0 ? id.slice(idx + 1) : id;
}

function summarizeRoleLabel(role: string): string {
  if (role === 'user') return 'USER';
  if (role === 'assistant') return 'ASSISTANT';
  if (role === 'tool') return 'TOOL';
  if (role === 'system') return 'SYSTEM';
  return role.toUpperCase();
}

export default function LogsView({ viz }: LogsViewProps) {
  const participants = viz?.participants ?? [];
  const timeline = viz?.timeline ?? [];
  const [filter, setFilter] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const isAtBottom = useRef(true);

  const chips = useMemo(
    () => pickFilterParticipants(participants),
    [participants],
  );

  const filtered = useMemo(() => {
    if (!filter) return timeline;
    return timeline.filter(
      (e) => e.source === filter || e.target === filter,
    );
  }, [timeline, filter]);

  // sticky auto-scroll
  const handleScroll = () => {
    if (!listRef.current) return;
    const el = listRef.current;
    isAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  useEffect(() => {
    if (isAtBottom.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [filtered.length]);

  if (!viz) {
    return <div className="empty">인스턴스를 선택하세요.</div>;
  }

  return (
    <div className="logs-wrap">
      <div className="logs-filters">
        <button
          type="button"
          className={clsx('logs-chip', !filter && 'is-active')}
          onClick={() => setFilter(null)}
        >
          All
          <span className="logs-chip-count">{timeline.length}</span>
        </button>
        {chips.map((p) => {
          const count = timeline.filter(
            (e) => e.source === p.id || e.target === p.id,
          ).length;
          return (
            <button
              key={p.id}
              type="button"
              className={clsx(
                'logs-chip',
                `logs-chip-${p.kind}`,
                filter === p.id && 'is-active',
              )}
              onClick={() => setFilter((prev) => (prev === p.id ? null : p.id))}
            >
              {p.label}
              <span className="logs-chip-count">{count}</span>
            </button>
          );
        })}
      </div>

      <div
        className="logs-list"
        ref={listRef}
        onScroll={handleScroll}
      >
        {filtered.length === 0 ? (
          <div className="empty">로그가 없습니다.</div>
        ) : (
          filtered.map((entry, i) => (
            <div
              key={i}
              className={clsx('log-row', `log-row-${entry.kind}`)}
            >
              <div className="log-main">
                <span className="log-time">{formatTime(entry.at)}</span>
                <span className={clsx('log-kind', `log-kind-${entry.kind}`)}>
                  {kindLabel(entry.kind)}
                </span>
                <span className="log-subtype">{entry.subtype}</span>
                <span className="log-source">{stripPrefix(entry.source)}</span>
                {entry.target && (
                  <>
                    <span className="log-arrow">&rarr;</span>
                    <span className="log-target">{stripPrefix(entry.target)}</span>
                  </>
                )}
                {entry.detail && (
                  <span className="log-detail">{entry.detail}</span>
                )}
              </div>
              {entry.llmInputMessages && entry.llmInputMessages.length > 0 && (
                <div className="log-llm-panel">
                  <div className="log-llm-title">
                    LLM input messages ({entry.llmInputMessages.length})
                  </div>
                  <ol className="log-llm-list">
                    {entry.llmInputMessages.map((message, msgIndex) => (
                      <li key={`${msgIndex}-${message.role}`} className="log-llm-item">
                        <span className="log-llm-role">{summarizeRoleLabel(message.role)}</span>
                        <pre className="log-llm-content">{message.content}</pre>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
