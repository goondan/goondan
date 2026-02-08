/**
 * Changeset 관련 타입 정의
 * @see /docs/specs/changeset.md
 */

// ============================================================
// SwarmBundleRef
// ============================================================

/**
 * SwarmBundleRef는 특정 SwarmBundle 스냅샷을 식별하는 불변 식별자이다.
 * Git 기반 구현에서는 "git:<commit-sha>" 형식을 사용한다.
 */
export type SwarmBundleRef = string;

/**
 * SwarmBundleRef를 파싱한 결과
 */
export interface ParsedSwarmBundleRef {
  type: 'git';
  commitSha: string;
}

/**
 * SwarmBundleRef를 파싱한다.
 * @param ref - 파싱할 SwarmBundleRef
 * @returns 파싱된 결과
 * @throws ref가 유효하지 않은 형식인 경우
 */
export function parseSwarmBundleRef(ref: SwarmBundleRef): ParsedSwarmBundleRef {
  if (ref.startsWith('git:')) {
    const commitSha = ref.slice(4);
    if (commitSha.length === 0) {
      throw new Error(`Invalid SwarmBundleRef format: ${ref}`);
    }
    return { type: 'git', commitSha };
  }
  throw new Error(`Invalid SwarmBundleRef format: ${ref}`);
}

/**
 * commit SHA로 SwarmBundleRef를 생성한다.
 * @param commitSha - Git commit SHA
 * @returns SwarmBundleRef
 */
export function formatSwarmBundleRef(commitSha: string): SwarmBundleRef {
  return `git:${commitSha}`;
}

// ============================================================
// OpenChangeset
// ============================================================

/**
 * openChangeset 입력
 */
export interface OpenChangesetInput {
  /**
   * Changeset을 여는 이유 (선택)
   */
  reason?: string;
}

/**
 * openChangeset 결과
 */
export interface OpenChangesetResult {
  /**
   * Changeset 고유 식별자
   */
  changesetId: string;

  /**
   * 기준 SwarmBundleRef (Changeset이 기반으로 하는 스냅샷)
   */
  baseRef: SwarmBundleRef;

  /**
   * Git worktree 경로 (쓰기 가능)
   */
  workdir: string;

  /**
   * 수정 힌트 (선택)
   */
  hint?: OpenChangesetHint;
}

/**
 * Changeset 힌트
 */
export interface OpenChangesetHint {
  /**
   * workdir 내에서 Bundle 루트의 상대 경로 (보통 ".")
   */
  bundleRootInWorkdir: string;

  /**
   * 수정을 권장하는 파일/디렉터리 패턴
   */
  recommendedFiles: string[];
}

// ============================================================
// CommitChangeset
// ============================================================

/**
 * commitChangeset 입력
 */
export interface CommitChangesetInput {
  /**
   * 커밋할 Changeset의 ID
   */
  changesetId: string;

  /**
   * Git commit 메시지 (선택)
   */
  message?: string;
}

/**
 * commitChangeset 결과
 */
export interface CommitChangesetResult {
  /**
   * 처리 결과 상태
   * - ok: 성공적으로 커밋됨
   * - rejected: ChangesetPolicy 위반으로 거부됨
   * - conflict: baseRef와 현재 HEAD가 불일치
   * - failed: 기타 오류로 실패함
   */
  status: 'ok' | 'rejected' | 'conflict' | 'failed';

  /**
   * Changeset ID
   */
  changesetId: string;

  /**
   * 기준 SwarmBundleRef
   */
  baseRef: SwarmBundleRef;

  /**
   * 새로 생성된 SwarmBundleRef (status가 ok인 경우에만)
   */
  newRef?: SwarmBundleRef;

  /**
   * 변경 요약 (status가 ok인 경우에만)
   */
  summary?: CommitSummary;

  /**
   * 오류 정보 (status가 rejected, conflict, failed인 경우)
   */
  error?: CommitError;
}

/**
 * 커밋 요약
 */
export interface CommitSummary {
  /**
   * 변경된 파일 목록
   */
  filesChanged: string[];

  /**
   * 추가된 파일 목록
   */
  filesAdded: string[];

  /**
   * 삭제된 파일 목록
   */
  filesDeleted: string[];
}

/**
 * 커밋 오류
 */
export interface CommitError {
  /**
   * 오류 코드
   */
  code: string;

  /**
   * 오류 메시지
   */
  message: string;

  /**
   * 위반된 파일 목록 (rejected인 경우)
   */
  violatedFiles?: string[];

  /**
   * 충돌 파일 목록 (conflict인 경우)
   */
  conflictingFiles?: string[];
}

