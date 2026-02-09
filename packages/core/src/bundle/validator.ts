/**
 * Bundle 리소스 검증
 * @see /docs/specs/bundle.md - 6. Validation 포인트 확장
 */

import { ValidationError } from './errors.js';
import type { Resource } from '../types/index.js';
import { getSpec, isObjectRefLike } from '../types/index.js';

/**
 * 유효한 runtime 값
 */
const VALID_RUNTIMES = ['node', 'python', 'deno'];

/**
 * metadata.name 명명 규칙 정규표현식
 * 소문자로 시작, 소문자/숫자/하이픈만 허용, 최대 63자
 */
const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
const MAX_NAME_LENGTH = 63;

interface CronFieldSpec {
  min: number;
  max: number;
  names?: readonly string[];
  namedValueStart?: number;
}

const MONTH_NAMES: readonly string[] = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
];

const DAY_NAMES: readonly string[] = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const CRON_5_FIELD_SPEC: readonly CronFieldSpec[] = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12, names: MONTH_NAMES, namedValueStart: 1 },
  { min: 0, max: 7, names: DAY_NAMES, namedValueStart: 0 },
];

const CRON_6_FIELD_SPEC: readonly CronFieldSpec[] = [
  { min: 0, max: 59 },
  ...CRON_5_FIELD_SPEC,
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveIntegerString(value: string): boolean {
  return /^\d+$/.test(value) && Number(value) > 0;
}

function parseCronValue(raw: string, spec: CronFieldSpec): number | null {
  if (/^\d+$/.test(raw)) {
    const value = Number(raw);
    return value >= spec.min && value <= spec.max ? value : null;
  }

  if (!spec.names) {
    return null;
  }

  const token = raw.toUpperCase();
  const nameIndex = spec.names.indexOf(token);
  if (nameIndex < 0) {
    return null;
  }

  const namedValueStart = spec.namedValueStart ?? spec.min;
  return namedValueStart + nameIndex;
}

function isCronRangeOrValueValid(raw: string, spec: CronFieldSpec): boolean {
  if (raw === '*') {
    return true;
  }

  const rangeParts = raw.split('-');
  if (rangeParts.length === 2) {
    const start = rangeParts[0];
    const end = rangeParts[1];
    if (!start || !end) {
      return false;
    }

    const startValue = parseCronValue(start, spec);
    const endValue = parseCronValue(end, spec);
    return (
      startValue !== null &&
      endValue !== null &&
      startValue <= endValue
    );
  }

  if (rangeParts.length > 2) {
    return false;
  }

  return parseCronValue(raw, spec) !== null;
}

function isCronSegmentValid(rawSegment: string, spec: CronFieldSpec): boolean {
  const slashParts = rawSegment.split('/');
  if (slashParts.length === 2) {
    const base = slashParts[0];
    const step = slashParts[1];
    if (!base || !step || !isPositiveIntegerString(step)) {
      return false;
    }
    return isCronRangeOrValueValid(base, spec);
  }

  if (slashParts.length > 2) {
    return false;
  }

  return isCronRangeOrValueValid(rawSegment, spec);
}

function isValidCronExpression(schedule: string): boolean {
  const fields = schedule.trim().split(/\s+/).filter(Boolean);
  const fieldSpec =
    fields.length === 5
      ? CRON_5_FIELD_SPEC
      : fields.length === 6
        ? CRON_6_FIELD_SPEC
        : null;

  if (!fieldSpec) {
    return false;
  }

  return fields.every((field, index) => {
    const spec = fieldSpec[index];
    if (!spec) {
      return false;
    }

    return field.split(',').every(
      (segment) => segment.length > 0 && isCronSegmentValid(segment, spec)
    );
  });
}

function pushValueSourceErrors(
  errors: ValidationError[],
  source: unknown,
  path: string,
  ctx: { kind: string; resourceName?: string }
): void {
  const sourceErrors = validateValueSource(source);
  for (const sourceError of sourceErrors) {
    errors.push(
      new ValidationError(sourceError.message, {
        ...ctx,
        path,
      })
    );
  }
}

/**
 * 단일 리소스 기본 검증 (공통 규칙)
 *
 * @param resource 검증할 리소스
 * @returns 검증 오류 배열
 */
export function validateResource(resource: Resource): ValidationError[] {
  const errors: ValidationError[] = [];

  // apiVersion 검증
  if (!resource.apiVersion) {
    errors.push(
      new ValidationError('apiVersion is required', {
        path: '/apiVersion',
        kind: resource.kind,
        resourceName: resource.metadata?.name,
        suggestion: 'Add "apiVersion: agents.example.io/v1alpha1" to the resource definition',
      })
    );
  }

  // kind 검증
  if (!resource.kind) {
    errors.push(
      new ValidationError('kind is required', {
        path: '/kind',
        resourceName: resource.metadata?.name,
        suggestion: 'Specify one of: Model, Tool, Extension, Agent, Swarm, Connector, OAuthApp, Secret',
      })
    );
  }

  // metadata 검증
  if (!resource.metadata) {
    errors.push(
      new ValidationError('metadata is required', {
        path: '/metadata',
        kind: resource.kind,
        suggestion: 'Add "metadata: { name: <resource-name> }" to the resource definition',
      })
    );
  } else {
    // metadata.name 검증
    if (!resource.metadata.name) {
      errors.push(
        new ValidationError('metadata.name is required', {
          path: '/metadata/name',
          kind: resource.kind,
        })
      );
    } else {
      // 명명 규칙 검증 (SHOULD - 경고)
      if (
        !NAME_PATTERN.test(resource.metadata.name) ||
        resource.metadata.name.length > MAX_NAME_LENGTH
      ) {
        errors.push(
          new ValidationError(
            `metadata.name "${resource.metadata.name}" should follow naming convention: lowercase, numbers, hyphens, max 63 chars, start with letter`,
            {
              path: '/metadata/name',
              kind: resource.kind,
              resourceName: resource.metadata.name,
              level: 'warning',
            }
          )
        );
      }
    }

    // labels 검증
    if (resource.metadata.labels) {
      for (const [key, value] of Object.entries(resource.metadata.labels)) {
        if (typeof value !== 'string') {
          errors.push(
            new ValidationError(
              `label value for "${key}" must be a string`,
              {
                path: `/metadata/labels/${key}`,
                kind: resource.kind,
                resourceName: resource.metadata.name,
              }
            )
          );
        }
      }
    }

    // annotations 검증
    if (resource.metadata.annotations) {
      for (const [key, value] of Object.entries(
        resource.metadata.annotations
      )) {
        if (typeof value !== 'string') {
          errors.push(
            new ValidationError(
              `annotation value for "${key}" must be a string`,
              {
                path: `/metadata/annotations/${key}`,
                kind: resource.kind,
                resourceName: resource.metadata.name,
              }
            )
          );
        }
      }
    }
  }

  return errors;
}

/**
 * 여러 리소스 검증 (Kind별 필수/선택 필드)
 *
 * @param resources 검증할 리소스 배열
 * @returns 검증 오류 배열
 */
export function validateResources(resources: Resource[]): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const resource of resources) {
    // Package는 프로젝트 메타 리소스이므로 런타임 리소스 검증을 건너뜀
    if (resource.kind === 'Package') continue;

    // 공통 검증
    errors.push(...validateResource(resource));

    // Kind별 검증
    switch (resource.kind) {
      case 'Model':
        errors.push(...validateModel(resource));
        break;
      case 'Tool':
        errors.push(...validateTool(resource));
        break;
      case 'Extension':
        errors.push(...validateExtension(resource));
        break;
      case 'Agent':
        errors.push(...validateAgent(resource));
        break;
      case 'Swarm':
        errors.push(...validateSwarm(resource));
        break;
      case 'Connector':
        errors.push(...validateConnector(resource));
        break;
      case 'Connection':
        errors.push(...validateConnection(resource));
        break;
      case 'OAuthApp':
        errors.push(...validateOAuthApp(resource));
        break;
      case 'ResourceType':
        errors.push(...validateResourceType(resource));
        break;
      case 'ExtensionHandler':
        errors.push(...validateExtensionHandler(resource));
        break;
    }
  }

  return errors;
}

