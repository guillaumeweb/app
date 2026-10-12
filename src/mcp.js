// Serveur MCP local (stdio), lancé par Claude Code via .mcp.json.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { backendFromEnv } from './backends.js';
import { buildMcpServer } from './mcp-tools.js';
import { createStore } from './store.js';

const store = createStore(await backendFromEnv());
await buildMcpServer(store).connect(new StdioServerTransport());
