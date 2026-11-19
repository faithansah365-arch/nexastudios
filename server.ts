import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { attachGlobalErrorHandler, createApiExpressApp, ensureBackendReady } from './server/app.ts';

function resolveServerPort(): number {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--port=')) {
      const parsed = Number(arg.slice('--port='.length));
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    } else if (arg === '--port' && args[i + 1]) {
      const parsed = Number(args[i + 1]);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  const appPort = Number(process.env.APP_PORT);
  if (Number.isFinite(appPort) && appPort > 0) return appPort;
  // Note: Cloud Run sets PORT=8080 for nginx reverse proxy; the Node app must bind to 3000.
  return 3000;
}

async function startServer(): Promise<void> {
  await ensureBackendReady();

  const app = createApiExpressApp();
  const httpServer = http.createServer(app);

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(import.meta.dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Production build not found. Run npm run build.');
      }
    });
  }

  attachGlobalErrorHandler(app);

  const port = resolveServerPort();
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`NexaFlow AI Studio listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start NexaFlow AI Studio server:', err);
  process.exit(1);
});