/**
 * 이름 유일성 검증 (동일 kind 내)
 */
export function validateNameUniqueness(
  resources: Resource[]
): ValidationError[] {
  const errors: ValidationError[] = [];
  const seen = new Map<string, Resource>();

  for (const resource of resources) {
    const key = `${resource.kind}/${resource.metadata?.name}`;
    const existing = seen.get(key);

    if (existing) {
      errors.push(
        new ValidationError(
          `duplicate resource name: ${key}`,
          {
            path: '/metadata/name',
            kind: resource.kind,
            resourceName: resource.metadata?.name,
          }
        )
      );
    } else {
      seen.set(key, resource);
    }
  }

  return errors;
}

/**
 * ObjectRef 검증
 */
export function validateObjectRef(ref: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (typeof ref === 'string') {
    // 문자열 축약 형식: "Kind/name"
    const slashIndex = ref.indexOf('/');
    if (slashIndex === -1) {
      errors.push(
        new ValidationError(
          `Invalid ObjectRef format: "${ref}". Expected "Kind/name"`,
          {}
        )
      );
      return errors;
    }

    const kind = ref.substring(0, slashIndex);
    const name = ref.substring(slashIndex + 1);

    if (!kind) {
      errors.push(
        new ValidationError(
          `Invalid ObjectRef: kind is missing in "${ref}"`,
          {}
        )
      );
    }

    if (!name) {
      errors.push(
        new ValidationError(
          `Invalid ObjectRef: name is missing in "${ref}"`,
          {}
        )
      );
    }

    // 두 번째 슬래시가 있으면 오류
    if (name.includes('/')) {
      errors.push(
        new ValidationError(
          `Invalid ObjectRef format: "${ref}". Too many "/" separators`,
          {}
        )
      );
    }
  } else if (ref !== null && typeof ref === 'object' && !Array.isArray(ref)) {
    // 객체형 형식
    const objRef = ref as Record<string, unknown>;

    if (!objRef.kind || typeof objRef.kind !== 'string') {
      errors.push(
        new ValidationError(
          'ObjectRef object must have "kind" field',
          {}
        )
      );
    }

    if (!objRef.name || typeof objRef.name !== 'string') {
      errors.push(
        new ValidationError(
          'ObjectRef object must have "name" field',
          {}
        )
      );
    }
  } else {
    errors.push(
      new ValidationError(
        'Invalid ObjectRef: must be string "Kind/name" or object { kind, name }',
        {}
      )
    );
  }

  return errors;
}

