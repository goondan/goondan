/**
 * SwarmBundleApi 생성
 * @see /docs/specs/changeset.md - 11. TypeScript 인터페이스
 */

import type {
  SwarmBundleApi,
  OpenChangesetInput,
  OpenChangesetResult,
  CommitChangesetInput,
  CommitChangesetResult,
  SwarmBundleRef,
} from './types.js';
import type { SwarmBundleManagerImpl } from './manager.js';

/**
 * SwarmBundleManager로부터 SwarmBundleApi를 생성한다.
 *
 * SwarmBundleApi는 Extension/Tool에서 사용하기 위한 간소화된 인터페이스이다.
 *
 * @param manager - SwarmBundleManager 인스턴스
 * @returns SwarmBundleApi
 */
export function createSwarmBundleApi(manager: SwarmBundleManagerImpl): SwarmBundleApi {
  return {
    /**
     * 새 Changeset을 연다.
     */
    openChangeset: async (input?: OpenChangesetInput): Promise<OpenChangesetResult> => {
      return manager.openChangeset(input);
    },

    /**
     * Changeset을 커밋한다.
     */
    commitChangeset: async (input: CommitChangesetInput): Promise<CommitChangesetResult> => {
      return manager.commitChangeset(input);
    },

    /**
     * 현재 활성 Ref를 반환한다.
     */
    getActiveRef: (): SwarmBundleRef => {
      // Manager의 동기 메서드 사용
      return manager.getActiveRefSync();
    },
  };
}
