export interface InstanceSummary {
  key: string;
  status: string;
  agent: string;
  createdAt: string;
  updatedAt: string;
}

export interface Visualization {
  instanceKey: string;
  participants: Participant[];
  interactions: Interaction[];
  timeline: TimelineEntry[];
  recentEvents: TimelineEntry[];
}

export interface Participant {
  id: string;
  label: string;
  kind: 'agent' | 'connector' | 'tool' | 'extension' | 'user' | 'system' | 'unknown';
  lastSeenAt: string;
}

export interface Interaction {
  key: string;
  a: string;
  b: string;
  total: number;
  lastSeenAt: string;
  direction: 'a->b' | 'b->a' | 'undirected';
  history: InteractionHistory[];
}

export interface InteractionHistory {
  at: string;
  from: string;
  to: string;
  direction: 'a->b' | 'b->a';
  kind: string;
  detail: string;
}

export interface TimelineEntry {
  at: string;
  kind: 'message' | 'runtime-event' | 'connector-log';
  source: string;
  target?: string;
  subtype: string;
  detail: string;
  llmInputMessages?: Array<{
    role: string;
    content: string;
  }>;
}
