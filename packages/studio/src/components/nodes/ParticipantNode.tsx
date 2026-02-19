import { Handle, Position } from '@xyflow/react';
import clsx from 'clsx';

interface ParticipantNodeProps {
  data: { label: string; kind: string; isActive: boolean };
}

function kindBadge(kind: string): string {
  if (kind === 'agent') return 'A';
  if (kind === 'connector') return 'C';
  if (kind === 'tool') return 'T';
  if (kind === 'extension') return 'E';
  return '?';
}

export default function ParticipantNode({ data }: ParticipantNodeProps) {
  return (
    <div
      className={clsx(
        'participant-node',
        `kind-${data.kind}`,
        data.isActive && 'is-active',
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="participant-handle"
      />
      <span className="participant-badge">{kindBadge(data.kind)}</span>
      <span className="participant-label">{data.label}</span>
      <Handle
        type="source"
        position={Position.Right}
        className="participant-handle"
      />
    </div>
  );
}
