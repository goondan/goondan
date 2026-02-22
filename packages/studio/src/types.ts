export interface InstanceSummary {
  key: string;
  status: string;
  agent: string;
  createdAt: string;
  updatedAt: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface TraceSpan {
  spanId: string;
  parentSpanId?: string;
  traceId: string;
  type: string;
  agentName: string;
  instanceKey: string;
  startedAt: string;
  completedAt?: string;
  duration?: number;
  status: 'started' | 'completed' | 'failed';
  children: TraceSpan[];
  tokenUsage?: TokenUsage;
  detail?: string;
}

export interface Trace {
  traceId: string;
  rootSpans: TraceSpan[];
  agentNames: string[];
  startedAt: string;
  completedAt?: string;
  totalDuration?: number;
}

export interface Visualization {
  instanceKey: string;
  participants: Participant[];
  interactions: Interaction[];
  timeline: TimelineEntry[];
  recentEvents: TimelineEntry[];
  traces: Trace[];
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

export type LlmInputMessageContentSource = 'verbatim' | 'summary';

export interface LlmInputTextPart {
  type: 'text';
  text: string;
  truncated?: true;
}

export interface LlmInputToolCallPart {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  input: string;
  truncated?: true;
}

export interface LlmInputToolResultPart {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  output: string;
  truncated?: true;
}

export type LlmInputMessagePart =
  | LlmInputTextPart
  | LlmInputToolCallPart
  | LlmInputToolResultPart;

export interface LlmInputMessage {
  role: string;
  content: string;
  contentSource?: LlmInputMessageContentSource;
  parts?: LlmInputMessagePart[];
}

export interface TimelineEntry {
  at: string;
  kind: 'message' | 'runtime-event' | 'connector-log';
  source: string;
  target?: string;
  subtype: string;
  detail: string;
  llmInputMessages?: LlmInputMessage[];
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  instanceKey?: string;
  duration?: number;
  tokenUsage?: TokenUsage;
}
