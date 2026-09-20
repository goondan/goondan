import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { LoadedConfig } from '@goondan/core';
import { DEFAULT_ANTHROPIC_CHAT_MODEL } from './model.js';

export function defaultChatStateDirectory(): string {
  return resolve(homedir(), '.goondan', 'chat');
}

export function createDefaultChatConfig(directory: string, model = DEFAULT_ANTHROPIC_CHAT_MODEL): LoadedConfig {
  return {
    directory,
    templates: new Map(),
    config: {
      version: 1,
      name: 'goondan-cli-chat',
      agents: {
        assistant: {
          model,
          systemMessage: {
            text: 'You are a coding agent. Use the available tools to inspect and modify the working directory. Be concise and accurate.',
          },
          tools: ['read_file', 'write_file', 'list_dir', 'bash'],
        },
      },
    },
  };
}
