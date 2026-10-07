import type { FastifyInstance } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type { ApprovalBroker } from './approvals';

export const APPROVE_TOOL = 'mcp__cos_ui__approve';

export function registerMcpRoute(app: FastifyInstance, broker: ApprovalBroker): void {
  app.post('/mcp', async (req, reply) => {
    const chat = (req.query as Record<string, unknown>).chat;
    if (typeof chat !== 'string' || chat === '') return reply.code(400).send({ error: 'missing_chat' });
    const chatId = chat;
    const server = new McpServer({ name: 'cos_ui', version: '1.0.0' });
    server.registerTool(
      'approve',
      {
        description: 'Ask the Chief of Staff web UI user to approve or deny a tool call.',
        inputSchema: { tool_name: z.string(), input: z.record(z.string(), z.unknown()), tool_use_id: z.string().optional() },
      },
      async ({ tool_name, input, tool_use_id }, extra) => {
        const decision = await broker.request(chatId, tool_name, input, tool_use_id, extra.signal);
        return { content: [{ type: 'text' as const, text: JSON.stringify(decision) }] };
      },
    );
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req.raw, reply.raw, req.body);
    } catch {
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'content-type': 'application/json' });
        reply.raw.write(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null }));
      }
      if (!reply.raw.writableEnded) reply.raw.end();
      void transport.close();
      void server.close();
    }
  });

  const notAllowed = async (_req: unknown, reply: { code(n: number): { send(b: unknown): unknown } }) =>
    reply.code(405).send({ error: 'method_not_allowed' });
  app.get('/mcp', notAllowed);
  app.delete('/mcp', notAllowed);
}