// ============================================================
// ChangesetPolicy
// ============================================================

/**
 * Changeset 정책
 */
export interface ChangesetPolicy {
  /**
   * Changeset 기능 활성화 여부 (기본값: true)
   */
  enabled?: boolean;

  /**
   * 적용 시점
   */
  applyAt?: string[];

  /**
   * 허용 범위
   */
  allowed?: {
    /**
     * 허용되는 파일 패턴
     */
    files?: string[];
  };

  /**
   * revision 변경 이벤트 발행 여부
   */
  emitRevisionChangedEvent?: boolean;
}

/**
 * 정책 검증 결과
 */
export interface PolicyValidationResult {
  /**
   * 유효 여부
   */
  valid: boolean;

  /**
   * 위반된 파일 목록
   */
  violatedFiles: string[];
}

// ============================================================
// Git Status
// ============================================================

/**
 * Git status 항목의 상태 코드
 */
export type GitStatusCode = 'A' | 'M' | 'D' | 'R' | '?';

/**
 * Git status 항목
 */
export interface GitStatusEntry {
  /**
   * 상태 코드
   * - A: 추가됨
   * - M: 수정됨
   * - D: 삭제됨
   * - R: 이름 변경됨
   * - ?: 추적되지 않음
   */
  status: GitStatusCode;

  /**
   * 파일 경로
   */
  path: string;
}

// ============================================================
// SwarmBundleManager
// ============================================================

/**
 * SwarmBundle 관리자 인터페이스
 */
export interface SwarmBundleManager {
  /**
   * 현재 활성 SwarmBundleRef를 반환한다.
   */
  getActiveRef(): Promise<SwarmBundleRef>;

  /**
   * 새 Changeset을 열고 Git worktree를 생성한다.
   */
  openChangeset(input?: OpenChangesetInput): Promise<OpenChangesetResult>;

  /**
   * Changeset의 변경 사항을 Git commit으로 만들고 활성 Ref를 업데이트한다.
   */
  commitChangeset(input: CommitChangesetInput): Promise<CommitChangesetResult>;

  /**
   * 열린 Changeset을 정리(폐기)한다.
   */
  discardChangeset(changesetId: string): Promise<void>;
}

// ============================================================
// SwarmBundleApi (Extension/Tool 컨텍스트용)
// ============================================================

/**
 * SwarmBundle API 인터페이스 (Extension/Tool에서 사용)
 */
export interface SwarmBundleApi {
  /**
   * 새 Changeset을 연다.
   */
  openChangeset: (input?: OpenChangesetInput) => Promise<OpenChangesetResult>;

  /**
   * Changeset을 커밋한다.
   */
  commitChangeset: (input: CommitChangesetInput) => Promise<CommitChangesetResult>;

  /**
   * 현재 활성 Ref를 반환한다.
   */
  getActiveRef: () => SwarmBundleRef;
}

// ============================================================
// Events
// ============================================================

/**
 * revision 변경 이벤트
 */
export interface RevisionChangedEvent {
  /**
   * 이벤트 타입
   */
  type: 'swarmBundle.revisionChanged';

  /**
   * 이전 SwarmBundleRef
   */
  previousRef: SwarmBundleRef;

  /**
   * 새 SwarmBundleRef
   */
  newRef: SwarmBundleRef;

  /**
   * Changeset ID
   */
  changesetId: string;

  /**
   * 변경 요약
   */
  summary: CommitSummary;

  /**
   * 타임스탬프 (ISO8601)
   */
  timestamp: string;
}

/**
 * Changeset 이벤트 레코드
 */
export interface ChangesetEventRecord {
  /**
   * 이벤트 타입
   */
  type: 'agent.event';

  /**
   * 이벤트 종류
   */
  kind:
    | 'changeset.committed'
    | 'changeset.rejected'
    | 'changeset.conflict'
    | 'changeset.failed';

  /**
   * 기록 시간 (ISO8601)
   */
  recordedAt: string;

  /**
   * Instance ID
   */
  instanceId: string;

  /**
   * Instance Key
   */
  instanceKey: string;

  /**
   * Agent 이름
   */
  agentName: string;

  /**
   * Turn ID (선택)
   */
  turnId?: string;

  /**
   * Step ID (선택)
   */
  stepId?: string;

  /**
   * Step 인덱스 (선택)
   */
  stepIndex?: number;

  /**
   * 이벤트 데이터
   */
  data: {
    changesetId: string;
    baseRef: SwarmBundleRef;
    newRef?: SwarmBundleRef;
    status: 'ok' | 'rejected' | 'conflict' | 'failed';
    summary?: CommitSummary;
    error?: CommitError;
  };
}
