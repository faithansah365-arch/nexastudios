import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { db, getUploadDir } from '../db.ts';
import { rateLimit, requireAuth, type AuthenticatedRequest } from '../security.ts';
import type { CustomStudio, ExportRecord, ExportResolution, ProjectRecord } from '../../shared/types.ts';

export const studioRouter = Router();

const exportRateLimit = rateLimit('export_auth', 20, 60 * 1000);

const RESOLUTION_RANK: Record<ExportResolution, number> = {
  '720p': 1,
  '1080p': 2,
  '4k': 3,
};

// Public template catalog (never exposes user private studios)
studioRouter.get('/templates', async (_req, res) => {
  const templates = await db.listTemplates();
  res.json({ templates });
});

// Public OBS Clean-Output view ONLY when explicitly enabled by owner with matching token
studioRouter.get('/obs-scene/:studioId', async (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  const studio = await db.findStudioById(req.params.studioId);
  if (!studio || !studio.obsShareEnabled || !studio.obsShareToken || !token) {
    res.status(404).json({ error: 'Broadcast scene is unavailable or sharing is disabled.' });
    return;
  }
  const a = Buffer.from(token);
  const b = Buffer.from(studio.obsShareToken);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.status(403).json({ error: 'Invalid broadcast scene token.' });
    return;
  }
  // Return strictly visual scene configuration — never userId, email, or project metadata
  res.json({
    scene: {
      id: studio.id,
      name: studio.name,
      studioType: studio.studioType,
      backgroundUrl: studio.backgroundUrl,
      foregroundMaskConfig: studio.foregroundMaskConfig,
      subjectConfig: studio.subjectConfig,
      brandingConfig: studio.brandingConfig,
      lightingPreset: studio.lightingPreset,
      supportedAspectRatios: studio.supportedAspectRatios,
    },
  });
});

// ---- User Saved Studios ----
studioRouter.get('/studios', requireAuth, async (req: AuthenticatedRequest, res) => {
  const studios = await db.listStudiosByUser(req.authUser!.id);
  res.json({ studios });
});

studioRouter.post('/studios', requireAuth, async (req: AuthenticatedRequest, res) => {
  const plan = req.activePlan!;
  const currentCount = await db.countStudiosByUser(req.authUser!.id);
  if (currentCount >= plan.limits.maxSavedStudios) {
    res.status(403).json({
      error: `Your ${plan.name} plan allows up to ${plan.limits.maxSavedStudios} saved studio(s). Upgrade your plan or delete an existing studio.`,
      code: 'STUDIO_LIMIT_REACHED',
    });
    return;
  }

  const body = req.body ?? {};
  if (typeof body.name !== 'string' || body.name.trim().length < 2 || body.name.trim().length > 80) {
    res.status(400).json({ error: 'Studio name must be between 2 and 80 characters.' });
    return;
  }
  if (typeof body.backgroundUrl !== 'string' || !body.backgroundUrl.trim()) {
    res.status(400).json({ error: 'A studio background asset is required.' });
    return;
  }

  const now = new Date().toISOString();
  const studio: CustomStudio = {
    id: crypto.randomUUID(),
    userId: req.authUser!.id,
    name: body.name.trim(),
    category: body.category || 'Corporate Presentation Studios',
    studioType: body.studioType === 'true_3d' ? 'layered_2_5d' : (body.studioType || 'layered_2_5d'),
    templateId: body.templateId || undefined,
    backgroundUrl: body.backgroundUrl.trim(),
    foregroundMaskConfig: body.foregroundMaskConfig,
    subjectConfig: body.subjectConfig,
    brandingConfig: body.brandingConfig,
    cameraFraming: body.cameraFraming || 'medium',
    lightingPreset: body.lightingPreset || 'neutral',
    supportedAspectRatios: Array.isArray(body.supportedAspectRatios) ? body.supportedAspectRatios : ['16:9'],
    obsShareEnabled: Boolean(body.obsShareEnabled),
    obsShareToken: body.obsShareEnabled ? crypto.randomBytes(16).toString('hex') : undefined,
    createdAt: now,
    updatedAt: now,
  };

  await db.saveStudio(studio);
  res.status(201).json({ studio });
});

