export const bindings = {
  models: {
    fixture: {
      async generate(input, context) {
        const text = input.messages.flatMap((message) => message.content)
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .at(-1) ?? '';
        context.onTextDelta(`echo:${text}`);
        return {
          message: { id: 'fixture-output', role: 'assistant', source: 'fixture', content: [{ type: 'text', text: `echo:${text}` }] },
          finishReason: 'stop',
        };
      },
    },
  },
};
