import { useMemo } from 'react';
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

const LANE_W = 220;
const TOP_PAD = 42;
const ROW_GAP = 64;

export default function FlowView({ viz }: FlowViewProps) {
  const participants = viz?.participants ?? [];
  const timeline = viz?.timeline ?? [];

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
  const height = Math.max(280, TOP_PAD + visible.length * ROW_GAP + 40);

  if (participants.length === 0) {
    return <div className="empty">표시할 participant가 없습니다.</div>;
  }

  return (
    <div className="flow-wrap">
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

        {/* lane headers + lines */}
        {lanes.map((lane, i) => {
          const x = LANE_W * i + LANE_W / 2;
          return (
            <g key={lane.id}>
              <text
                x={x}
                y={22}
                textAnchor="middle"
                className="flow-label"
              >
                {lane.label}
              </text>
              <line
                x1={x}
                y1={28}
                x2={x}
                y2={height - 12}
                className="flow-lane"
              />
            </g>
          );
        })}

        {/* events */}
        {visible.map((event, i) => {
          const y = TOP_PAD + i * ROW_GAP;

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
  );
}
