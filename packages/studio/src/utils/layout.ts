import dagre from '@dagrejs/dagre';
import type { Participant, Interaction } from '../types';

const NODE_W = 180;
const NODE_H = 50;

export interface LayoutNode {
  id: string;
  type: string;
  data: { label: string; kind: string; isActive: boolean };
  position: { x: number; y: number };
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export function computeGraphLayout(
  participants: Participant[],
  interactions: Interaction[],
  direction: 'TB' | 'LR' = 'LR',
): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, ranksep: 120, nodesep: 80, marginx: 40, marginy: 40 });

  const filtered = participants.filter(
    (p) => p.kind === 'agent' || p.kind === 'connector',
  );
  const relevant = filtered.length > 0 ? filtered : participants;
  const nodeIds = new Set(relevant.map((p) => p.id));

  for (const p of relevant) {
    g.setNode(p.id, { width: NODE_W, height: NODE_H });
  }

  for (const inter of interactions) {
    if (nodeIds.has(inter.a) && nodeIds.has(inter.b)) {
      g.setEdge(inter.a, inter.b);
    }
  }

  dagre.layout(g);

  const nodes: LayoutNode[] = relevant.map((p) => {
    const pos = g.node(p.id);
    const result: LayoutNode = {
      id: p.id,
      type: 'participant',
      data: { label: p.label, kind: p.kind, isActive: false },
      position: {
        x: (pos?.x ?? 0) - NODE_W / 2,
        y: (pos?.y ?? 0) - NODE_H / 2,
      },
    };
    return result;
  });

  const edges: LayoutEdge[] = interactions
    .filter((i) => nodeIds.has(i.a) && nodeIds.has(i.b))
    .map((i) => {
      const result: LayoutEdge = {
        id: i.key,
        source: i.a,
        target: i.b,
        label: i.total > 1 ? `${i.total}` : undefined,
      };
      return result;
    });

  return { nodes, edges };
}
