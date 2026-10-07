import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Config } from './config';
import { cosPaths, type CosPaths } from './data/paths';
import { watchCosFiles } from './data/watcher';
import { decodedPath, extractToken, isAllowedHost, isAllowedOrigin, requiresToken, routeNeedsToken, tokenMatches } from './security';
import { sendError } from './routes/errors';
import { registerDataRoutes } from './routes/data';
import { registerWs } from './routes/ws';
import { ApprovalBroker } from './mcp/approvals';
import { registerMcpRoute } from './mcp/server';
import { ClaudeRunner } from './claude/runner';
import { SessionIndex } from './claude/sessions';
import { checkHealth } from './claude/health';

export interface AppContext {
  app: FastifyInstance;
  config: Config;
  paths: CosPaths;
  broker: ApprovalBroker;
  runner: ClaudeRunner;
  sessions: SessionIndex;
  port(): number;
  close(): Promise<void>;
}

const CLIENT_DIR = fileURLToPath(new URL('../dist/client', import.meta.url));

export async function buildApp(config: Config): Promise<AppContext> {
  const app = Fastify({ logger: false, requestTimeout: 0 });
  const paths = cosPaths(config.cosHome);
  const port = () => {
    const addr = app.server.address();
    return typeof addr === 'object' && addr ? addr.port : config.port;
  };
  const broker = new ApprovalBroker(config.approvalTimeoutMs);
  const sessions = new SessionIndex(paths.sessions);
  const runner = new ClaudeRunner(
    {
      claudeBin: config.claudeBin,
      cwd: config.cwd,
      approvalTimeoutMs: config.approvalTimeoutMs,
      mcpUrl: (chatId) => `http://127.0.0.1:${port()}/mcp?t=${config.token}&chat=${encodeURIComponent(chatId)}`,
    },
    sessions,
    broker,
  );

  app.setErrorHandler((err, _req, reply) => sendError(reply, err));
  app.addHook('onRequest', async (req, reply) => {
    // A rejected WebSocket upgrade leaves a raw socket that Node does not track; close it after the reply
    // so app.close() is not blocked waiting for it.
    const reject = (code: number, error: string) => {
      if (req.headers.upgrade) {
        reply.header('connection', 'close');
        reply.raw.once('finish', () => req.raw.socket.destroySoon());
      }
      return reply.code(code).send({ error });
    };
    if (!isAllowedHost(req.headers.host, port())) return reject(403, 'forbidden_host');
    if (!isAllowedOrigin(req.headers.origin, port())) return reject(403, 'forbidden_origin');
    // Default-deny, decided from the matched route (find-my-way routes on the decoded path, so the raw URL can't be trusted).
    if (routeNeedsToken(req.method, req.routeOptions.url) && !tokenMatches(extractToken(req.headers, req.url), config.token))
      return reject(401, 'unauthorized');
  });
  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-frame-options', 'DENY');
    reply.header('content-security-policy', "frame-ancestors 'none'");
  });

  await app.register(fastifyWebsocket);
  registerDataRoutes(app, { paths });
  registerMcpRoute(app, broker);
  const hub = registerWs(app, { runner, broker, sessions });
  app.get('/api/health', () => checkHealth(config.claudeBin, paths));
  app.get('/api/chats', () => sessions.list());

  const watcher = watchCosFiles(paths, (kind, name) => hub.broadcast({ type: 'file.changed', kind, name }));

  if (existsSync(CLIENT_DIR)) {
    await app.register(fastifyStatic, { root: CLIENT_DIR });
    app.setNotFoundHandler((req, reply) => {
      if (decodedPath(req.url) === null) return reply.code(400).send({ error: 'bad_request' });
      if ((req.method === 'GET' || req.method === 'HEAD') && !requiresToken(req.url)) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'not_found' });
    });
  }

  return {
    app, config, paths, broker, runner, sessions, port,
    close: async () => {
      await runner.shutdown();
      await watcher.close();
      await app.close();
    },
  };
}
