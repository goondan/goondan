import type { JsonValue } from "./json.js";
import type { ObjectRefLike, RefOrSelector } from "./references.js";
import type { ValueSource } from "./value-source.js";

export const GOONDAN_API_VERSION = "goondan.ai/v1";

export type KnownKind =
  | "Model"
  | "Agent"
  | "Swarm"
  | "Tool"
  | "Extension"
  | "Connector"
  | "Connection"
  | "Package";

export interface ResourceMetadata {
  name: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

export interface Resource<T = unknown> {
  apiVersion: string;
  kind: string;
  metadata: ResourceMetadata;
  spec: T;
}

export interface TypedResource<K extends KnownKind, T> extends Resource<T> {
  apiVersion: typeof GOONDAN_API_VERSION;
  kind: K;
}

export interface ModelCapabilities {
  streaming?: boolean;
  toolCalling?: boolean;
  [key: string]: boolean | undefined;
}

export interface ModelSpec {
  provider: string;
  model: string;
  apiKey?: ValueSource;
  endpoint?: string;
  options?: Record<string, unknown>;
  capabilities?: ModelCapabilities;
}

export interface JsonSchemaObject {
  type: "object";
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface JsonSchemaString {
  type: "string";
  enum?: string[];
}

export interface JsonSchemaNumber {
  type: "number" | "integer";
}

export interface JsonSchemaBoolean {
  type: "boolean";
}

export interface JsonSchemaArray {
  type: "array";
  items?: JsonSchemaProperty;
}

export type JsonSchemaProperty =
  | JsonSchemaString
  | JsonSchemaNumber
  | JsonSchemaBoolean
  | JsonSchemaArray
  | JsonSchemaObject;

export interface ToolExportSpec {
  name: string;
  description: string;
  parameters: JsonSchemaObject;
}

export interface ToolSpec {
  entry: string;
  errorMessageLimit?: number;
  exports: ToolExportSpec[];
}

export interface ExtensionSpec {
  entry: string;
  config?: Record<string, unknown>;
}

export interface AgentSpec {
  modelConfig: AgentModelConfig;
  prompts: AgentPrompts;
  tools?: RefOrSelector[];
  extensions?: RefOrSelector[];
}

export interface AgentModelConfig {
  modelRef: ObjectRefLike;
  params?: ModelParams;
}

export interface ModelParams {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  [key: string]: unknown;
}

export interface AgentPrompts {
  systemPrompt?: string;
  systemRef?: string;
}

export interface SwarmSpec {
  entryAgent: ObjectRefLike;
  agents: RefOrSelector[];
  policy?: SwarmPolicy;
}

export interface SwarmPolicy {
  maxStepsPerTurn?: number;
  lifecycle?: SwarmLifecyclePolicy;
  shutdown?: SwarmShutdownPolicy;
}

export interface SwarmLifecyclePolicy {
  ttlSeconds?: number;
  gcGraceSeconds?: number;
}

export interface SwarmShutdownPolicy {
  gracePeriodSeconds?: number;
}

export interface EventPropertyType {
  type: "string" | "number" | "boolean";
  optional?: boolean;
}

export interface EventSchema {
  name: string;
  properties?: Record<string, EventPropertyType>;
}

export interface ConnectorSpec {
  entry: string;
  events: EventSchema[];
}

export interface ConnectionSpec {
  connectorRef: ObjectRefLike;
  swarmRef?: ObjectRefLike;
  secrets?: Record<string, ValueSource>;
  verify?: ConnectionVerify;
  ingress?: IngressConfig;
}

export interface ConnectionVerify {
  webhook?: {
    signingSecret: ValueSource;
  };
}

export interface IngressConfig {
  rules?: IngressRule[];
}

export interface IngressRule {
  match?: IngressMatch;
  route: IngressRoute;
}

export interface IngressMatch {
  event?: string;
  properties?: Record<string, string | number | boolean>;
}

export interface IngressRoute {
  agentRef?: ObjectRefLike;
}

export interface PackageSpec {
  version?: string;
  description?: string;
  access?: "public" | "restricted";
  dependencies?: PackageDependency[];
  registry?: PackageRegistry;
}

export interface PackageDependency {
  name: string;
  version: string;
}

export interface PackageRegistry {
  url: string;
}

export type ModelResource = TypedResource<"Model", ModelSpec>;
export type AgentResource = TypedResource<"Agent", AgentSpec>;
export type SwarmResource = TypedResource<"Swarm", SwarmSpec>;
export type ToolResource = TypedResource<"Tool", ToolSpec>;
export type ExtensionResource = TypedResource<"Extension", ExtensionSpec>;
export type ConnectorResource = TypedResource<"Connector", ConnectorSpec>;
export type ConnectionResource = TypedResource<"Connection", ConnectionSpec>;
export type PackageResource = TypedResource<"Package", PackageSpec>;

export type KnownResource =
  | ModelResource
  | AgentResource
  | SwarmResource
  | ToolResource
  | ExtensionResource
  | ConnectorResource
  | ConnectionResource
  | PackageResource;

export interface ValidationError {
  code: string;
  message: string;
  path: string;
  suggestion?: string;
  helpUrl?: string;
  details?: JsonValue;
}

export function isKnownKind(value: unknown): value is KnownKind {
  return (
    value === "Model" ||
    value === "Agent" ||
    value === "Swarm" ||
    value === "Tool" ||
    value === "Extension" ||
    value === "Connector" ||
    value === "Connection" ||
    value === "Package"
  );
}
