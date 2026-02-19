import { useState, useCallback } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { useStudioData } from './hooks/useStudioData';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import GraphView from './components/GraphView';
import FlowView from './components/FlowView';
import Flyout from './components/Flyout';

export default function App() {
  const {
    instances,
    selectedKey,
    selectInstance,
    viz,
    participants,
    interactions,
    pulseEvents,
  } = useStudioData();
  const [mode, setMode] = useState<'graph' | 'flow'>('graph');
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null);

  const handleSelectInstance = useCallback(
    (key: string) => {
      selectInstance(key);
      setSelectedEdgeKey(null);
    },
    [selectInstance],
  );

  const handleEdgeClick = useCallback((edgeKey: string) => {
    setSelectedEdgeKey((prev) => (prev === edgeKey ? null : edgeKey));
  }, []);

  const handleCloseFlyout = useCallback(() => {
    setSelectedEdgeKey(null);
  }, []);

  return (
    <ReactFlowProvider>
      <div className="studio-shell">
        <Sidebar
          instances={instances}
          selectedKey={selectedKey}
          onSelect={handleSelectInstance}
        />
        <main className="main-panel">
          <TopBar
            instanceKey={viz?.instanceKey}
            participantCount={participants.length}
            eventCount={viz?.timeline?.length ?? 0}
            mode={mode}
            onModeChange={setMode}
          />
          <section className="visual-stage">
            {mode === 'graph' ? (
              <GraphView
                instanceKey={viz?.instanceKey ?? null}
                participants={participants}
                interactions={interactions}
                selectedEdgeKey={selectedEdgeKey}
                pulseEvents={pulseEvents}
                onEdgeClick={handleEdgeClick}
              />
            ) : (
              <FlowView viz={viz} />
            )}
          </section>
        </main>
      </div>
      <Flyout
        isOpen={selectedEdgeKey !== null}
        onClose={handleCloseFlyout}
        viz={viz}
        edgeKey={selectedEdgeKey}
      />
    </ReactFlowProvider>
  );
}