/**
 * ValueSource 검증 (상호 배타 규칙)
 */
export function validateValueSource(source: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (source === null || typeof source !== 'object' || Array.isArray(source)) {
    errors.push(
      new ValidationError(
        'ValueSource must be an object',
        {}
      )
    );
    return errors;
  }

  const vs = source as Record<string, unknown>;
  const hasValue = 'value' in vs && vs.value !== undefined;
  const hasValueFrom = 'valueFrom' in vs && vs.valueFrom !== undefined;

  // value와 valueFrom 상호 배타
  if (hasValue && hasValueFrom) {
    errors.push(
      new ValidationError(
        'value and valueFrom are mutually exclusive',
        {}
      )
    );
    return errors;
  }

  // 둘 다 없으면 오류
  if (!hasValue && !hasValueFrom) {
    errors.push(
      new ValidationError(
        'ValueSource must have either "value" or "valueFrom"',
        {}
      )
    );
    return errors;
  }

  // valueFrom 검증
  if (hasValueFrom) {
    const valueFrom = vs.valueFrom as Record<string, unknown>;

    if (
      valueFrom === null ||
      typeof valueFrom !== 'object' ||
      Array.isArray(valueFrom)
    ) {
      errors.push(
        new ValidationError(
          'valueFrom must be an object',
          {}
        )
      );
      return errors;
    }

    const hasEnv = 'env' in valueFrom && valueFrom.env !== undefined;
    const hasSecretRef =
      'secretRef' in valueFrom && valueFrom.secretRef !== undefined;

    // env와 secretRef 상호 배타
    if (hasEnv && hasSecretRef) {
      errors.push(
        new ValidationError(
          'valueFrom.env and valueFrom.secretRef are mutually exclusive',
          {}
        )
      );
      return errors;
    }

    if (!hasEnv && !hasSecretRef) {
      errors.push(
        new ValidationError(
          'valueFrom must have either "env" or "secretRef"',
          {}
        )
      );
      return errors;
    }

    // secretRef 형식 검증
    if (hasSecretRef) {
      const secretRef = valueFrom.secretRef as Record<string, unknown>;
      if (
        typeof secretRef.ref !== 'string' ||
        !secretRef.ref.startsWith('Secret/')
      ) {
        errors.push(
          new ValidationError(
            'secretRef.ref must be in format "Secret/<name>"',
            {}
          )
        );
      }
    }
  }

  return errors;
}

/**
 * scopes 부분집합 검증
 */
export function validateScopesSubset(
  childScopes: string[],
  parentScopes: string[],
  path: string
): ValidationError[] {
  const errors: ValidationError[] = [];
  const parentSet = new Set(parentScopes);

  for (const scope of childScopes) {
    if (!parentSet.has(scope)) {
      errors.push(
        new ValidationError(
          `Scope "${scope}" is not a subset of parent scopes`,
          { path }
        )
      );
    }
  }

  return errors;
}

