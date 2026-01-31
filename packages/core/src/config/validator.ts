import type { ConfigRegistry, Resource } from './registry.js';
import { normalizeObjectRef } from './ref.js';

export interface ValidationError {
  resource: string;
  path?: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

interface ValidatorOptions {
  registry?: ConfigRegistry;
  allowDeviceCode?: boolean;
}

export function validateConfig(resources: Resource[], options: ValidatorOptions = {}): ValidationResult {
  const errors: ValidationError[] = [];
  const registry = options.registry;

  for (const resource of resources) {
    const id = `${resource.kind}/${resource.metadata?.name || 'unknown'}`;

    if (!resource.apiVersion) {
      errors.push({ resource: id, path: 'apiVersion', message: 'apiVersion이 필요합니다.' });
    }
    if (!resource.kind) {
      errors.push({ resource: id, path: 'kind', message: 'kind가 필요합니다.' });
    }
    if (!resource.metadata?.name) {
      errors.push({ resource: id, path: 'metadata.name', message: 'metadata.name이 필요합니다.' });
    }

    switch (resource.kind) {
      case 'Model':
        validateModel(resource, errors);
        break;
      case 'Tool':
        validateTool(resource, registry, errors);
        break;
      case 'Extension':
        validateExtension(resource, errors);
        break;
      case 'Agent':
        validateAgent(resource, registry, errors);
        break;
      case 'Swarm':
        validateSwarm(resource, registry, errors);
        break;
      case 'Connector':
        validateConnector(resource, registry, errors);
        break;
      case 'OAuthApp':
        validateOAuthApp(resource, options, errors);
        break;
      case 'MCPServer':
        validateMcpServer(resource, errors);
        break;
      case 'ResourceType':
      case 'ExtensionHandler':
        validateCustomResource(resource, errors);
        break;
      default:
        break;
    }
  }

  return { valid: errors.length === 0, errors };
}

function validateModel(resource: Resource, errors: ValidationError[]) {
  const spec = resource.spec as Record<string, unknown> | undefined;
  if (!spec?.provider) {
    errors.push({ resource: id(resource), path: 'spec.provider', message: 'Model.spec.provider가 필요합니다.' });
  }
  if (!spec?.name) {
    errors.push({ resource: id(resource), path: 'spec.name', message: 'Model.spec.name이 필요합니다.' });
  }
}

function validateTool(resource: Resource, registry: ConfigRegistry | undefined, errors: ValidationError[]) {
  const spec = resource.spec as Record<string, unknown> | undefined;
  if (!spec?.entry) {
    errors.push({ resource: id(resource), path: 'spec.entry', message: 'Tool.spec.entry가 필요합니다.' });
  }
  const exportsList = (spec?.exports as Array<Record<string, unknown>> | undefined) || [];
  if (exportsList.length === 0) {
    errors.push({ resource: id(resource), path: 'spec.exports', message: 'Tool.spec.exports는 최소 1개가 필요합니다.' });
  }
  const toolAuth = (spec?.auth as Record<string, unknown> | undefined) || undefined;
  validateToolAuthScopes(toolAuth, exportsList, registry, errors, id(resource));
}

function validateExtension(resource: Resource, errors: ValidationError[]) {
  const spec = resource.spec as Record<string, unknown> | undefined;
  if (!spec?.entry) {
    errors.push({ resource: id(resource), path: 'spec.entry', message: 'Extension.spec.entry가 필요합니다.' });
  }
}

function validateAgent(resource: Resource, registry: ConfigRegistry | undefined, errors: ValidationError[]) {
  const spec = resource.spec as Record<string, unknown> | undefined;
  const modelConfig = spec?.modelConfig as Record<string, unknown> | undefined;
  if (!modelConfig?.modelRef) {
    errors.push({ resource: id(resource), path: 'spec.modelConfig.modelRef', message: 'Agent.modelConfig.modelRef가 필요합니다.' });
  } else if (registry) {
    const ref = normalizeObjectRef(modelConfig.modelRef as string | Record<string, unknown>, 'Model');
    if (ref && !registry.get(ref.kind || 'Model', ref.name || '')) {
      errors.push({ resource: id(resource), path: 'spec.modelConfig.modelRef', message: 'Model 참조를 찾을 수 없습니다.' });
    }
  }

  const tools = (spec?.tools as Array<Record<string, unknown>> | undefined) || [];
  if (registry) {
    for (const toolRef of tools) {
      if (toolRef.selector) continue;
      const ref = normalizeObjectRef(toolRef as string | Record<string, unknown>, 'Tool');
      if (ref && !registry.get(ref.kind || 'Tool', ref.name || '')) {
        errors.push({ resource: id(resource), path: 'spec.tools', message: `Tool 참조를 찾을 수 없습니다: ${ref?.name}` });
      }
    }
  }
}

function validateSwarm(resource: Resource, registry: ConfigRegistry | undefined, errors: ValidationError[]) {
  const spec = resource.spec as Record<string, unknown> | undefined;
  const entrypoint = spec?.entrypoint as Record<string, unknown> | undefined;
  if (!entrypoint) {
    errors.push({ resource: id(resource), path: 'spec.entrypoint', message: 'Swarm.entrypoint가 필요합니다.' });
  } else if (registry) {
    const ref = normalizeObjectRef(entrypoint, 'Agent');
    if (ref && !registry.get(ref.kind || 'Agent', ref.name || '')) {
      errors.push({ resource: id(resource), path: 'spec.entrypoint', message: 'Entrypoint Agent를 찾을 수 없습니다.' });
    }
  }
  const agents = (spec?.agents as Array<Record<string, unknown>> | undefined) || [];
  if (agents.length === 0) {
    errors.push({ resource: id(resource), path: 'spec.agents', message: 'Swarm.agents는 최소 1개가 필요합니다.' });
  }

  const liveConfig = (spec?.policy as { liveConfig?: { enabled?: boolean; applyAt?: string[] } } | undefined)?.liveConfig;
  if (liveConfig?.enabled) {
    const applyAt = liveConfig.applyAt || [];
    if (!applyAt.includes('step.config')) {
      errors.push({ resource: id(resource), path: 'spec.policy.liveConfig.applyAt', message: 'applyAt에는 step.config가 포함되어야 합니다.' });
    }
  }
}

function validateConnector(resource: Resource, registry: ConfigRegistry | undefined, errors: ValidationError[]) {
  const spec = resource.spec as Record<string, unknown> | undefined;
  if (!spec?.type) {
    errors.push({ resource: id(resource), path: 'spec.type', message: 'Connector.spec.type이 필요합니다.' });
  }
  const auth = spec?.auth as Record<string, unknown> | undefined;
  const hasOauth = Boolean(auth?.oauthAppRef);
  const hasStatic = Boolean(auth?.staticToken);
  if (hasOauth && hasStatic) {
    errors.push({ resource: id(resource), path: 'spec.auth', message: 'oauthAppRef와 staticToken은 동시에 설정할 수 없습니다.' });
  }
  if (hasOauth && registry) {
    const ref = normalizeObjectRef(auth?.oauthAppRef as string | Record<string, unknown>, 'OAuthApp');
    if (ref && !registry.get(ref.kind || 'OAuthApp', ref.name || '')) {
      errors.push({ resource: id(resource), path: 'spec.auth.oauthAppRef', message: 'OAuthApp 참조를 찾을 수 없습니다.' });
    }
  }
  if (hasStatic) {
    const token = auth?.staticToken as ValueSource | undefined;
    if (!token?.value && !token?.valueFrom?.env && !token?.valueFrom?.secretRef) {
      errors.push({ resource: id(resource), path: 'spec.auth.staticToken', message: 'staticToken에는 value 또는 valueFrom이 필요합니다.' });
    }
  }
}

function validateOAuthApp(resource: Resource, options: ValidatorOptions, errors: ValidationError[]) {
  const spec = resource.spec as Record<string, unknown> | undefined;
  if (!spec?.provider) {
    errors.push({ resource: id(resource), path: 'spec.provider', message: 'OAuthApp.spec.provider가 필요합니다.' });
  }
  const flow = spec?.flow as string | undefined;
  if (!flow) {
    errors.push({ resource: id(resource), path: 'spec.flow', message: 'OAuthApp.spec.flow가 필요합니다.' });
  } else if (flow === 'deviceCode' && !options.allowDeviceCode) {
    errors.push({ resource: id(resource), path: 'spec.flow', message: 'deviceCode 플로우는 현재 지원되지 않습니다.' });
  }
  const subjectMode = spec?.subjectMode as string | undefined;
  if (!subjectMode) {
    errors.push({ resource: id(resource), path: 'spec.subjectMode', message: 'OAuthApp.spec.subjectMode가 필요합니다.' });
  }

  const client = spec?.client as { clientId?: ValueSource; clientSecret?: ValueSource } | undefined;
  validateValueSource(client?.clientId, resource, 'spec.client.clientId', errors);
  validateValueSource(client?.clientSecret, resource, 'spec.client.clientSecret', errors);

  if (flow === 'authorizationCode') {
    const endpoints = spec?.endpoints as Record<string, unknown> | undefined;
    if (!endpoints?.authorizationUrl) {
      errors.push({ resource: id(resource), path: 'spec.endpoints.authorizationUrl', message: 'authorizationUrl이 필요합니다.' });
    }
    if (!endpoints?.tokenUrl) {
      errors.push({ resource: id(resource), path: 'spec.endpoints.tokenUrl', message: 'tokenUrl이 필요합니다.' });
    }
    const redirect = spec?.redirect as Record<string, unknown> | undefined;
    if (!redirect?.callbackPath) {
      errors.push({ resource: id(resource), path: 'spec.redirect.callbackPath', message: 'callbackPath가 필요합니다.' });
    }
  }
}

function validateMcpServer(resource: Resource, errors: ValidationError[]) {
  const spec = resource.spec as Record<string, unknown> | undefined;
  const transport = (spec?.transport as Record<string, unknown> | undefined) || spec;
  const type = transport?.type as string | undefined;
  if (!type) {
    errors.push({ resource: id(resource), path: 'spec.transport.type', message: 'MCPServer.spec.transport.type이 필요합니다.' });
    return;
  }
  if (type === 'stdio') {
    const command = transport?.command as unknown[] | undefined;
    if (!command || command.length === 0) {
      errors.push({ resource: id(resource), path: 'spec.transport.command', message: 'stdio transport는 command가 필요합니다.' });
    }
  }
  if (type === 'http') {
    const url = transport?.url as string | undefined;
    if (!url) {
      errors.push({ resource: id(resource), path: 'spec.transport.url', message: 'http transport는 url이 필요합니다.' });
    }
  }
}

function validateCustomResource(resource: Resource, errors: ValidationError[]) {
  const spec = resource.spec as Record<string, unknown> | undefined;
  if (!spec?.handlerRef) {
    errors.push({ resource: id(resource), path: 'spec.handlerRef', message: 'handlerRef가 필요합니다.' });
  }
}

function validateValueSource(source: ValueSource | undefined, resource: Resource, path: string, errors: ValidationError[]) {
  if (!source) {
    errors.push({ resource: id(resource), path, message: 'ValueSource가 필요합니다.' });
    return;
  }
  if (source.value && source.valueFrom) {
    errors.push({ resource: id(resource), path, message: 'value와 valueFrom은 동시에 사용할 수 없습니다.' });
  }
  if (source.valueFrom && source.valueFrom.env && source.valueFrom.secretRef) {
    errors.push({ resource: id(resource), path, message: 'env와 secretRef는 동시에 사용할 수 없습니다.' });
  }
}

function validateToolAuthScopes(
  toolAuth: Record<string, unknown> | undefined,
  exportsList: Array<Record<string, unknown>>,
  registry: ConfigRegistry | undefined,
  errors: ValidationError[],
  resourceId: string
) {
  if (!toolAuth?.oauthAppRef || !registry) return;
  const ref = normalizeObjectRef(toolAuth.oauthAppRef as string | Record<string, unknown>, 'OAuthApp');
  if (!ref) return;
  const oauthApp = registry.get(ref.kind || 'OAuthApp', ref.name || '');
  if (!oauthApp) {
    errors.push({ resource: resourceId, path: 'spec.auth.oauthAppRef', message: 'OAuthApp 참조를 찾을 수 없습니다.' });
    return;
  }
  const allowedScopes = (oauthApp.spec as { scopes?: string[] })?.scopes || [];
  const toolScopes = (toolAuth.scopes as string[] | undefined) || [];
  if (!isSubset(toolScopes, allowedScopes)) {
    errors.push({ resource: resourceId, path: 'spec.auth.scopes', message: 'Tool scopes가 OAuthApp 범위를 벗어났습니다.' });
  }
  for (const exportDef of exportsList) {
    const exportAuth = exportDef.auth as { scopes?: string[] } | undefined;
    if (!exportAuth?.scopes) continue;
    if (!isSubset(exportAuth.scopes, allowedScopes)) {
      errors.push({ resource: resourceId, path: 'spec.exports[].auth.scopes', message: 'Export scopes가 OAuthApp 범위를 벗어났습니다.' });
    }
    if (toolScopes.length > 0 && !isSubset(exportAuth.scopes, toolScopes)) {
      errors.push({ resource: resourceId, path: 'spec.exports[].auth.scopes', message: 'Export scopes는 Tool auth 범위를 벗어날 수 없습니다.' });
    }
  }
}

function isSubset(target: string[], allowed: string[]): boolean {
  return target.every((value) => allowed.includes(value));
}

function id(resource: Resource): string {
  return `${resource.kind}/${resource.metadata?.name || 'unknown'}`;
}

interface ValueSource {
  value?: string;
  valueFrom?: {
    env?: string;
    secretRef?: { ref: string; key: string };
  };
}
