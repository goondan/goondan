import { useState, useEffect, useRef, useCallback } from 'react';
import type {
  InstanceSummary,
  Visualization,
  TimelineEntry,
  Participant,
  Interaction,
} from '../types';
import { fetchInstances, fetchVisualization } from '../api';

function eventKey(e: TimelineEntry): string {
  const llmMessagesKey = (e.llmInputMessages ?? [])
    .map((item) => `${item.role}:${item.content}`)
    .join('\n');
  const traceKey = e.traceId && e.spanId ? `${e.traceId}:${e.spanId}` : '';
  return [e.at, e.source, e.target ?? '', e.subtype, e.detail, llmMessagesKey, traceKey].join('|');
}

/** participant 구조 핑거프린트 — id/kind/label 변경 시에만 갱신 */
function participantFingerprint(list: Participant[]): string {
  return list
    .map((p) => `${p.id}:${p.kind}:${p.label}`)
    .sort()
    .join(',');
}

/** interaction 구조 핑거프린트 — key/total 변경 시에만 갱신 */
function interactionFingerprint(list: Interaction[]): string {
  return list
    .map((i) => `${i.key}:${i.total}`)
    .sort()
    .join(',');
}

export function useStudioData() {
  const [instances, setInstances] = useState<InstanceSummary[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [viz, setViz] = useState<Visualization | null>(null);
  const [pulseEvents, setPulseEvents] = useState<TimelineEntry[]>([]);

  // 안정적 참조: 구조가 실제로 변경될 때만 setState 호출
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const participantFpRef = useRef('');
  const interactionFpRef = useRef('');

  const seenKeys = useRef(new Set<string>());
  const keyQueue = useRef<string[]>([]);
  const hydrated = useRef(false);

  const selectInstance = useCallback((key: string) => {
    setSelectedKey(key);
    seenKeys.current.clear();
    keyQueue.current = [];
    hydrated.current = false;
    participantFpRef.current = '';
    interactionFpRef.current = '';
    setPulseEvents([]);
    setParticipants([]);
    setInteractions([]);
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
      setParticipants([]);
      setInteractions([]);
      participantFpRef.current = '';
      interactionFpRef.current = '';
      return;
    }
    let active = true;
    const poll = async () => {
      if (!active) return;
      try {
        const data = await fetchVisualization(selectedKey);
        if (!active) return;
        setViz(data);

        // 구조 핑거프린트 비교 — 변경 시에만 참조 갱신
        const pFp = participantFingerprint(data.participants);
        if (pFp !== participantFpRef.current) {
          participantFpRef.current = pFp;
          setParticipants(data.participants);
        }

        const iFp = interactionFingerprint(data.interactions);
        if (iFp !== interactionFpRef.current) {
          interactionFpRef.current = iFp;
          setInteractions(data.interactions);
        }

        // Pulse event tracking
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

  return {
    instances,
    selectedKey,
    selectInstance,
    viz,
    participants,
    interactions,
    pulseEvents,
  };
}