// ==================== Kind별 검증 ====================

function validateModel(resource: Resource): ValidationError[] {
  const errors: ValidationError[] = [];
  const spec = getSpec(resource);
  const ctx = { kind: resource.kind, resourceName: resource.metadata?.name };

  if (!spec.provider) {
    errors.push(
      new ValidationError('spec.provider is required for Model', {
        ...ctx,
        path: '/spec/provider',
      })
    );
  }

  if (!spec.name) {
    errors.push(
      new ValidationError('spec.name is required for Model', {
        ...ctx,
        path: '/spec/name',
      })
    );
  }

  return errors;
}

function validateTool(resource: Resource): ValidationError[] {
  const errors: ValidationError[] = [];
  const spec = getSpec(resource);
  const ctx = { kind: resource.kind, resourceName: resource.metadata?.name };

  // runtime 검증
  if (!spec.runtime) {
    errors.push(
      new ValidationError('spec.runtime is required for Tool', {
        ...ctx,
        path: '/spec/runtime',
      })
    );
  } else if (!VALID_RUNTIMES.includes(spec.runtime as string)) {
    errors.push(
      new ValidationError(
        `spec.runtime must be one of: ${VALID_RUNTIMES.join(', ')}`,
        {
          ...ctx,
          path: '/spec/runtime',
          expected: VALID_RUNTIMES.join(' | '),
          actual: String(spec.runtime),
        }
      )
    );
  }

  // entry 검증
  if (!spec.entry) {
    errors.push(
      new ValidationError('spec.entry is required for Tool', {
        ...ctx,
        path: '/spec/entry',
      })
    );
  }

  // exports 검증
  if (
    !spec.exports ||
    !Array.isArray(spec.exports) ||
    spec.exports.length === 0
  ) {
    errors.push(
      new ValidationError(
        'spec.exports is required and must have at least one export',
        {
          ...ctx,
          path: '/spec/exports',
        }
      )
    );
  } else {
    // 각 export 검증
    for (let i = 0; i < spec.exports.length; i++) {
      const exp = spec.exports[i] as Record<string, unknown>;
      if (!exp.name) {
        errors.push(
          new ValidationError(`spec.exports[${i}].name is required`, {
            ...ctx,
            path: `/spec/exports/${i}/name`,
          })
        );
      }
      if (!exp.description) {
        errors.push(
          new ValidationError(
            `spec.exports[${i}].description is required`,
            {
              ...ctx,
              path: `/spec/exports/${i}/description`,
            }
          )
        );
      }
      if (!exp.parameters) {
        errors.push(
          new ValidationError(
            `spec.exports[${i}].parameters is required`,
            {
              ...ctx,
              path: `/spec/exports/${i}/parameters`,
            }
          )
        );
      }
    }
  }

  return errors;
}

function validateExtension(resource: Resource): ValidationError[] {
  const errors: ValidationError[] = [];
  const spec = getSpec(resource);
  const ctx = { kind: resource.kind, resourceName: resource.metadata?.name };

  if (!spec.runtime) {
    errors.push(
      new ValidationError('spec.runtime is required for Extension', {
        ...ctx,
        path: '/spec/runtime',
      })
    );
  } else if (!VALID_RUNTIMES.includes(spec.runtime as string)) {
    errors.push(
      new ValidationError(
        `spec.runtime must be one of: ${VALID_RUNTIMES.join(', ')}`,
        {
          ...ctx,
          path: '/spec/runtime',
        }
      )
    );
  }

  if (!spec.entry) {
    errors.push(
      new ValidationError('spec.entry is required for Extension', {
        ...ctx,
        path: '/spec/entry',
      })
    );
  }

  return errors;
}

