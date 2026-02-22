const DEFAULT_IDLE_THRESHOLD_MS = 1800000; // 30분

function createId(prefix) {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${random}`;
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}시간 ${minutes}분`;
  }
  return `${minutes}분`;
}

export function register(api) {
  api.pipeline.register('turn', async (ctx) => {
    // ── turn.pre ──
    try {
      const state = await api.state.get();
      const lastTurnCompletedAt = state?.lastTurnCompletedAt;

      if (lastTurnCompletedAt != null) {
        const now = Date.now();
        const idleDuration = now - lastTurnCompletedAt;

        if (idleDuration >= DEFAULT_IDLE_THRESHOLD_MS) {
          const formatted = formatDuration(idleDuration);
          api.logger?.debug?.('idle detected', { idleDuration, formatted });

          ctx.emitMessageEvent({
            type: 'append',
            message: {
              id: createId('msg'),
              data: {
                role: 'system',
                content: [
                  '[idle_detected]',
                  `idle_duration=${formatted} (${idleDuration}ms)`,
                  `last_activity=${new Date(lastTurnCompletedAt).toISOString()}`,
                  '[/idle_detected]',
                ].join('\n'),
              },
              metadata: {
                'idle-monitor.idleDetected': true,
              },
              createdAt: new Date(),
              source: {
                type: 'extension',
                extensionName: 'idle-monitor',
              },
            },
          });
        }
      }
    } catch {
      // state 로드 실패 시 조용히 패스
    }

    // ── LLM Turn 실행 ──
    const result = await ctx.next();

    // ── turn.post ──
    try {
      await api.state.set({ lastTurnCompletedAt: Date.now() });
    } catch {
      // state 저장 실패 시 조용히 패스
    }

    return result;
  });
}
