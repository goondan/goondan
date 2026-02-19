export default async function (ctx: { agentName: string }, input: { text: string }) {
  return { echo: input.text, agent: ctx.agentName, pid: process.pid };
}
