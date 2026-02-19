import type { InstanceSummary, Visualization } from './types';

export async function fetchInstances(): Promise<InstanceSummary[]> {
  const res = await fetch('/api/instances', { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data.items) ? data.items : [];
}

export async function fetchVisualization(
  instanceKey: string,
  recent = 20,
): Promise<Visualization> {
  const key = encodeURIComponent(instanceKey);
  const res = await fetch(`/api/instances/${key}/visualization?recent=${recent}`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
