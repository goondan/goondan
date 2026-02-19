import { useState, useEffect, useRef, useCallback } from 'react';
import type { InstanceSummary, Visualization, TimelineEntry } from '../types';
import { fetchInstances, fetchVisualization } from '../api';

function eventKey(e: TimelineEntry): string {
  return [e.at, e.source, e.target ?? '', e.subtype, e.detail].join('|');
}

export function useStudioData() {
  const [instances, setInstances] = useState<InstanceSummary[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [viz, setViz] = useState<Visualization | null>(null);
  const [pulseEvents, setPulseEvents] = useState<TimelineEntry[]>([]);

  const seenKeys = useRef(new Set<string>());
  const keyQueue = useRef<string[]>([]);
  const hydrated = useRef(false);

  const selectInstance = useCallback((key: string) => {
    setSelectedKey(key);
    seenKeys.current.clear();
    keyQueue.current = [];
    hydrated.current = false;
    setPulseEvents([]);
  }, []);

  // Instance polling
  useEffect(() => {
    let active = true;
    const poll = async () => {
      if (!active) return;
      try {
        const items = await fetchInstances();
        if (!active) return;
        setInstances(items);
        setSelectedKey((prev) => {
          if (prev && items.some((i) => i.key === prev)) return prev;
          return items.length > 0 ? items[0].key : null;
        });
      } catch {
        /* polling failure — ignore */
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  // Visualization polling
  useEffect(() => {
    if (!selectedKey) {
      setViz(null);
      return;
    }
    let active = true;
    const poll = async () => {
      if (!active) return;
      try {
        const data = await fetchVisualization(selectedKey);
        if (!active) return;
        setViz(data);

        const recent = data.recentEvents ?? [];
        if (!hydrated.current) {
          for (const e of recent) {
            const k = eventKey(e);
            seenKeys.current.add(k);
            keyQueue.current.push(k);
          }
          hydrated.current = true;
          setPulseEvents([]);
        } else {
          const fresh: TimelineEntry[] = [];
          for (const e of recent) {
            const k = eventKey(e);
            if (!seenKeys.current.has(k)) {
              seenKeys.current.add(k);
              keyQueue.current.push(k);
              fresh.push(e);
            }
          }
          while (keyQueue.current.length > 2000) {
            const oldest = keyQueue.current.shift();
            if (oldest) seenKeys.current.delete(oldest);
          }
          if (fresh.length > 0) setPulseEvents(fresh);
        }
      } catch {
        /* polling failure — ignore */
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [selectedKey]);

  return { instances, selectedKey, selectInstance, viz, pulseEvents };
}
