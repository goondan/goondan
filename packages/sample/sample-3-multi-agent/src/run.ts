#!/usr/bin/env node
/**
 * Sample 3: Multi-Agent Telegram Bot 실행 스크립트
 *
 * Telegram 커넥터를 등록하고 런타임을 실행합니다.
 *
 * 사용법:
 *   TELEGRAM_BOT_TOKEN=... ANTHROPIC_API_KEY=... pnpm telegram
 */
import { Runtime, loadConfigFiles, loadBundleResources } from '@goondan/core';
import { createTelegramConnector } from './connectors/telegram/index.js';
import type { JsonObject, Resource } from '@goondan/core';
import * as path from 'node:path';
import * as fs from 'node:fs';

async function main() {
  // 환경 변수 확인
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN 환경변수가 필요합니다.');
    console.error('사용법: TELEGRAM_BOT_TOKEN=... pnpm telegram');
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY 환경변수가 필요합니다.');
    process.exit(1);
  }

  if (!process.env.GOONDAN_DATA_SECRET_KEY) {
    console.error('GOONDAN_DATA_SECRET_KEY 환경변수가 필요합니다. (32바이트 hex)');
    console.error('생성: export GOONDAN_DATA_SECRET_KEY=$(openssl rand -hex 32)');
    process.exit(1);
  }

  const projectRoot = path.resolve(import.meta.dirname, '..');
  const configPath = path.join(projectRoot, 'goondan.yaml');
  const stateRootDir = path.join(projectRoot, 'state');

  // 모든 리소스 수집
  const allResources: Resource[] = [];

  // Bundle 로드
  console.log('Bundle 로딩 중...');
  const bundlesJsonPath = path.join(stateRootDir, 'bundles.json');
  if (fs.existsSync(bundlesJsonPath)) {
    const bundlesJson = JSON.parse(fs.readFileSync(bundlesJsonPath, 'utf8')) as {
      bundles: Array<{ path: string; enabled: boolean }>;
    };
    const enabledPaths = bundlesJson.bundles.filter((b) => b.enabled && b.path).map((b) => b.path);
    if (enabledPaths.length > 0) {
      const bundleResources = await loadBundleResources(enabledPaths, {
        baseDir: projectRoot,
        stateRootDir,
      });
      allResources.push(...bundleResources);
    }
  }

  // Config 로드
  console.log('Config 로딩 중...');
  const registry = await loadConfigFiles([configPath], { baseDir: projectRoot });

  // Bundle 리소스를 Registry에 추가
  for (const res of allResources) {
    registry.add(res);
  }

  // Runtime 생성
  const runtime = new Runtime({
    registry,
    stateRootDir,
    validateOnInit: false,
  });

  // Telegram 커넥터 어댑터 등록
  runtime.registerConnectorAdapter('telegram', (options) => {
    const adapter = createTelegramConnector({
      runtime: {
        handleEvent: async (event) => {
          await runtime.handleEvent({
            swarmRef: event.swarmRef,
            instanceKey: event.instanceKey,
            agentName: event.agentName as string | undefined,
            input: event.input,
            origin: event.origin as JsonObject | undefined,
            auth: event.auth as JsonObject | undefined,
            metadata: event.metadata as JsonObject | undefined,
          });
        },
      },
      connectorConfig: options.connectorConfig as JsonObject,
      logger: options.logger,
    });
    return adapter;
  });

  // 런타임 초기화
  await runtime.init();

  console.log('Telegram 봇 시작...');
  console.log('봇 토큰:', process.env.TELEGRAM_BOT_TOKEN.slice(0, 10) + '...');
  console.log('\n봇에게 메시지를 보내세요. 종료하려면 Ctrl+C를 누르세요.\n');

  // Telegram 커넥터 가져오기
  const telegramConnector = registry.get('Connector', 'telegram');
  if (!telegramConnector) {
    console.error('Telegram Connector가 config에 정의되어 있지 않습니다.');
    process.exit(1);
  }

  // Polling 시작
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const pollingConfig = (telegramConnector.spec as JsonObject).polling as JsonObject | undefined;
  const timeout = (pollingConfig?.timeout as number) || 30;

  let offset = 0;

  const poll = async () => {
    try {
      const url = `https://api.telegram.org/bot${botToken}/getUpdates?offset=${offset}&timeout=${timeout}`;
      const response = await fetch(url);
      const data = (await response.json()) as {
        ok: boolean;
        result?: Array<{
          update_id: number;
          message?: {
            message_id: number;
            chat: { id: number; type: string };
            from?: { id: number; username?: string; first_name?: string };
            text?: string;
            date: number;
          };
        }>;
      };

      if (data.ok && data.result) {
        for (const update of data.result) {
          offset = update.update_id + 1;

          if (update.message?.text) {
            const msg = update.message;
            console.log(`[수신] ${msg.from?.username || msg.from?.first_name || 'Unknown'}: ${msg.text}`);

            // Connector를 통해 이벤트 처리
            try {
              await runtime.handleConnectorEvent('telegram', {
                update_id: update.update_id,
                message: msg,
                chat_id: msg.chat.id,
                text: msg.text,
                instanceKey: `telegram-${msg.chat.id}`,
              });
            } catch (err) {
              console.error('이벤트 처리 오류:', err);
              // 에러 메시지를 Telegram으로 전송
              await sendTelegramMessage(botToken, msg.chat.id, `오류가 발생했습니다: ${(err as Error).message}`);
            }
          }
        }
      }
    } catch (err) {
      console.error('Polling 오류:', err);
    }

    // 다음 polling
    setTimeout(poll, 100);
  };

  // Polling 시작
  poll();

  // 종료 시그널 처리
  process.on('SIGINT', () => {
    console.log('\n봇 종료 중...');
    process.exit(0);
  });
}

async function sendTelegramMessage(botToken: string, chatId: number, text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
    }),
  });
}

main().catch((err) => {
  console.error('실행 오류:', err);
  process.exit(1);
});
