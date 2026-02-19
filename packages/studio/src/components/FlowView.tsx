import { useMemo, useRef, useEffect } from 'react';
import clsx from 'clsx';
import type { Visualization, Participant, TimelineEntry } from '../types';
import { formatTimestamp } from '../utils/format';

interface FlowViewProps {
  viz: Visualization | null;
}

function pickFlowParticipants(participants: Participant[]): Participant[] {
  const prio = participants.filter(
    (p) => p.kind === 'agent' || p.kind === 'connector',
  );
  if (prio.length > 0) return prio;
  const fallback = participants.filter(
    (p) => p.kind !== 'tool' && p.kind !== 'extension',
  );
  return fallback.length > 0 ? fallback : participants;
}

function isToolStep(e: TimelineEntry): boolean {
  return (
    e.kind === 'runtime-event' &&
    (e.subtype === 'tool.called' ||
      e.subtype === 'tool.completed' ||
      e.subtype === 'tool.failed')
  );
}

function summarize(e: TimelineEntry, max: number): string {
  const detail = e.detail || '';
  const text = `${formatTimestamp(e.at)} \u00b7 ${e.subtype}${detail ? ` \u00b7 ${detail}` : ''}`;
  return text.length > max ? text.slice(0, max) + '\u2026' : text;
}

function resolveToolLane(
  event: TimelineEntry,
  laneById: Map<string, number>,
): number {
  const si = laneById.get(event.source);
  const ti = event.target ? laneById.get(event.target) : undefined;
  if (event.subtype === 'tool.called') return si ?? ti ?? 0;
  return ti ?? si ?? 0;
}

function kindBadge(kind: Participant['kind']): string {
  if (kind === 'agent') return 'A';
  if (kind === 'connector') return 'C';
  if (kind === 'tool') return 'T';
  if (kind === 'extension') return 'E';
  return 'U';
}

const LANE_W = 220;
const ROW_GAP = 64;

export default function FlowView({ viz }: FlowViewProps) {
  const participants = viz?.participants ?? [];
  const timeline = viz?.timeline ?? [];
  const bodyRef = useRef<HTMLDivElement>(null);
  const isAtBottom = useRef(true);

  const lanes = useMemo(
    () => pickFlowParticipants(participants).slice(0, 10),
    [participants],
  );
  const laneById = useMemo(
    () => new Map(lanes.map((l, i) => [l.id, i])),
    [lanes],
  );

  const visible = timeline.slice(-160);
  const width = Math.max(760, LANE_W * lanes.length);
  const height = Math.max(200, visible.length * ROW_GAP + 40);

  // sticky auto-scroll
  const handleScroll = () => {
    if (!bodyRef.current) return;
    const el = bodyRef.current;
    isAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  useEffect(() => {
    if (isAtBottom.current && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [visible.length]);

  if (participants.length === 0) {
    return <div className="empty">표시할 participant가 없습니다.</div>;
  }

  return (
    <div className="flow-wrap">
      {/* ── Sticky header ── */}
      <div className="flow-header" style={{ minWidth: width }}>
        {lanes.map((lane) => (
          <div
            key={lane.id}
            className={clsx('flow-header-lane', `flow-header-${lane.kind}`)}
            style={{ width: LANE_W }}
          >
            <span
              className={clsx(
                'flow-header-badge',
                `flow-badge-${lane.kind}`,
              )}
            >
              {kindBadge(lane.kind)}
            </span>
            <span className="flow-header-label">{lane.label}</span>
          </div>
        ))}
      </div>

      {/* ── Scrollable body ── */}
      <div
        className="flow-body"
        ref={bodyRef}
        onScroll={handleScroll}
      >
        <svg
          className="flow-svg"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
        >
          <defs>
            <marker
              id="arrowHead"
              markerWidth={8}
              markerHeight={8}
              refX={7}
              refY={4}
              orient="auto"
            >
              <path d="M 0 0 L 8 4 L 0 8 z" fill="#73f0d6" />
            </marker>
          </defs>

          {/* lane lines */}
          {lanes.map((lane, i) => {
            const x = LANE_W * i + LANE_W / 2;
            return (
              <line
                key={lane.id}
                x1={x}
                y1={0}
                x2={x}
                y2={height}
                className="flow-lane"
              />
            );
          })}

          {/* events */}
          {visible.map((event, i) => {
            const y = 24 + i * ROW_GAP;

            if (isToolStep(event)) {
              const li = resolveToolLane(event, laneById);
              const cx = LANE_W * li + LANE_W / 2;
              const sw = Math.max(140, LANE_W - 30);
              const sh = 28;
              return (
                <g key={i}>
                  <rect
                    x={cx - sw / 2}
                    y={y - sh / 2}
                    width={sw}
                    height={sh}
                    className={clsx('flow-step', {
                      called: event.subtype === 'tool.called',
                      failed: event.subtype === 'tool.failed',
                      done: event.subtype === 'tool.completed',
                    })}
                  />
                  <text
                    x={cx}
                    y={y + 4}
                    textAnchor="middle"
                    className="flow-event"
                  >
                    {summarize(event, 88)}
                  </text>
                </g>
              );
            }

            const si = laneById.get(event.source);
            const ti = event.target
              ? laneById.get(event.target)
              : undefined;
            const anchor = si ?? ti ?? 0;

            if (si === undefined || ti === undefined || si === ti) {
              const x = LANE_W * anchor + LANE_W / 2;
              return (
                <g key={i}>
                  <circle cx={x} cy={y} r={4} className="flow-dot" />
                  <text
                    x={x + 10}
                    y={y - 6}
                    textAnchor="start"
                    className="flow-event"
                  >
                    {summarize(event, 88)}
                  </text>
                </g>
              );
            }

            const sx = LANE_W * si + LANE_W / 2;
            const tx = LANE_W * ti + LANE_W / 2;
            const midY = y - 18;
            return (
              <g key={i}>
                <path
                  d={`M ${sx} ${y} Q ${(sx + tx) / 2} ${midY} ${tx} ${y}`}
                  className="flow-arc"
                  markerEnd="url(#arrowHead)"
                />
                <text
                  x={(sx + tx) / 2}
                  y={y - 6}
                  textAnchor="middle"
                  className="flow-event"
                >
                  {summarize(event, 92)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
