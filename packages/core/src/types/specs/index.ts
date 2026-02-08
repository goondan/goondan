/**
 * Kind별 Spec 타입 re-export
 */

// Model
export type { ModelSpec, ModelCapabilities, ModelResource } from './model.js';

// Tool
export type {
  ToolSpec,
  ToolAuth,
  ToolExport,
  ToolResource,
  JsonSchema,
} from './tool.js';

// Extension
export type {
  ExtensionSpec,
  McpExtensionConfig,
  McpTransport,
  McpAttach,
  McpExpose,
  ExtensionResource,
} from './extension.js';

// Agent
export type {
  AgentSpec,
  AgentModelConfig,
  ModelParams,
  AgentPrompts,
  HookSpec,
  HookAction,
  PipelinePoint,
  ExprValue,
  AgentChangesetPolicy,
  AgentResource,
} from './agent.js';

// Swarm
export type {
  SwarmSpec,
  SwarmPolicy,
  SwarmLifecyclePolicy,
  SwarmChangesetPolicy,
  LiveConfigPolicy,
  SwarmResource,
} from './swarm.js';

// Connector
export type {
  ConnectorSpec,
  TriggerDeclaration,
  HttpTrigger,
  CronTrigger,
  CliTrigger,
  CustomTrigger,
  EventSchema,
  EventPropertyType,
  ConnectorResource,
} from './connector.js';

// Connection
export type {
  ConnectionSpec,
  ConnectorAuth,
  ConnectionVerify,
  IngressConfig,
  IngressRule,
  IngressMatch,
  IngressRoute,
  ConnectionResource,
} from './connection.js';

// OAuthApp
export type {
  OAuthAppSpec,
  OAuthClient,
  OAuthEndpoints,
  OAuthRedirect,
  OAuthAppResource,
} from './oauth-app.js';

// ResourceType
export type {
  ResourceTypeSpec,
  ResourceTypeNames,
  ResourceTypeVersion,
  ResourceTypeResource,
} from './resource-type.js';

// ExtensionHandler
export type {
  ExtensionHandlerSpec,
  ExtensionHandlerExport,
  ExtensionHandlerResource,
} from './extension-handler.js';
