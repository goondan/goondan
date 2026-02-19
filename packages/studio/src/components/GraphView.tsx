import { useMemo, useRef, useCallback } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
} from '@xyflow/react';
import type { Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Visualization, TimelineEntry } from '../types';
import { computeGraphLayout } from '../utils/layout';
import ParticipantNode from './nodes/ParticipantNode';

const nodeTypes = { participant: ParticipantNode };

interface GraphViewProps {
  viz: Visualization | null;
  selectedEdgeKey: string | null;
  pulseEvents: TimelineEntry[];
  onEdgeClick: (edgeKey: string) => void;
}

export default function GraphView({
  viz,
  selectedEdgeKey,
  pulseEvents,
  onEdgeClick,
}: GraphViewProps) {
  const interactions = viz?.interactions ?? [];
  const participants = viz?.participants ?? [];
  const layoutCacheKey = useRef('');
  const layoutCache = useRef<ReturnType<typeof computeGraphLayout> | null>(
    null,
  );

  const { activeNodes, activeEdges } = useMemo(() => {
    const nodes = new Set<string>();
    const edges = new Set<string>();
    for (const ev of pulseEvents) {
      nodes.add(ev.source);
      if (ev.target) {
        nodes.add(ev.target);
        for (const edge of interactions) {
          if (
            (edge.a === ev.source && edge.b === ev.target) ||
            (edge.a === ev.target && edge.b === ev.source)
          ) {
            edges.add(edge.key);
          }
        }
      }
    }
    return { activeNodes: nodes, activeEdges: edges };
  }, [pulseEvents, interactions]);

  const { nodes, edges } = useMemo(() => {
    if (!viz || participants.length === 0) {
      return { nodes: [], edges: [] };
    }

    const structureKey =
      participants.map((p) => p.id).sort().join(',') +
      '|' +
      interactions.map((i) => i.key).sort().join(',');

    if (structureKey !== layoutCacheKey.current || !layoutCache.current) {
      layoutCacheKey.current = structureKey;
      layoutCache.current = computeGraphLayout(participants, interactions);
    }

    const updatedNodes = layoutCache.current.nodes.map((n) => ({
      ...n,
      data: { ...n.data, isActive: activeNodes.has(n.id) },
    }));

    const updatedEdges: Edge[] = layoutCache.current.edges.map((e) => {
      const isSelected = selectedEdgeKey === e.id;
      const isActive = activeEdges.has(e.id);
      const result: Edge = {
        ...e,
        animated: isActive,
        style: {
          stroke: isSelected
            ? '#ff9f6e'
            : isActive
              ? '#73f0d6'
              : 'rgba(145, 167, 226, 0.35)',
          strokeWidth: isSelected || isActive ? 2.5 : 1.5,
          cursor: 'pointer',
        },
        labelStyle: {
          fill: '#9fb0dc',
          fontSize: 11,
          fontWeight: 600,
        },
      };
      return result;
    });

    return { nodes: updatedNodes, edges: updatedEdges };
  }, [viz, participants, interactions, selectedEdgeKey, activeNodes, activeEdges]);

  const handleEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      onEdgeClick(edge.id);
    },
    [onEdgeClick],
  );

  if (participants.length === 0) {
    return <div className="empty">표시할 participant가 없습니다.</div>;
  }

  return (
    <div className="graph-wrap">
      <ReactFlow
        key={viz?.instanceKey}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onEdgeClick={handleEdgeClick}
        nodesDraggable={false}
        nodesConnectable={false}
        colorMode="dark"
        fitView
        fitViewOptions={{ padding: 0.3 }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="rgba(145, 167, 226, 0.15)"
        />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={(node) => {
            const kind = node.data.kind;
            if (kind === 'agent') return '#ffce6e';
            if (kind === 'connector') return '#8eb8ff';
            return '#b7c9ff';
          }}
          maskColor="rgba(11, 19, 38, 0.7)"
        />
      </ReactFlow>
    </div>
  );
}
