function readString(value) {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
}

function requireString(input, key) {
  const value = readString(input[key]);
  if (!value) {
    throw new Error(`'${key}' must be a non-empty string`);
  }
  return value;
}

async function sendTelegramMessage(token, chatId, text) {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram sendMessage failed (${response.status}): ${body}`);
  }
}

async function sendSlackMessage(token, channelId, text, threadTs) {
  const body = {
    channel: channelId,
    text,
    ...(threadTs ? { thread_ts: threadTs } : {}),
  };

  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true) {
    throw new Error(`Slack chat.postMessage failed: ${JSON.stringify(payload)}`);
  }
}

function pickTelegramToken(input) {
  return (
    readString(input.telegramToken) ??
    readString(process.env.BRAIN_TELEGRAM_BOT_TOKEN) ??
    readString(process.env.TELEGRAM_BOT_TOKEN) ??
    readString(process.env.BOT_TOKEN)
  );
}

function pickSlackToken(input) {
  return (
    readString(input.slackBotToken) ??
    readString(process.env.BRAIN_SLACK_BOT_TOKEN) ??
    readString(process.env.SLACK_BOT_TOKEN)
  );
}

export async function send(ctx, input) {
  const channel = requireString(input, 'channel');
  const text = requireString(input, 'text');

  if (channel === 'telegram') {
    const chatId = readString(input.telegramChatId) ?? readString(input.chatId);
    if (!chatId) {
      throw new Error("telegram channel requires 'telegramChatId' or 'chatId'");
    }
    const token = pickTelegramToken(input);
    if (!token) {
      throw new Error('Telegram bot token not found (telegramToken or env TELEGRAM_BOT_TOKEN)');
    }

    await sendTelegramMessage(token, chatId, text);
    return {
      ok: true,
      channel: 'telegram',
      chatId,
    };
  }

  if (channel === 'slack') {
    const channelId = readString(input.slackChannelId) ?? readString(input.channelId);
    if (!channelId) {
      throw new Error("slack channel requires 'slackChannelId' or 'channelId'");
    }
    const token = pickSlackToken(input);
    if (!token) {
      throw new Error('Slack bot token not found (slackBotToken or env SLACK_BOT_TOKEN)');
    }

    const threadTs = readString(input.slackThreadTs) ?? readString(input.threadTs);
    await sendSlackMessage(token, channelId, text, threadTs);
    return {
      ok: true,
      channel: 'slack',
      channelId,
      threadTs: threadTs ?? null,
    };
  }

  throw new Error(`unsupported channel: ${channel}`);
}

export const handlers = {
  send,
};
