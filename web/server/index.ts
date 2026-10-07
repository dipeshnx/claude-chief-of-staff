import { loadConfig } from './config';
import { buildApp } from './app';

const config = loadConfig();
const ctx = await buildApp(config);
try {
  await ctx.app.listen({ host: config.host, port: config.port });
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    console.error(`Port ${config.port} is already in use. Stop the other process or set COS_PORT.`);
    process.exit(1);
  }
  throw err;
}
console.log(`\n  AI Chief of Staff web UI\n\n  Open:  http://127.0.0.1:${ctx.port()}/?t=${config.token}\n  Data:  ${config.cosHome}\n  Claude: ${config.claudeBin} (cwd ${config.cwd})\n`);

const shutdown = async () => {
  await ctx.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
