import 'dotenv/config';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import { db, getUploadDir } from './server/db.ts';
import {
  attachSession,
  getSessionSecret,
  invalidateAdminBootstrapToken,
  isBootstrapTokenRequired,
} from './server/security.ts';
import { authRouter } from './server/routes/auth.ts';
import { studioRouter } from './server/routes/studio.ts';
import { billingRouter, type RawBodyRequest } from './server/routes/billing.ts';
import { supportRouter } from './server/routes/support.ts';
import { adminRouter } from './server/routes/admin.ts';

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
  await db.init();
  getSessionSecret();

  const adminCount = await db.countAdmins();
  if (adminCount === 0) {
    if (isBootstrapTokenRequired()) {
      console.log(
        '[ADMIN BOOTSTRAP] No administrator provisioned yet. Visit /admin and provide INITIAL_ADMIN_PROVISION_TOKEN.'
      );
    } else {
      invalidateAdminBootstrapToken();
      console.log('[ADMIN BOOTSTRAP] No administrator provisioned yet. Visit /admin to create the initial administrator account.');
    }
  }

  const app = express();
  const httpServer = http.createServer(app);
  app.set('trust proxy', 1);

  // Baseline security headers compatible with embedded preview frames
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self)');
    next();
  });

  app.use(
    express.json({
      limit: '12mb',
      verify: (req, _res, buf) => {
        (req as RawBodyRequest).rawBody = buf;
      },
    })
  );
  app.use(cookieParser());
  app.use(attachSession);

  // Serve validated user-uploaded studio assets safely
  app.use(
    '/uploads',
    express.static(getUploadDir(), {
      fallthrough: false,
      setHeaders: (res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'public, max-age=3600');
      },
    })
  );

  // Healthcheck
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, databaseEngine: db.getEngine(), timestamp: new Date().toISOString() });
  });

  // API Routers
  app.use('/api/auth', authRouter);
  app.use('/api', studioRouter);
  app.use('/api', billingRouter);
  app.use('/api', supportRouter);
  app.use('/api/admin', adminRouter);

  // API 404 handler
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

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

  // Global error handler — never leak raw stack traces to ordinary users
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[Server Error]', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'An unexpected server error occurred. Please try again.' });
    }
  });

  const port = resolveServerPort();
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`NexaFlow AI Studio listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start NexaFlow AI Studio server:', err);
  process.exit(1);
});
