import 'dotenv/config';
import path from 'node:path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import { db } from './db.ts';
import {
  attachSession,
  getSessionSecret,
  invalidateAdminBootstrapToken,
  isBootstrapTokenRequired,
} from './security.ts';
import { authRouter } from './routes/auth.ts';
import { studioRouter } from './routes/studio.ts';
import { billingRouter, type RawBodyRequest } from './routes/billing.ts';
import { supportRouter } from './routes/support.ts';
import { adminRouter } from './routes/admin.ts';

let readyPromise: Promise<void> | null = null;

export async function ensureBackendReady(): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
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
          console.log(
            '[ADMIN BOOTSTRAP] No administrator provisioned yet. Visit /admin to create the initial administrator account.'
          );
        }
      }
    })().catch((err) => {
      readyPromise = null;
      throw err;
    });
  }
  return readyPromise;
}

export function createApiExpressApp(): Express {
  const app = express();
  app.set('trust proxy', 1);

  // Baseline security headers compatible with embedded preview frames & Vercel
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

  // Ensure DB & secrets are initialized before handling API/upload requests (serverless cold-start safe)
  app.use(['/api', '/uploads'], async (_req, _res, next) => {
    try {
      await ensureBackendReady();
      next();
    } catch (err) {
      next(err);
    }
  });

  app.use(attachSession);

  // Serve validated user-uploaded studio assets safely (from MongoDB or local disk)
  app.get('/uploads/:fileName', async (req, res, next) => {
    try {
      const safeName = path.basename(req.params.fileName || '');
      if (!safeName || !/^[a-zA-Z0-9_.-]+$/.test(safeName)) {
        res.status(404).end();
        return;
      }
      const asset = await db.getUploadedAsset(safeName);
      if (!asset) {
        res.status(404).end();
        return;
      }
      res.setHeader('Content-Type', asset.mimeType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(asset.data);
    } catch (err) {
      next(err);
    }
  });

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

  return app;
}

export function attachGlobalErrorHandler(app: Express): void {
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[Server Error]', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'An unexpected server error occurred. Please try again.' });
    }
  });
}
