const readline = require('node:readline');

const rl = readline.createInterface({ input: process.stdin });

rl.on('line', (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (!msg.id) return;

  if (msg.method === 'tools/list') {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          tools: [
            {
              name: 'echo',
              description: 'Echo input',
              inputSchema: { type: 'object', additionalProperties: true },
            },
          ],
        },
      }) + '\n'
    );
    return;
  }

  if (msg.method === 'tools/call') {
    const args = (msg.params && msg.params.arguments) || {};
    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        result: { echo: args },
      }) + '\n'
    );
    return;
  }

  process.stdout.write(
    JSON.stringify({
      jsonrpc: '2.0',
      id: msg.id,
      error: { message: 'method not found' },
    }) + '\n'
  );
});
