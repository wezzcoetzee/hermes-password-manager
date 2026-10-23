#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMcpServer } from './adapter.ts'

const tokenFile = process.env.AGENTVAULT_TOKEN_FILE ?? join(homedir(), '.agentvault', 'agent-token')
const server = createMcpServer({
  brokerUrl: process.env.AGENTVAULT_BROKER_URL ?? 'http://127.0.0.1:7800',
  agentToken: readFileSync(tokenFile, 'utf8').trim(),
})
await server.connect(new StdioServerTransport())