function validateAgent(resource: Resource): ValidationError[] {
  const errors: ValidationError[] = [];
  const spec = getSpec(resource);
  const ctx = { kind: resource.kind, resourceName: resource.metadata?.name };

  // modelConfig 검증
  if (!spec.modelConfig) {
    errors.push(
      new ValidationError('spec.modelConfig is required for Agent', {
        ...ctx,
        path: '/spec/modelConfig',
      })
    );
  } else {
    const modelConfig = spec.modelConfig as Record<string, unknown>;
    if (!modelConfig.modelRef) {
      errors.push(
        new ValidationError(
          'spec.modelConfig.modelRef is required for Agent',
          {
            ...ctx,
            path: '/spec/modelConfig/modelRef',
          }
        )
      );
    }
  }

  // prompts 검증
  if (!spec.prompts) {
    errors.push(
      new ValidationError('spec.prompts is required for Agent', {
        ...ctx,
        path: '/spec/prompts',
      })
    );
  } else {
    const prompts = spec.prompts as Record<string, unknown>;
    const hasSystem = 'system' in prompts && prompts.system !== undefined;
    const hasSystemRef =
      'systemRef' in prompts && prompts.systemRef !== undefined;

    if (!hasSystem && !hasSystemRef) {
      errors.push(
        new ValidationError(
          'spec.prompts must have either "system" or "systemRef"',
          {
            ...ctx,
            path: '/spec/prompts',
          }
        )
      );
    }

    if (hasSystem && hasSystemRef) {
      errors.push(
        new ValidationError(
          'spec.prompts cannot have both "system" and "systemRef"',
          {
            ...ctx,
            path: '/spec/prompts',
          }
        )
      );
    }
  }

  return errors;
}

function validateSwarm(resource: Resource): ValidationError[] {
  const errors: ValidationError[] = [];
  const spec = getSpec(resource);
  const ctx = { kind: resource.kind, resourceName: resource.metadata?.name };

  if (!spec.entrypoint) {
    errors.push(
      new ValidationError('spec.entrypoint is required for Swarm', {
        ...ctx,
        path: '/spec/entrypoint',
      })
    );
  }

  if (!spec.agents || !Array.isArray(spec.agents) || spec.agents.length === 0) {
    errors.push(
      new ValidationError(
        'spec.agents is required and must have at least one agent',
        {
          ...ctx,
          path: '/spec/agents',
        }
      )
    );
  }

  // policy 검증
  if (spec.policy && typeof spec.policy === 'object') {
    const policy = spec.policy as Record<string, unknown>;

    // maxStepsPerTurn 검증
    if (policy.maxStepsPerTurn !== undefined) {
      if (typeof policy.maxStepsPerTurn !== 'number' || policy.maxStepsPerTurn <= 0) {
        errors.push(
          new ValidationError(
            'spec.policy.maxStepsPerTurn must be a positive number',
            {
              ...ctx,
              path: '/spec/policy/maxStepsPerTurn',
            }
          )
        );
      }
    }

    // queueMode 검증
    if (policy.queueMode !== undefined && policy.queueMode !== 'serial') {
      errors.push(
        new ValidationError(
          'spec.policy.queueMode must be "serial"',
          {
            ...ctx,
            path: '/spec/policy/queueMode',
            expected: 'serial',
            actual: String(policy.queueMode),
          }
        )
      );
    }

    // lifecycle 검증
    if (policy.lifecycle && typeof policy.lifecycle === 'object') {
      const lifecycle = policy.lifecycle as Record<string, unknown>;

      if (lifecycle.autoPauseIdleSeconds !== undefined &&
          (typeof lifecycle.autoPauseIdleSeconds !== 'number' || lifecycle.autoPauseIdleSeconds <= 0)) {
        errors.push(
          new ValidationError(
            'spec.policy.lifecycle.autoPauseIdleSeconds must be a positive number',
            {
              ...ctx,
              path: '/spec/policy/lifecycle/autoPauseIdleSeconds',
            }
          )
        );
      }

      if (lifecycle.ttlSeconds !== undefined &&
          (typeof lifecycle.ttlSeconds !== 'number' || lifecycle.ttlSeconds <= 0)) {
        errors.push(
          new ValidationError(
            'spec.policy.lifecycle.ttlSeconds must be a positive number',
            {
              ...ctx,
              path: '/spec/policy/lifecycle/ttlSeconds',
            }
          )
        );
      }

      if (lifecycle.gcGraceSeconds !== undefined &&
          (typeof lifecycle.gcGraceSeconds !== 'number' || lifecycle.gcGraceSeconds <= 0)) {
        errors.push(
          new ValidationError(
            'spec.policy.lifecycle.gcGraceSeconds must be a positive number',
            {
              ...ctx,
              path: '/spec/policy/lifecycle/gcGraceSeconds',
            }
          )
        );
      }
    }
  }

  return errors;
}

/**
 * 유효한 trigger 타입
 */
const VALID_TRIGGER_TYPES = ['http', 'cron', 'cli', 'custom'];

/**
 * 유효한 HTTP 메서드
 */
const VALID_HTTP_METHODS = ['POST', 'GET', 'PUT', 'DELETE'];

