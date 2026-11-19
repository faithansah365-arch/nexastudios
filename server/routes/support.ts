import crypto from 'node:crypto';
import { Router } from 'express';
import { db } from '../db.ts';
import { rateLimit, requireAuth, type AuthenticatedRequest } from '../security.ts';
import type { SupportRequest } from '../../shared/types.ts';

export const supportRouter = Router();

const supportLimit = rateLimit('support', 10, 15 * 60 * 1000);

supportRouter.post('/support', supportLimit, async (req: AuthenticatedRequest, res) => {
  const { name, email, subject, category, message } = req.body ?? {};
  const finalName = req.authUser?.name || (typeof name === 'string' ? name.trim() : '');
  const finalEmail = req.authUser?.email || (typeof email === 'string' ? email.trim().toLowerCase() : '');

  if (finalName.length < 2) {
    res.status(400).json({ error: 'Please provide your name.' });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(finalEmail)) {
    res.status(400).json({ error: 'Please provide a valid email address.' });
    return;
  }
  if (typeof subject !== 'string' || subject.trim().length < 3 || subject.trim().length > 140) {
    res.status(400).json({ error: 'Subject must be between 3 and 140 characters.' });
    return;
  }
  if (typeof message !== 'string' || message.trim().length < 10 || message.trim().length > 3000) {
    res.status(400).json({ error: 'Message must be between 10 and 3000 characters.' });
    return;
  }

  const now = new Date().toISOString();
  const priority = req.activePlan?.limits.prioritySupport ? 'priority' : 'standard';

  const ticket: SupportRequest = {
    id: crypto.randomUUID(),
    userId: req.authUser?.id,
    name: finalName,
    email: finalEmail,
    subject: subject.trim(),
    category: typeof category === 'string' && category.trim() ? category.trim() : 'General Inquiry',
    message: message.trim(),
    priority,
    status: 'open',
    createdAt: now,
    updatedAt: now,
  };

  await db.createSupportRequest(ticket);
  res.status(201).json({ ticket });
});

supportRouter.get('/support/mine', requireAuth, async (req: AuthenticatedRequest, res) => {
  const tickets = await db.listSupportRequests(req.authUser!.id);
  res.json({ tickets });
});
