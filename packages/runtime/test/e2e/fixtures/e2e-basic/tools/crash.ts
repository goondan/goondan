export default async function (_ctx: unknown, input: { exitCode?: number }) {
  const exitCode = typeof input.exitCode === 'number' ? input.exitCode : 1;
  process.exit(exitCode);
}
