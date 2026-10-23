/**
 * MCP surface for Hermes (or any MCP client). Deliberately dumb: it validates,
 * forwards to the broker with the agent token, and shapes results. It never
 * sees credentials or cookies because the broker never returns them.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { HttpError, postJson } from '../shared/http.ts'
import { toolDefinitions, type ToolName } from '../shared/tools.ts'

export interface AdapterOptions { brokerUrl: string; agentToken: string }

/** Tools that wait on a human decision get a long timeout. */
const SLOW_TOOLS = new Set<ToolName>(['request_login', 'request_transaction_approval'])

export function createMcpServer({ brokerUrl, agentToken }: AdapterOptions): McpServer {
  const server = new McpServer({ name: 'agentvault', version: '0.1.0' })

  for (const name of Object.keys(toolDefinitions) as ToolName[]) {
    const { description, input } = toolDefinitions[name]
    server.registerTool(name, { description, inputSchema: input.shape }, async (args: Record<string, unknown>): Promise<CallToolResult> => {
      try {
        const result = await postJson<Record<string, unknown>>(`${brokerUrl}/v1/tools/${name}`, args, { authorization: `Bearer ${agentToken}` }, SLOW_TOOLS.has(name) ? 180_000 : 60_000)
        const { screenshot, ...rest } = result
        const content: CallToolResult['content'] = [{ type: 'text', text: JSON.stringify(rest, null, 2) }]
        if (typeof screenshot === 'string') content.push({ type: 'image', data: screenshot, mimeType: 'image/png' })
        return { content }
      } catch (err) {
        const message = err instanceof HttpError ? `${err.code}: ${err.message}` : 'AgentVault broker is unreachable. Is Docker running?'
        return { isError: true, content: [{ type: 'text', text: message }] }
      }
    })
  }
  return server
}
