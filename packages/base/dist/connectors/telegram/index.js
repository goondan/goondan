function isTelegramApiResponse(data) {
    return typeof data.ok === 'boolean';
}
function isTelegramUpdateArray(data) {
    if (!Array.isArray(data))
        return false;
    return data.every((item) => typeof item === 'object' && item !== null && typeof item.update_id === 'number');
}
export const createTelegramConnectorAdapter = (options) => {
    const { runtime, connectorConfig, logger } = options;
    const spec = connectorConfig.spec;
    // Bot Token 획득
    const botTokenConfig = spec.botToken;
    let botToken = null;
    if (botTokenConfig?.value) {
        botToken = botTokenConfig.value;
    }
    else if (botTokenConfig?.valueFrom) {
        const valueFrom = botTokenConfig.valueFrom;
        if (valueFrom.env) {
            botToken = process.env[valueFrom.env] || null;
        }
    }
    if (!botToken) {
        logger?.warn?.('Telegram Bot Token이 설정되지 않았습니다. TELEGRAM_BOT_TOKEN 환경변수를 확인하세요.');
    }
    // Polling 설정
    const pollingConfig = spec.polling;
    const pollingEnabled = pollingConfig?.enabled !== false;
    const pollingTimeout = pollingConfig?.timeout || 30;
    // Ingress 라우팅 규칙
    const ingressRules = spec.ingress || [];
    // Egress 설정
    const egressConfig = spec.egress;
    const parseMode = egressConfig?.parseMode || 'Markdown';
    let offset = 0;
    let polling = false;
    let pollTimer = null;
    /**
     * Telegram API 호출
     */
    async function callTelegramApi(method, body) {
        if (!botToken) {
            throw new Error('Telegram Bot Token이 설정되지 않았습니다.');
        }
        const url = `https://api.telegram.org/bot${botToken}/${method}`;
        const response = await fetch(url, {
            method: body ? 'POST' : 'GET',
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
        });
        return (await response.json());
    }
    /**
     * 메시지 라우팅 및 처리
     */
    async function handleUpdate(update) {
        const msg = update.message;
        if (!msg?.text)
            return;
        const text = msg.text;
        const chatId = msg.chat.id;
        const userId = msg.from?.id;
        const username = msg.from?.username || msg.from?.first_name || 'Unknown';
        logger?.info?.(`[Telegram] ${username}: ${text}`);
        // Ingress 규칙 매칭
        for (const rule of ingressRules) {
            const match = rule.match;
            const route = rule.route;
            // command 매칭
            if (match?.command) {
                const cmd = match.command;
                if (!text.startsWith(cmd))
                    continue;
            }
            if (!route?.swarmRef)
                continue;
            const swarmRef = route.swarmRef;
            const instanceKey = `telegram-${chatId}`;
            // Runtime에 이벤트 전달
            await runtime.handleEvent({
                swarmRef,
                instanceKey,
                input: text,
                origin: {
                    connector: connectorConfig.metadata.name,
                    platform: 'telegram',
                    chatId,
                    messageId: msg.message_id,
                    userId,
                    username,
                },
                auth: {
                    actor: { type: 'user', id: `telegram:${userId}` },
                    subjects: {
                        global: `telegram:chat:${chatId}`,
                        user: `telegram:user:${userId}`,
                    },
                },
                metadata: {
                    connector: connectorConfig.metadata.name,
                    updateId: update.update_id,
                },
            });
            return;
        }
        // 기본 라우팅 (route만 있고 match가 없는 규칙)
        const defaultRule = ingressRules.find((r) => {
            const rule = r;
            return !rule.match && rule.route;
        });
        if (defaultRule) {
            const route = defaultRule.route;
            const swarmRef = route.swarmRef;
            const instanceKey = `telegram-${chatId}`;
            await runtime.handleEvent({
                swarmRef,
                instanceKey,
                input: text,
                origin: {
                    connector: connectorConfig.metadata.name,
                    platform: 'telegram',
                    chatId,
                    messageId: msg.message_id,
                    userId,
                    username,
                },
                auth: {
                    actor: { type: 'user', id: `telegram:${userId}` },
                    subjects: {
                        global: `telegram:chat:${chatId}`,
                        user: `telegram:user:${userId}`,
                    },
                },
                metadata: {
                    connector: connectorConfig.metadata.name,
                    updateId: update.update_id,
                },
            });
        }
    }
    /**
     * Long Polling 루프
     */
    async function pollLoop() {
        if (!polling || !botToken)
            return;
        try {
            const data = await callTelegramApi(`getUpdates?offset=${offset}&timeout=${pollingTimeout}`);
            if (isTelegramApiResponse(data) && data.ok && isTelegramUpdateArray(data.result)) {
                for (const update of data.result) {
                    offset = update.update_id + 1;
                    try {
                        await handleUpdate(update);
                    }
                    catch (err) {
                        logger?.error?.('Telegram 메시지 처리 오류:', err);
                        // 에러 발생 시 사용자에게 알림
                        if (update.message?.chat.id) {
                            await callTelegramApi('sendMessage', {
                                chat_id: update.message.chat.id,
                                text: `오류가 발생했습니다: ${err.message}`,
                            });
                        }
                    }
                }
            }
        }
        catch (err) {
            logger?.error?.('Telegram polling 오류:', err);
        }
        // 다음 polling 예약
        if (polling) {
            pollTimer = setTimeout(() => void pollLoop(), 100);
        }
    }
    const adapter = {
        /**
         * 외부에서 직접 이벤트를 전달받을 때 (Webhook 등)
         */
        async handleEvent(payload) {
            const updateId = payload.update_id;
            if (typeof updateId === 'number') {
                await handleUpdate(payload);
            }
        },
        /**
         * 메시지 전송
         */
        async send(input) {
            if (!botToken) {
                throw new Error('Telegram Bot Token이 설정되지 않았습니다.');
            }
            const chatId = input.origin?.chatId;
            if (!chatId) {
                logger?.warn?.('Telegram send: chatId가 없습니다.');
                return { ok: false, error: 'chatId not found in origin' };
            }
            const result = await callTelegramApi('sendMessage', {
                chat_id: chatId,
                text: input.text,
                parse_mode: parseMode,
            });
            return result;
        },
        /**
         * Long Polling 시작
         */
        async start() {
            if (!botToken) {
                logger?.warn?.('Telegram Bot Token이 없어 polling을 시작할 수 없습니다.');
                return;
            }
            if (!pollingEnabled) {
                logger?.info?.('Telegram polling이 비활성화되어 있습니다.');
                return;
            }
            polling = true;
            logger?.info?.(`Telegram 봇 polling 시작 (timeout: ${pollingTimeout}s)`);
            // 봇 정보 확인
            try {
                const me = await callTelegramApi('getMe');
                if (isTelegramApiResponse(me) && me.ok) {
                    const result = me.result;
                    logger?.info?.(`Telegram 봇: @${result.username}`);
                }
            }
            catch {
                // ignore
            }
            void pollLoop();
        },
        /**
         * Polling 중지
         */
        async stop() {
            polling = false;
            if (pollTimer) {
                clearTimeout(pollTimer);
                pollTimer = null;
            }
            logger?.info?.('Telegram 봇 polling 중지');
        },
    };
    return adapter;
};
//# sourceMappingURL=index.js.map