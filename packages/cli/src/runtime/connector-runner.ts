/**
 * Connector Runner - Connection 리소스 감지 및 커넥터 실행
 *
 * Bundle에서 Connection 리소스를 감지하고, spec.triggers[].type에 따라
 * 적절한 커넥터 러너를 생성한다.
 *
 * 설계 원칙:
 * - Connector 종류 판별은 오직 triggers[].type으로만 수행 (spec.type은 v1.0에서 제거됨)
 * - run.ts는 개별 connector 이름/구현을 알 필요 없음 — 이 모듈의 factory 함수만 사용
 *
 * @see /docs/specs/connection.md
 * @see /docs/specs/connector.md
 */

import type { BundleLoadResult } from "@goondan/core";
import type { Resource } from "@goondan/core";
import type { IngressRule, IngressMatch, IngressRoute } from "@goondan/core";
import type { ValueSource } from "@goondan/core";
import { resolveValueSource, isObjectRefLike } from "@goondan/core";
import type { ValueSourceContext } from "@goondan/core";
import type { RuntimeContext, ProcessConnectorTurnResult } from "./types.js";

/**
 * 감지된 Connection + Connector 쌍
 */
export interface DetectedConnection {
  connectionResource: Resource;
  connectorResource: Resource;
  connectorType: string;
  connectorName: string;
  /** Connection이 바인딩된 Swarm 이름 (swarmRef에서 추출, 없으면 undefined) */
  swarmName?: string;
}

/**
 * detectConnections 결과
 */
export interface DetectConnectionsResult {
  connections: DetectedConnection[];
  warnings: string[];
}

/**
 * 커넥터 러너 인터페이스
 */
export interface ConnectorRunner {
  start(): Promise<void>;
  shutdown(): Promise<void>;
}

/**
 * 타입 가드: object이고 특정 key를 갖는지 확인
 */
export function isObjectWithKey<K extends string>(
  value: unknown,
  key: K,
): value is Record<K, unknown> {
  return typeof value === "object" && value !== null && key in value;
}

/**
 * plain object 타입 가드
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Resource<unknown>에서 spec을 Record<string, unknown>으로 안전하게 추출
 */
function getSpec(resource: Resource): Record<string, unknown> {
  const spec = resource.spec;
  if (isPlainObject(spec)) {
    return spec;
  }
  return {};
}

/**
 * ObjectRefLike에서 name 추출
 */
function resolveRefName(ref: unknown): string | null {
  if (typeof ref === "string") {
    const parts = ref.split("/");
    if (parts.length === 2 && parts[1]) {
      return parts[1];
    }
    return ref;
  }
  if (isObjectWithKey(ref, "name") && typeof ref.name === "string") {
    return ref.name;
  }
  return null;
}

/**
 * ConnectorSpec의 triggers[0].type을 추출
 * v1.0: Connector 종류는 오직 triggers[].type으로만 판별
 */
function resolveTriggerType(spec: Record<string, unknown>): string | null {
  const triggers = spec["triggers"];
  if (Array.isArray(triggers) && triggers.length > 0) {
    const first = triggers[0];
    if (isObjectWithKey(first, "type") && typeof first.type === "string") {
      return first.type;
    }
  }
  return null;
}

/**
 * Bundle에서 Connection 리소스를 감지하고 Connector와 매핑
 */
export function detectConnections(bundle: BundleLoadResult): DetectConnectionsResult {
  const connections = bundle.getResourcesByKind("Connection");
  const results: DetectedConnection[] = [];
  const warnings: string[] = [];

  for (const conn of connections) {
    const spec = getSpec(conn);
    const connName = conn.metadata?.name ?? "unknown";

    // connectorRef 추출
    const connectorRef = spec["connectorRef"];
    const connectorName = resolveRefName(connectorRef);
    if (!connectorName) continue;

    // Connector 리소스 찾기
    const connectorResource = bundle.getResource("Connector", connectorName);
    if (!connectorResource) {
      warnings.push(`Connection '${connName}': Connector '${connectorName}' not found in bundle`);
      continue;
    }

    // Connector trigger type 추출 (triggers[0].type)
    const connectorSpec = getSpec(connectorResource);
    const connectorType = resolveTriggerType(connectorSpec);
    if (!connectorType) {
      warnings.push(`Connection '${connName}': Connector '${connectorName}' has no triggers defined`);
      continue;
    }

    // swarmRef에서 swarmName 추출
    const swarmRef = spec["swarmRef"];
    const swarmName = resolveRefName(swarmRef) ?? undefined;

    results.push({
      connectionResource: conn,
      connectorResource,
      connectorType,
      connectorName,
      swarmName,
    });
  }

  return { connections: results, warnings };
}

/**
 * ValueSource 타입 가드
 */
function isValueSource(value: unknown): value is ValueSource {
  if (typeof value !== "object" || value === null) return false;
  if (isObjectWithKey(value, "value") && typeof value.value === "string") {
    return true;
  }
  if (isObjectWithKey(value, "valueFrom")) {
    const vf = value.valueFrom;
    if (typeof vf === "object" && vf !== null) {
      return isObjectWithKey(vf, "env") || isObjectWithKey(vf, "secretRef");
    }
  }
  return false;
}