studioRouter.put('/studios/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  const existing = await db.findStudioById(req.params.id);
  if (!existing || existing.userId !== req.authUser!.id) {
    res.status(404).json({ error: 'Studio not found.' });
    return;
  }

  const body = req.body ?? {};
  const obsShareEnabled = body.obsShareEnabled !== undefined ? Boolean(body.obsShareEnabled) : existing.obsShareEnabled;
  const obsShareToken = obsShareEnabled ? (existing.obsShareToken || crypto.randomBytes(16).toString('hex')) : undefined;

  const updated: CustomStudio = {
    ...existing,
    name: typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : existing.name,
    category: body.category || existing.category,
    studioType: body.studioType === 'simple_background' || body.studioType === 'layered_2_5d' ? body.studioType : existing.studioType,
    backgroundUrl: typeof body.backgroundUrl === 'string' && body.backgroundUrl.trim() ? body.backgroundUrl.trim() : existing.backgroundUrl,
    foregroundMaskConfig: body.foregroundMaskConfig || existing.foregroundMaskConfig,
    subjectConfig: body.subjectConfig || existing.subjectConfig,
    brandingConfig: body.brandingConfig || existing.brandingConfig,
    cameraFraming: body.cameraFraming || existing.cameraFraming,
    lightingPreset: body.lightingPreset || existing.lightingPreset,
    supportedAspectRatios: Array.isArray(body.supportedAspectRatios) ? body.supportedAspectRatios : existing.supportedAspectRatios,
    obsShareEnabled,
    obsShareToken,
    updatedAt: new Date().toISOString(),
  };

  await db.saveStudio(updated);
  res.json({ studio: updated });
});

studioRouter.post('/studios/:id/duplicate', requireAuth, async (req: AuthenticatedRequest, res) => {
  const existing = await db.findStudioById(req.params.id);
  if (!existing || existing.userId !== req.authUser!.id) {
    res.status(404).json({ error: 'Studio not found.' });
    return;
  }
  const plan = req.activePlan!;
  const currentCount = await db.countStudiosByUser(req.authUser!.id);
  if (currentCount >= plan.limits.maxSavedStudios) {
    res.status(403).json({
      error: `Your ${plan.name} plan allows up to ${plan.limits.maxSavedStudios} saved studio(s).`,
      code: 'STUDIO_LIMIT_REACHED',
    });
    return;
  }
  const now = new Date().toISOString();
  const copy: CustomStudio = {
    ...existing,
    id: crypto.randomUUID(),
    name: `${existing.name} (Copy)`.slice(0, 80),
    obsShareEnabled: false,
    obsShareToken: undefined,
    createdAt: now,
    updatedAt: now,
  };
  await db.saveStudio(copy);
  res.status(201).json({ studio: copy });
});

studioRouter.delete('/studios/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  const ok = await db.deleteStudio(req.params.id, req.authUser!.id);
  if (!ok) {
    res.status(404).json({ error: 'Studio not found.' });
    return;
  }
  res.json({ ok: true });
});

// ---- Secure Image Upload (Studio backgrounds, custom PNG masks, brand logos) ----
// Validates magic bytes for PNG, JPEG, WebP (prevents disguised HTML/SVG XSS)
function detectImageExtension(buf: Buffer): 'png' | 'jpg' | 'webp' | null {
  if (buf.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  // WebP: RIFF....WEBP
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

studioRouter.post('/studios/upload-image', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { dataUrl } = req.body ?? {};
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    res.status(400).json({ error: 'Invalid image payload. Supported formats: JPG, PNG, WebP.' });
    return;
  }
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) {
    res.status(400).json({ error: 'Malformed image data URL.' });
    return;
  }
  const base64Part = dataUrl.slice(commaIdx + 1);
  const buf = Buffer.from(base64Part, 'base64');
  if (buf.length > 8 * 1024 * 1024) {
    res.status(400).json({ error: 'Image file exceeds the 8 MB upload limit.' });
    return;
  }

  const ext = detectImageExtension(buf);
  if (!ext) {
    res.status(400).json({ error: 'Unsupported or corrupted image file. Only genuine JPG, PNG, and WebP files are accepted.' });
    return;
  }

  const fileName = `${req.authUser!.id.slice(0, 8)}_${crypto.randomBytes(12).toString('hex')}.${ext}`;
  const outPath = path.join(getUploadDir(), fileName);
  fs.writeFileSync(outPath, buf);

  res.status(201).json({
    url: `/uploads/${fileName}`,
    bytes: buf.length,
    format: ext,
  });
});

// ---- Projects ----
studioRouter.get('/projects', requireAuth, async (req: AuthenticatedRequest, res) => {
  const projects = await db.listProjectsByUser(req.authUser!.id);
  res.json({ projects });
});