function validateConnector(resource: Resource): ValidationError[] {
  const errors: ValidationError[] = [];
  const spec = getSpec(resource);
  const ctx = { kind: resource.kind, resourceName: resource.metadata?.name };
  let cliTriggerCount = 0;

  // runtime 검증 (현재 'node'만 지원)
  if (!spec.runtime) {
    errors.push(
      new ValidationError('spec.runtime is required for Connector', {
        ...ctx,
        path: '/spec/runtime',
      })
    );
  } else if (spec.runtime !== 'node') {
    errors.push(
      new ValidationError(
        'spec.runtime must be "node" for Connector',
        {
          ...ctx,
          path: '/spec/runtime',
          expected: 'node',
          actual: String(spec.runtime),
        }
      )
    );
  }

  // entry 검증
  if (!spec.entry) {
    errors.push(
      new ValidationError('spec.entry is required for Connector', {
        ...ctx,
        path: '/spec/entry',
      })
    );
  }

  // triggers 검증 (최소 1개)
  if (!spec.triggers || !Array.isArray(spec.triggers) || spec.triggers.length === 0) {
    errors.push(
      new ValidationError(
        'spec.triggers is required and must have at least one trigger declaration',
        {
          ...ctx,
          path: '/spec/triggers',
        }
      )
    );
  } else {
    for (let i = 0; i < spec.triggers.length; i++) {
      const triggerRaw = spec.triggers[i];
      if (!isRecord(triggerRaw)) {
        errors.push(
          new ValidationError(
            `spec.triggers[${i}] must be an object`,
            {
              ...ctx,
              path: `/spec/triggers/${i}`,
            }
          )
        );
        continue;
      }

      const triggerType =
        typeof triggerRaw.type === 'string' ? triggerRaw.type : undefined;
      if (!triggerType || !VALID_TRIGGER_TYPES.includes(triggerType)) {
        errors.push(
          new ValidationError(
            `spec.triggers[${i}].type must be one of: ${VALID_TRIGGER_TYPES.join(', ')}`,
            {
              ...ctx,
              path: `/spec/triggers/${i}/type`,
            }
          )
        );
      }

      if (triggerType === 'cli') {
        cliTriggerCount += 1;
      }

      // http trigger: endpoint.path 및 endpoint.method 검증
      if (triggerType === 'http') {
        const endpointRaw = triggerRaw.endpoint;
        if (!isRecord(endpointRaw)) {
          errors.push(
            new ValidationError(
              `spec.triggers[${i}].endpoint is required for http trigger`,
              {
                ...ctx,
                path: `/spec/triggers/${i}/endpoint`,
              }
            )
          );
        } else {
          if (
            typeof endpointRaw.path !== 'string' ||
            !endpointRaw.path.startsWith('/')
          ) {
            errors.push(
              new ValidationError(
                `spec.triggers[${i}].endpoint.path must be a string starting with "/"`,
                {
                  ...ctx,
                  path: `/spec/triggers/${i}/endpoint/path`,
                }
              )
            );
          }
          if (
            typeof endpointRaw.method !== 'string' ||
            !VALID_HTTP_METHODS.includes(endpointRaw.method)
          ) {
            errors.push(
              new ValidationError(
                `spec.triggers[${i}].endpoint.method must be one of: ${VALID_HTTP_METHODS.join(', ')}`,
                {
                  ...ctx,
                  path: `/spec/triggers/${i}/endpoint/method`,
                }
              )
            );
          }
        }
      }

      // cron trigger: schedule 검증
      if (triggerType === 'cron') {
        if (
          typeof triggerRaw.schedule !== 'string' ||
          triggerRaw.schedule.trim().length === 0
        ) {
          errors.push(
            new ValidationError(
              `spec.triggers[${i}].schedule is required for cron trigger`,
              {
                ...ctx,
                path: `/spec/triggers/${i}/schedule`,
              }
            )
          );
        } else if (!isValidCronExpression(triggerRaw.schedule)) {
          errors.push(
            new ValidationError(
              `spec.triggers[${i}].schedule must be a valid cron expression (5-field or 6-field)`,
              {
                ...ctx,
                path: `/spec/triggers/${i}/schedule`,
              }
            )
          );
        }
      }
    }

    if (cliTriggerCount > 1) {
      errors.push(
        new ValidationError(
          'spec.triggers can include at most one "cli" trigger',
          {
            ...ctx,
            path: '/spec/triggers',
            expected: 'max 1 cli trigger',
            actual: String(cliTriggerCount),
          }
        )
      );
    }
  }

  // events 이름 고유성 검증
  if (spec.events && Array.isArray(spec.events)) {
    const eventNames = new Set<string>();
    for (let i = 0; i < spec.events.length; i++) {
      const event = spec.events[i] as Record<string, unknown>;
      if (!event.name || typeof event.name !== 'string') {
        errors.push(
          new ValidationError(
            `spec.events[${i}].name is required and must be a string`,
            {
              ...ctx,
              path: `/spec/events/${i}/name`,
            }
          )
        );
      } else if (eventNames.has(event.name)) {
        errors.push(
          new ValidationError(
            `spec.events[${i}].name "${event.name}" is not unique within the Connector`,
            {
              ...ctx,
              path: `/spec/events/${i}/name`,
            }
          )
        );
      } else {
        eventNames.add(event.name);
      }
    }
  }

  return errors;
}

