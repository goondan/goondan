/**
 * ChangesetPolicy 검증
 * @see /docs/specs/changeset.md - 6. ChangesetPolicy 검증
 */

import type { ChangesetPolicy, PolicyValidationResult } from './types.js';
import { matchAnyPattern } from './glob.js';

/**
 * 변경된 파일들이 ChangesetPolicy를 만족하는지 검증한다.
 *
 * 규칙:
 * - Swarm.allowed.files가 "최대 허용 범위"이다.
 * - Agent.allowed.files는 "해당 Agent의 추가 제약"으로 해석한다.
 * - Agent가 생성/커밋하는 changeset은 Swarm.allowed + Agent.allowed 모두를 만족해야 허용된다.
 *
 * @param changedFiles - 변경된 파일 경로 목록
 * @param swarmPolicy - Swarm 수준 ChangesetPolicy
 * @param agentPolicy - Agent 수준 ChangesetPolicy
 * @returns 검증 결과
 */
export function validateChangesetPolicy(
  changedFiles: string[],
  swarmPolicy: ChangesetPolicy | undefined,
  agentPolicy: ChangesetPolicy | undefined
): PolicyValidationResult {
  // 변경된 파일이 없으면 항상 유효
  if (changedFiles.length === 0) {
    return { valid: true, violatedFiles: [] };
  }

  // changesets가 비활성화되어 있으면 모든 변경 거부
  if (swarmPolicy?.enabled === false) {
    return { valid: false, violatedFiles: changedFiles };
  }

  // Swarm allowed.files 패턴
  const swarmPatterns = swarmPolicy?.allowed?.files ?? [];

  // Agent allowed.files 패턴 (추가 제약)
  // Agent 패턴이 비어있으면 Swarm 패턴으로 폴백
  const agentPatternsRaw = agentPolicy?.allowed?.files;
  const agentPatterns = (agentPatternsRaw && agentPatternsRaw.length > 0)
    ? agentPatternsRaw
    : swarmPatterns;

  const violatedFiles: string[] = [];

  for (const file of changedFiles) {
    // Swarm 정책 검사 (최대 허용 범위)
    const matchesSwarm = matchAnyPattern(file, swarmPatterns);

    // Agent 정책 검사 (추가 제약)
    const matchesAgent = matchAnyPattern(file, agentPatterns);

    // 두 정책 모두 만족해야 함
    if (!matchesSwarm || !matchesAgent) {
      violatedFiles.push(file);
    }
  }

  return {
    valid: violatedFiles.length === 0,
    violatedFiles,
  };
}