studioRouter.post('/projects', requireAuth, async (req: AuthenticatedRequest, res) => {
  const body = req.body ?? {};
  if (typeof body.title !== 'string' || body.title.trim().length < 2 || body.title.trim().length > 100) {
    res.status(400).json({ error: 'Project title must be between 2 and 100 characters.' });
    return;
  }
  const now = new Date().toISOString();
  const project: ProjectRecord = {
    id: crypto.randomUUID(),
    userId: req.authUser!.id,
    title: body.title.trim(),
    type: body.type || 'live_recording',
    studioId: body.studioId || undefined,
    aspectRatio: body.aspectRatio || '16:9',
    durationSeconds: Number(body.durationSeconds || 0),
    storageNote: 'local_browser',
    settings: typeof body.settings === 'object' && body.settings ? body.settings : {},
    createdAt: now,
    updatedAt: now,
  };
  await db.saveProject(project);
  if (project.type === 'live_recording') {
    await db.incrementRecordingCount(req.authUser!.id);
  }
  res.status(201).json({ project });
});

studioRouter.delete('/projects/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  const ok = await db.deleteProject(req.params.id, req.authUser!.id);
  if (!ok) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  res.json({ ok: true });
});

// ---- Exports & Server-Enforced Atomic Quota ----
studioRouter.get('/exports', requireAuth, async (req: AuthenticatedRequest, res) => {
  const exportsList = await db.listExportsByUser(req.authUser!.id);
  res.json({ exports: exportsList });
});

studioRouter.post('/exports/authorize', exportRateLimit, requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  if (!user.emailVerified) {
    res.status(403).json({
      error: 'Please verify your email address before exporting videos.',
      code: 'EMAIL_VERIFICATION_REQUIRED',
    });
    return;
  }

  const plan = req.activePlan!;
  const body = req.body ?? {};
  const requestedResolution: ExportResolution =
    body.resolution === '4k' || body.resolution === '1080p' || body.resolution === '720p' ? body.resolution : '720p';

  if (RESOLUTION_RANK[requestedResolution] > RESOLUTION_RANK[plan.limits.maxExportResolution]) {
    res.status(403).json({
      error: `Your ${plan.name} plan supports up to ${plan.limits.maxExportResolution} exports. Upgrade to export in ${requestedResolution}.`,
      code: 'RESOLUTION_LIMIT_EXCEEDED',
    });
    return;
  }

  const durationSeconds = Math.max(0, Number(body.durationSeconds || 0));
  if (durationSeconds > plan.limits.maxRecordingMinutes * 60 + 5) {
    res.status(403).json({
      error: `Recording exceeds your ${plan.name} plan limit of ${plan.limits.maxRecordingMinutes} minute(s) per session.`,
      code: 'DURATION_LIMIT_EXCEEDED',
    });
    return;
  }

  const quota = await db.atomicConsumeExportQuota(user.id, plan.limits.maxExportsPerMonth);
  if (!quota.allowed) {
    res.status(403).json({
      error: `Monthly export limit (${plan.limits.maxExportsPerMonth}) reached for your ${plan.name} plan.`,
      code: 'EXPORT_QUOTA_EXCEEDED',
      usage: quota.usage,
    });
    return;
  }

  const exportRecord: ExportRecord = {
    id: crypto.randomUUID(),
    userId: user.id,
    projectId: body.projectId || undefined,
    studioId: body.studioId || undefined,
    title: typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 100) : 'Untitled Production',
    resolution: requestedResolution,
    aspectRatio: body.aspectRatio || '16:9',
    format: typeof body.format === 'string' ? body.format : 'video/webm',
    durationSeconds: Math.round(durationSeconds),
    watermarked: plan.limits.watermarkRequired,
    status: 'authorized',
    createdAt: new Date().toISOString(),
  };

  await db.saveExport(exportRecord);

  res.status(201).json({
    exportRecord,
    watermarkRequired: plan.limits.watermarkRequired,
    usage: quota.usage,
  });
});

studioRouter.post('/exports/:id/complete', requireAuth, async (req: AuthenticatedRequest, res) => {
  const existing = await db.findExportById(req.params.id);
  if (!existing || existing.userId !== req.authUser!.id) {
    res.status(404).json({ error: 'Export authorization not found.' });
    return;
  }
  await db.saveExport({ ...existing, status: 'completed' });
  res.json({ ok: true });
});

studioRouter.post('/exports/:id/fail', requireAuth, async (req: AuthenticatedRequest, res) => {
  const existing = await db.findExportById(req.params.id);
  if (!existing || existing.userId !== req.authUser!.id) {
    res.status(404).json({ error: 'Export authorization not found.' });
    return;
  }
  if (existing.status === 'authorized') {
    await db.saveExport({ ...existing, status: 'failed' });
    await db.refundExportQuota(req.authUser!.id);
  }
  const usage = await db.getOrCreateUsage(req.authUser!.id);
  res.json({ ok: true, refunded: existing.status === 'authorized', usage });
});