function validateConnection(resource: Resource): ValidationError[] {
  const errors: ValidationError[] = [];
  const spec = getSpec(resource);
  const ctx = { kind: resource.kind, resourceName: resource.metadata?.name };

  // connectorRef 필수 검증
  if (!spec.connectorRef) {
    errors.push(
      new ValidationError('spec.connectorRef is required for Connection', {
        ...ctx,
        path: '/spec/connectorRef',
      })
    );
  }

  // swarmRef 형식 검증 (선택 필드)
  if (spec.swarmRef !== undefined && !isObjectRefLike(spec.swarmRef)) {
    errors.push(
      new ValidationError(
        'spec.swarmRef must be a valid ObjectRefLike (e.g. { kind: "Swarm", name: "..." })',
        {
          ...ctx,
          path: '/spec/swarmRef',
        }
      )
    );
  }

  // auth 상호 배타 검증
  if (isRecord(spec.auth)) {
    const auth = spec.auth;
    const hasOAuthAppRef =
      Object.prototype.hasOwnProperty.call(auth, 'oauthAppRef') &&
      auth.oauthAppRef !== undefined;
    const hasStaticToken =
      Object.prototype.hasOwnProperty.call(auth, 'staticToken') &&
      auth.staticToken !== undefined;

    if (hasOAuthAppRef && hasStaticToken) {
      errors.push(
        new ValidationError(
          'spec.auth cannot have both "oauthAppRef" and "staticToken"',
          {
            ...ctx,
            path: '/spec/auth',
          }
        )
      );
    }

    if (hasStaticToken) {
      pushValueSourceErrors(
        errors,
        auth.staticToken,
        '/spec/auth/staticToken',
        ctx
      );
    }
  }

  if (
    isRecord(spec.verify) &&
    isRecord(spec.verify.webhook) &&
    Object.prototype.hasOwnProperty.call(spec.verify.webhook, 'signingSecret')
  ) {
    pushValueSourceErrors(
      errors,
      spec.verify.webhook.signingSecret,
      '/spec/verify/webhook/signingSecret',
      ctx
    );
  }

  return errors;
}