/**
 * Connection의 auth.staticToken에서 토큰 추출
 */
export function extractStaticToken(connectionResource: Resource): string | null {
  const spec = getSpec(connectionResource);
  const auth = spec["auth"];
  if (!isObjectWithKey(auth, "staticToken")) return null;

  const tokenSource = auth.staticToken;
  if (!isValueSource(tokenSource)) return null;

  const envRecord: Record<string, string | undefined> = { ...process.env };
  const ctx: ValueSourceContext = {
    env: envRecord,
    secrets: {},
  };

  try {
    return resolveValueSource(tokenSource, ctx);
  } catch {
    return null;
  }
}

/**
 * Connection의 ingress.rules를 IngressRule[]로 변환 (type-safe)
 */
export function toIngressRules(connectionResource: Resource): IngressRule[] {
  const spec = getSpec(connectionResource);

  // 새 스펙: ingress.rules 경로
  const ingress = spec["ingress"];
  let rawRules: unknown[] | undefined;
  if (isObjectWithKey(ingress, "rules") && Array.isArray(ingress.rules)) {
    rawRules = ingress.rules;
  }

  // 레거시 호환: spec.rules 직접 경로
  if (!rawRules && Array.isArray(spec["rules"])) {
    rawRules = spec["rules"];
  }

  if (!rawRules) return [];

  const rules: IngressRule[] = [];

  for (const raw of rawRules) {
    if (!isObjectWithKey(raw, "route")) continue;
    const rawRoute = raw.route;

    const route: IngressRoute = {};

    // 새 스펙: agentRef (ObjectRefLike)
    if (isObjectWithKey(rawRoute, "agentRef")) {
      const agentRef = rawRoute.agentRef;
      if (typeof agentRef === "string") {
        route.agentRef = agentRef;
      } else if (isObjectRefLike(agentRef)) {
        route.agentRef = agentRef;
      }
    }

    const rule: IngressRule = { route };

    if (isObjectWithKey(raw, "match") && typeof raw.match === "object" && raw.match !== null) {
      const rawMatch = raw.match;
      const match: IngressMatch = {};
      if (isObjectWithKey(rawMatch, "event") && typeof rawMatch.event === "string") {
        match.event = rawMatch.event;
      }
      if (isObjectWithKey(rawMatch, "properties") && isPlainObject(rawMatch.properties)) {
        const propsObj = rawMatch.properties;
        const props: Record<string, string | number | boolean> = {};
        for (const key of Object.keys(propsObj)) {
          const value = propsObj[key];
          if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            props[key] = value;
          }
        }
        if (Object.keys(props).length > 0) {
          match.properties = props;
        }
      }
      rule.match = match;
    }

    rules.push(rule);
  }

  return rules;
}

/**
 * route에서 agentName 추출 (agentName 또는 agentRef.name)
 */
export function resolveAgentFromRoute(route: unknown): string | undefined {
  if (!isObjectWithKey(route, "agentName") && !isObjectWithKey(route, "agentRef")) {
    return undefined;
  }

  // 스펙 준수: agentName
  if (isObjectWithKey(route, "agentName") && typeof route.agentName === "string") {
    return route.agentName;
  }

  // 호환: agentRef: { kind: Agent, name: planner }
  if (isObjectWithKey(route, "agentRef")) {
    const ref = route.agentRef;
    if (isObjectWithKey(ref, "name") && typeof ref.name === "string") {
      return ref.name;
    }
    if (typeof ref === "string") {
      return resolveRefName(ref) ?? undefined;
    }
  }

  return undefined;
}

/**
 * ConnectorRunner factory 옵션
 */
export interface CreateConnectorRunnerOptions {
  runtimeCtx: RuntimeContext;
  detected: DetectedConnection;
  processConnectorTurn: (
    ctx: RuntimeContext,
    options: { instanceKey: string; agentName?: string; input: string },
  ) => Promise<ProcessConnectorTurnResult>;
}

/**
 * trigger type 기반으로 적절한 ConnectorRunner를 생성
 *
 * - "cli": null 반환 (run.ts에서 interactive mode로 처리)
 * - "custom": 범용 custom connector runner (현재 telegram 등 long-polling 기반)
 * - "http": 미구현 (null 반환)
 * - "cron": 미구현 (null 반환)
 *
 * @returns ConnectorRunner 또는 null (cli/미구현 trigger type)
 */
export async function createConnectorRunner(
  options: CreateConnectorRunnerOptions,
): Promise<ConnectorRunner | null> {
  const { detected } = options;

  switch (detected.connectorType) {
    case "cli":
      // CLI trigger는 run.ts의 interactive mode에서 처리
      return null;

    case "custom": {
      // custom trigger: connector entry function 기반 runner
      // 현재는 TelegramConnectorRunner를 동적 import로 로드
      const { TelegramConnectorRunner } = await import("./telegram-connector.js");
      return new TelegramConnectorRunner({
        runtimeCtx: options.runtimeCtx,
        connectionResource: detected.connectionResource,
        connectorResource: detected.connectorResource,
        processConnectorTurn: options.processConnectorTurn,
      });
    }

    default:
      // http, cron 등 미구현 trigger type
      return null;
  }
}
