/**
 * Telegram Connector Runner
 *
 * Telegram Bot API 롱 폴링으로 메시지를 수신하고,
 * Connection rules에 따라 라우팅하여 Turn을 실행한 뒤
 * 응답을 Telegram으로 전송한다.
 *
 * @see /docs/specs/connector.md
 */

import chalk from "chalk";
import {
  routeEvent,
  createCanonicalEventFromIngress,
} from "@goondan/core";
import type { Resource, JsonObject } from "@goondan/core";
import { info, warn, debug, error as logError } from "../utils/logger.js";
import type { ConnectorRunner } from "./connector-runner.js";
import {
  extractStaticToken,
  toIngressRules,
  isObjectWithKey,
  resolveAgentFromRoute,
} from "./connector-runner.js";
import type { RuntimeContext, ProcessConnectorTurnResult } from "./types.js";

/**
 * Telegram 커넥터 옵션
 */
export interface TelegramConnectorOptions {
  runtimeCtx: RuntimeContext;
  connectionResource: Resource;
  connectorResource: Resource;
  processConnectorTurn: (
    ctx: RuntimeContext,
    options: { instanceKey: string; agentName?: string; input: string },
  ) => Promise<ProcessConnectorTurnResult>;
}

/**
 * Telegram 롱 폴링 커넥터 러너
 */
export class TelegramConnectorRunner implements ConnectorRunner {
  private running = false;
  private abortController: AbortController | null = null;
  private offset = 0;
  private readonly options: TelegramConnectorOptions;

  constructor(options: TelegramConnectorOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    const token = extractStaticToken(this.options.connectionResource);
    if (!token) {
      logError(
        "Telegram bot token not configured.\n" +
        "Set TELEGRAM_BOT_TOKEN environment variable and use:\n" +
        "  auth:\n" +
        "    staticToken:\n" +
        "      valueFrom:\n" +
        '        env: "TELEGRAM_BOT_TOKEN"',
      );
      return;
    }

    this.running = true;
    this.abortController = new AbortController();

    console.log();
    console.log(chalk.bold.green("Telegram bot started"));
    info("Polling for updates... Press Ctrl+C to stop.");
    console.log();

    try {
      while (this.running) {
        await this.pollOnce(token);
      }
    } finally {
      console.log();
      info("Telegram bot stopped.");
    }
  }

  async shutdown(): Promise<void> {
    this.running = false;
    this.abortController?.abort();
  }

  /**
   * 단일 폴링 이터레이션
   */
  private async pollOnce(token: string): Promise<void> {
    const url = `https://api.telegram.org/bot${token}/getUpdates`;
    const params = new URLSearchParams({
      offset: String(this.offset),
      timeout: "30",
      allowed_updates: JSON.stringify(["message"]),
    });

    try {
      const response = await fetch(`${url}?${params.toString()}`, {
        signal: this.abortController?.signal,
      });

      if (!response.ok) {
        warn(`Telegram API error: ${response.status} ${response.statusText}`);
        await this.sleep(5000);
        return;
      }

      const body: unknown = await response.json();
      if (!isObjectWithKey(body, "ok") || body.ok !== true) {
        const desc = isObjectWithKey(body, "description") ? String(body.description) : "unknown";
        warn(`Telegram API error: ${desc}`);
        await this.sleep(5000);
        return;
      }

      if (!isObjectWithKey(body, "result") || !Array.isArray(body.result)) {
        return;
      }

      for (const update of body.result) {
        if (!isObjectWithKey(update, "update_id") || typeof update.update_id !== "number") {
          continue;
        }
        this.offset = update.update_id + 1;
        await this.handleUpdate(token, update).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          warn(`Failed to handle update: ${msg}`);
        });
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      warn(`Polling error: ${err instanceof Error ? err.message : String(err)}`);
      await this.sleep(5000);
    }
  }

  /**
   * 단일 Telegram update 처리
   */
  private async handleUpdate(token: string, update: Record<string, unknown>): Promise<void> {
    // 메시지 추출
    const message = isObjectWithKey(update, "message") ? update.message : null;
    if (!message || !isObjectWithKey(message, "text") || typeof message.text !== "string") {
      return;
    }

    // command 추출 (IngressMatcher가 사용)
    const payload: JsonObject = {};
    // update 전체를 payload로 복사 (JSONPath가 $.message.chat.id 등 접근)
    for (const [k, v] of Object.entries(update)) {
      payload[k] = v as import("@goondan/core").JsonValue;
    }

    if (message.text.startsWith("/")) {
      const command = message.text.split(" ")[0] ?? message.text;
      payload["command"] = command;
    }

    // Connection rules로 라우팅
    const rules = toIngressRules(this.options.connectionResource);
    const matchedRule = routeEvent(rules, payload);

    if (!matchedRule) {
      debug("No matching rule for Telegram update");
      return;
    }

    // CanonicalEvent 생성 (JSONPath로 instanceKey, input 추출)
    const canonical = createCanonicalEventFromIngress(matchedRule, payload, {
      type: "telegram.message",
      connectorName: this.options.connectorResource.metadata.name,
      defaultInstanceKey: "telegram-default",
    });

    if (!canonical.input) {
      return;
    }

    // route에서 agentName 추출 (agentName 또는 agentRef 호환)
    const agentName = resolveAgentFromRoute(matchedRule.route);

    // 채팅 정보 로그
    const chatId = this.extractChatId(update);
    const username = this.extractUsername(update);
    info(`[Telegram] ${username ?? chatId}: ${canonical.input}`);

    // Turn 실행
    const result = await this.options.processConnectorTurn(
      this.options.runtimeCtx,
      {
        instanceKey: canonical.instanceKey,
        agentName,
        input: canonical.input,
      },
    );

    // 응답 전송
    if (chatId) {
      await this.sendMessage(token, chatId, result.response);
      info(`[Telegram] → ${chatId}: ${result.response.slice(0, 100)}${result.response.length > 100 ? "..." : ""}`);
    }
  }

  /**
   * Telegram sendMessage API 호출
   */
  private async sendMessage(token: string, chatId: string, text: string): Promise<void> {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const chunks = this.chunkText(text, 4000);

    for (const chunk of chunks) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: chunk,
          }),
        });
        if (!response.ok) {
          const body: unknown = await response.json().catch(() => null);
          const desc = isObjectWithKey(body, "description") ? String(body.description) : response.statusText;
          warn(`sendMessage failed: ${desc}`);
        }
      } catch (err) {
        warn(`sendMessage error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /**
   * update에서 chat.id 추출
   */
  private extractChatId(update: Record<string, unknown>): string | null {
    const message = update["message"];
    if (!isObjectWithKey(message, "chat")) return null;
    const chat = message.chat;
    if (!isObjectWithKey(chat, "id")) return null;
    return String(chat.id);
  }

  /**
   * update에서 사용자 이름 추출
   */
  private extractUsername(update: Record<string, unknown>): string | null {
    const message = update["message"];
    if (!isObjectWithKey(message, "from")) return null;
    const from = message.from;
    if (isObjectWithKey(from, "username") && typeof from.username === "string") {
      return `@${from.username}`;
    }
    if (isObjectWithKey(from, "first_name") && typeof from.first_name === "string") {
      return from.first_name;
    }
    return null;
  }

  /**
   * 텍스트를 최대 길이로 분할
   */
  private chunkText(text: string, maxLen: number): string[] {
    if (text.length <= maxLen) return [text];
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      chunks.push(remaining.slice(0, maxLen));
      remaining = remaining.slice(maxLen);
    }
    return chunks;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
