import { createInterface } from 'node:readline/promises'

/** Asks on the terminal. `hidden` suppresses echo for secrets. */
export async function ask(question: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  if (hidden) (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => undefined
  const answer = await rl.question(question)
  rl.close()
  if (hidden) process.stdout.write('\n')
  return answer.trim()
}
