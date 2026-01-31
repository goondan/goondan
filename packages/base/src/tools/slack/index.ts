interface SlackPostMessageInput {
  channel: string;
  text: string;
  threadTs?: string;
  scopes?: string[];
}

interface ToolContext {
  oauth?: { getAccessToken?: (request: { oauthAppRef: { kind: string; name: string }; scopes?: string[] }) => Promise<Record<string, unknown>> };
}

export const handlers = {
  'slack.postMessage': async (ctx: ToolContext, input: SlackPostMessageInput) => {
    if (!input?.channel || !input?.text) {
      throw new Error('channel과 text가 필요합니다.');
    }

    const tokenResult = await ctx.oauth?.getAccessToken?.({
      oauthAppRef: { kind: 'OAuthApp', name: 'slack-bot' },
      scopes: input.scopes,
    });

    if (!tokenResult || (tokenResult as { status?: string }).status !== 'ready') {
      return tokenResult;
    }

    const accessToken = (tokenResult as { accessToken?: string }).accessToken;
    if (!accessToken) {
      throw new Error('Slack accessToken을 찾을 수 없습니다.');
    }

    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        channel: input.channel,
        text: input.text,
        thread_ts: input.threadTs,
      }),
    });

    return response.json();
  },
};
