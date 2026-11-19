import crypto from 'node:crypto';
import { GoogleGenAI, Type } from '@google/genai';
import { Router } from 'express';
import { db } from '../db.ts';
import { rateLimit, requireAuth, type AuthenticatedRequest } from '../security.ts';
import type { CustomStudio, ExportRecord, ExportResolution, ProjectRecord } from '../../shared/types.ts';
import {
  clampTeleprompterFontSize,
  estimateReadingSeconds,
  wpmToScrollPxPerSec,
  type TeleprompterAiMode,
  type TeleprompterAiResponse,
  type TeleprompterTone,
} from '../../shared/teleprompter.ts';

export const studioRouter = Router();

const exportRateLimit = rateLimit('export_auth', 20, 60 * 1000);
const teleprompterAiRateLimit = rateLimit('teleprompter_ai', 20, 60 * 1000);

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
  const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  await db.saveUploadedAsset(fileName, mimeType, buf);

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

// ---- AI Teleprompter Script & Pacing Assistant (Server-Side Gemini) ----
const ALLOWED_AI_MODES = new Set<TeleprompterAiMode>(['generate', 'polish', 'pacing']);
const ALLOWED_TONES = new Set<TeleprompterTone>([
  'conversational',
  'broadcast',
  'executive',
  'sermon',
  'educational',
]);

studioRouter.post('/studios/teleprompter-ai', teleprompterAiRateLimit, requireAuth, async (req: AuthenticatedRequest, res) => {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    res.status(503).json({
      error: 'AI teleprompter assistant requires GEMINI_API_KEY to be configured on the server.',
      code: 'GEMINI_NOT_CONFIGURED',
    });
    return;
  }

  const body = req.body ?? {};
  const mode: TeleprompterAiMode = ALLOWED_AI_MODES.has(body.mode) ? body.mode : 'generate';
  const tone: TeleprompterTone = ALLOWED_TONES.has(body.tone) ? body.tone : 'conversational';
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, 1500) : '';
  const script = typeof body.script === 'string' ? body.script.trim().slice(0, 12000) : '';
  const fontSize = clampTeleprompterFontSize(Number(body.fontSize || 24));
  const targetSeconds = Math.max(15, Math.min(900, Math.round(Number(body.targetSeconds || 60))));

  if (mode === 'generate' && prompt.length < 3) {
    res.status(400).json({ error: 'Enter a topic or brief outline (at least 3 characters) to generate a script.' });
    return;
  }
  if ((mode === 'polish' || mode === 'pacing') && script.length < 10) {
    res.status(400).json({ error: 'Provide at least a short draft script (10+ characters) before running AI polish or pacing.' });
    return;
  }

  const targetWordCount = Math.max(35, Math.round((targetSeconds / 60) * 135));

  const systemInstruction = [
    'You are a broadcast teleprompter producer helping a presenter speak naturally while maintaining direct eye contact with a webcam lens.',
    'Format scripts with short, single-breath sentences and clear paragraph breaks so eyes never lose their line.',
    'Use subtle [PAUSE] markers only at key breath transitions—never markdown bullets, headers, hashtags, or stage directions in parentheses.',
    'Return strictly valid JSON matching the requested schema.',
  ].join(' ');

  let userPrompt = '';
  if (mode === 'generate') {
    userPrompt = [
      `Write a spoken-delivery teleprompter script in a ${tone} tone.`,
      `Target spoken duration: roughly ${targetSeconds} seconds (~${targetWordCount} words).`,
      `Topic / talking points:\n${prompt}`,
      'Recommend an ideal speaking rate (recommendedWpm between 110 and 165) and one concise camera-eye-contact delivery tip.',
    ].join('\n\n');
  } else if (mode === 'polish') {
    userPrompt = [
      `Rewrite and polish the following draft for effortless teleprompter reading in a ${tone} tone.`,
      'Keep the presenter’s core meaning and facts, shorten overly long clauses for natural breath control, and add subtle [PAUSE] beats where helpful.',
      `Draft script:\n${script}`,
      'Recommend an ideal speaking rate (recommendedWpm between 110 and 165) and one concise delivery tip.',
    ].join('\n\n');
  } else {
    userPrompt = [
      `Analyze the pacing and cadence of this teleprompter script for a ${tone} delivery.`,
      'Return the script unchanged (unless fixing broken line breaks for easier eye scanning), recommend the ideal speaking rate (recommendedWpm between 110 and 165), estimate spoken duration in seconds, and give one concise eye-contact/pacing tip.',
      `Script:\n${script}`,
    ].join('\n\n');
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: userPrompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            script: {
              type: Type.STRING,
              description: 'Teleprompter-formatted spoken script with short eye-friendly lines and occasional [PAUSE] cues.',
            },
            recommendedWpm: {
              type: Type.NUMBER,
              description: 'Recommended speaking pace in words per minute (110 to 165).',
            },
            estimatedDurationSeconds: {
              type: Type.NUMBER,
              description: 'Estimated spoken runtime in seconds at the recommended WPM.',
            },
            deliveryTip: {
              type: Type.STRING,
              description: 'One concise tip for eye contact, tone, or pacing on camera.',
            },
          },
          required: ['script', 'recommendedWpm', 'estimatedDurationSeconds', 'deliveryTip'],
        },
      },
    });

    const rawText = response.text;
    if (!rawText) {
      res.status(502).json({ error: 'Gemini returned an empty response. Please try again.' });
      return;
    }

    const parsed = JSON.parse(rawText) as {
      script?: unknown;
      recommendedWpm?: unknown;
      estimatedDurationSeconds?: unknown;
      deliveryTip?: unknown;
    };

    const outputScript =
      typeof parsed.script === 'string' && parsed.script.trim()
        ? parsed.script.trim()
        : mode === 'pacing'
          ? script
          : '';

    if (!outputScript) {
      res.status(502).json({ error: 'AI response did not contain a valid teleprompter script.' });
      return;
    }

    const recommendedWpm = Math.round(
      Math.max(100, Math.min(180, Number(parsed.recommendedWpm) || 135))
    );
    const recommendedSpeedPxPerSec = wpmToScrollPxPerSec(recommendedWpm, fontSize);
    const estimatedDurationSeconds =
      Number.isFinite(Number(parsed.estimatedDurationSeconds)) && Number(parsed.estimatedDurationSeconds) > 0
        ? Math.round(Number(parsed.estimatedDurationSeconds))
        : estimateReadingSeconds(outputScript, recommendedWpm);
    const deliveryTip =
      typeof parsed.deliveryTip === 'string' && parsed.deliveryTip.trim()
        ? parsed.deliveryTip.trim().slice(0, 220)
        : 'Keep your eyes anchored inside the cyan lens-line band and pause gently at [PAUSE] cues.';

    const payload: TeleprompterAiResponse = {
      script: outputScript,
      recommendedWpm,
      recommendedSpeedPxPerSec,
      estimatedDurationSeconds,
      deliveryTip,
    };

    res.json(payload);
  } catch (err) {
    console.error('[Teleprompter AI Error]', err);
    const message =
      err instanceof Error && err.message
        ? `AI teleprompter request failed: ${err.message}`
        : 'AI teleprompter request failed. Please try again.';
    res.status(502).json({ error: message });
  }
});
