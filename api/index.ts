import type { IncomingMessage, ServerResponse } from 'node:http';
import { attachGlobalErrorHandler, createApiExpressApp, ensureBackendReady } from '../server/app.ts';

const app = createApiExpressApp();
attachGlobalErrorHandler(app);

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await ensureBackendReady();
  app(req as unknown as Parameters<typeof app>[0], res as unknown as Parameters<typeof app>[1]);
}
