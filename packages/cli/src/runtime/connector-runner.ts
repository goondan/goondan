/**
 * Connector Runner - Connection 리소스 감지 및 커넥터 실행
 *
 * Bundle에서 Connection 리소스를 감지하고, 참조된 Connector 타입에 따라
 * 적절한 커넥터 러너를 생성한다.
 *
 * @see /docs/specs/connection.md
 * @see /docs/specs/connector.md
 */

import type { BundleLoadResult } from "@goondan/core";
import type { Resource } from "@goondan/core";
import type { IngressRule, IngressMatch, IngressRoute } from "@goondan/core";
import type { ValueSource } from "@goondan/core";
import { resolveValueSource } from "@goondan/core";
import type { ValueSourceContext } from "@goondan/core";

/**
 * 감지된 Connection + Connector 쌍
 */
export interface DetectedConnection {
  connectionResource: Resource;
  connectorResource: Resource;
  connectorType: string;
  connectorName: string;
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
 * Resource<unknown>에서 spec을 Record<string, unknown>으로 안전하게 추출
 */
function getSpec(resource: Resource): Record<string, unknown> {
  const spec = resource.spec;
  if (typeof spec === "object" && spec !== null && !Array.isArray(spec)) {
    return spec as Record<string, unknown>;
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
 * Bundle에서 Connection 리소스를 감지하고 Connector와 매핑
 */
export function detectConnections(bundle: BundleLoadResult): DetectedConnection[] {
  const connections = bundle.getResourcesByKind("Connection");
  const results: DetectedConnection[] = [];

  for (const conn of connections) {
    const spec = getSpec(conn);

    // connectorRef 추출
    const connectorRef = spec["connectorRef"];
    const connectorName = resolveRefName(connectorRef);
    if (!connectorName) continue;

    // Connector 리소스 찾기
    const connectorResource = bundle.getResource("Connector", connectorName);
    if (!connectorResource) continue;

    // Connector type 추출
    const connectorSpec = getSpec(connectorResource);
    const connectorType = connectorSpec["type"];
    if (typeof connectorType !== "string") continue;

    results.push({
      connectionResource: conn,
      connectorResource,
      connectorType,
      connectorName,
    });
  }

  return results;
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

  const ctx: ValueSourceContext = {
    env: process.env as Record<string, string | undefined>,
    secrets: {},
  };

  try {
    return resolveValueSource(tokenSource, ctx);
  } catch {
    return null;
  }
}

/**
 * Connection rules를 IngressRule[]로 변환 (type-safe)
 */
export function toIngressRules(connectionResource: Resource): IngressRule[] {
  const spec = getSpec(connectionResource);
  const rawRules = spec["rules"];
  if (!Array.isArray(rawRules)) return [];

  const rules: IngressRule[] = [];

  for (const raw of rawRules) {
    if (!isObjectWithKey(raw, "route")) continue;
    const rawRoute = raw.route;
    if (!isObjectWithKey(rawRoute, "swarmRef")) continue;

    const route: IngressRoute = {
      swarmRef: rawRoute.swarmRef as import("@goondan/core").ObjectRefLike,
    };

    if (isObjectWithKey(rawRoute, "instanceKeyFrom") && typeof rawRoute.instanceKeyFrom === "string") {
      route.instanceKeyFrom = rawRoute.instanceKeyFrom;
    }
    if (isObjectWithKey(rawRoute, "inputFrom") && typeof rawRoute.inputFrom === "string") {
      route.inputFrom = rawRoute.inputFrom;
    }
    if (isObjectWithKey(rawRoute, "agentName") && typeof rawRoute.agentName === "string") {
      route.agentName = rawRoute.agentName;
    }

    const rule: IngressRule = { route };

    if (isObjectWithKey(raw, "match") && typeof raw.match === "object" && raw.match !== null) {
      const rawMatch = raw.match;
      const match: IngressMatch = {};
      if (isObjectWithKey(rawMatch, "command") && typeof rawMatch.command === "string") {
        match.command = rawMatch.command;
      }
      if (isObjectWithKey(rawMatch, "eventType") && typeof rawMatch.eventType === "string") {
        match.eventType = rawMatch.eventType;
      }
      if (isObjectWithKey(rawMatch, "channel") && typeof rawMatch.channel === "string") {
        match.channel = rawMatch.channel;
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
