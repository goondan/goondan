export default async function (_ctx: unknown, input: { ms: number }) {
  const ms = typeof input.ms === 'number' ? input.ms : 1000;
  await new Promise(resolve => setTimeout(resolve, ms));
  return { slept: ms, pid: process.pid };
}