function validateOAuthApp(resource: Resource): ValidationError[] {
  const errors: ValidationError[] = [];
  const spec = getSpec(resource);
  const ctx = { kind: resource.kind, resourceName: resource.metadata?.name };

  // 필수 필드 검증
  if (!spec.provider) {
    errors.push(
      new ValidationError('spec.provider is required for OAuthApp', {
        ...ctx,
        path: '/spec/provider',
      })
    );
  }

  if (!spec.flow) {
    errors.push(
      new ValidationError('spec.flow is required for OAuthApp', {
        ...ctx,
        path: '/spec/flow',
      })
    );
  }

  if (!spec.subjectMode) {
    errors.push(
      new ValidationError('spec.subjectMode is required for OAuthApp', {
        ...ctx,
        path: '/spec/subjectMode',
      })
    );
  }

  if (!spec.scopes || !Array.isArray(spec.scopes) || spec.scopes.length === 0) {
    errors.push(
      new ValidationError(
        'spec.scopes is required and must have at least one scope',
        {
          ...ctx,
          path: '/spec/scopes',
        }
      )
    );
  }

  if (!isRecord(spec.client)) {
    errors.push(
      new ValidationError('spec.client is required for OAuthApp', {
        ...ctx,
        path: '/spec/client',
      })
    );
  } else {
    const client = spec.client;
    if (!Object.prototype.hasOwnProperty.call(client, 'clientId')) {
      errors.push(
        new ValidationError('spec.client.clientId is required for OAuthApp', {
          ...ctx,
          path: '/spec/client/clientId',
        })
      );
    } else {
      pushValueSourceErrors(
        errors,
        client.clientId,
        '/spec/client/clientId',
        ctx
      );
    }

    if (!Object.prototype.hasOwnProperty.call(client, 'clientSecret')) {
      errors.push(
        new ValidationError('spec.client.clientSecret is required for OAuthApp', {
          ...ctx,
          path: '/spec/client/clientSecret',
        })
      );
    } else {
      pushValueSourceErrors(
        errors,
        client.clientSecret,
        '/spec/client/clientSecret',
        ctx
      );
    }
  }

  const endpoints = isRecord(spec.endpoints) ? spec.endpoints : undefined;
  if (typeof endpoints?.tokenUrl !== 'string' || endpoints.tokenUrl.length === 0) {
    errors.push(
      new ValidationError('spec.endpoints.tokenUrl is required for OAuthApp', {
        ...ctx,
        path: '/spec/endpoints/tokenUrl',
      })
    );
  }

  if (spec.flow === 'deviceCode') {
    errors.push(
      new ValidationError(
        'spec.flow=deviceCode is not supported by the current runtime and must be rejected at load time',
        {
          ...ctx,
          path: '/spec/flow',
          actual: 'deviceCode',
        }
      )
    );
  }

  // authorizationCode flow 추가 검증
  if (spec.flow === 'authorizationCode') {
    if (
      typeof endpoints?.authorizationUrl !== 'string' ||
      endpoints.authorizationUrl.length === 0
    ) {
      errors.push(
        new ValidationError(
          'spec.endpoints.authorizationUrl is required for authorizationCode flow',
          {
            ...ctx,
            path: '/spec/endpoints/authorizationUrl',
          }
        )
      );
    }

    const redirect = isRecord(spec.redirect) ? spec.redirect : undefined;
    if (
      typeof redirect?.callbackPath !== 'string' ||
      redirect.callbackPath.length === 0
    ) {
      errors.push(
        new ValidationError(
          'spec.redirect.callbackPath is required for authorizationCode flow',
          {
            ...ctx,
            path: '/spec/redirect/callbackPath',
          }
        )
      );
    }
  }

  return errors;
}

function validateResourceType(resource: Resource): ValidationError[] {
  const errors: ValidationError[] = [];
  const spec = getSpec(resource);
  const ctx = { kind: resource.kind, resourceName: resource.metadata?.name };

  if (!spec.group) {
    errors.push(
      new ValidationError('spec.group is required for ResourceType', {
        ...ctx,
        path: '/spec/group',
      })
    );
  }

  if (!spec.names) {
    errors.push(
      new ValidationError('spec.names is required for ResourceType', {
        ...ctx,
        path: '/spec/names',
      })
    );
  }

  if (
    !spec.versions ||
    !Array.isArray(spec.versions) ||
    spec.versions.length === 0
  ) {
    errors.push(
      new ValidationError(
        'spec.versions is required and must have at least one version',
        {
          ...ctx,
          path: '/spec/versions',
        }
      )
    );
  }

  if (!spec.handlerRef) {
    errors.push(
      new ValidationError(
        'spec.handlerRef is required for ResourceType',
        {
          ...ctx,
          path: '/spec/handlerRef',
        }
      )
    );
  }

  return errors;
}

function validateExtensionHandler(resource: Resource): ValidationError[] {
  const errors: ValidationError[] = [];
  const spec = getSpec(resource);
  const ctx = { kind: resource.kind, resourceName: resource.metadata?.name };

  if (!spec.runtime) {
    errors.push(
      new ValidationError(
        'spec.runtime is required for ExtensionHandler',
        {
          ...ctx,
          path: '/spec/runtime',
        }
      )
    );
  }

  if (!spec.entry) {
    errors.push(
      new ValidationError(
        'spec.entry is required for ExtensionHandler',
        {
          ...ctx,
          path: '/spec/entry',
        }
      )
    );
  }

  if (
    !spec.exports ||
    !Array.isArray(spec.exports) ||
    spec.exports.length === 0
  ) {
    errors.push(
      new ValidationError(
        'spec.exports is required and must have at least one export',
        {
          ...ctx,
          path: '/spec/exports',
        }
      )
    );
  }

  return errors;
}

// ==================== 유틸리티 ====================

// 미래 사용을 위해 보존 (현재 미사용)
// function getResourceIdentifier(resource: Resource): string {
//   const kind = resource.kind ?? 'Unknown';
//   const name = resource.metadata?.name ?? 'unnamed';
//   return `${kind}/${name}`;
// }
