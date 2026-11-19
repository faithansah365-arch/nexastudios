export type TeleprompterTone = 'conversational' | 'broadcast' | 'executive' | 'sermon' | 'educational';

export type TeleprompterAiMode = 'generate' | 'polish' | 'pacing';

export interface TeleprompterAiResponse {
  script: string;
  recommendedWpm: number;
  recommendedSpeedPxPerSec: number;
  estimatedDurationSeconds: number;
  deliveryTip: string;
}

export const MIN_TELEPROMPTER_SPEED = 12;
export const MAX_TELEPROMPTER_SPEED = 180;
export const DEFAULT_TELEPROMPTER_SPEED = 42;

export const MIN_TELEPROMPTER_FONT_SIZE = 16;
export const MAX_TELEPROMPTER_FONT_SIZE = 52;
export const DEFAULT_TELEPROMPTER_FONT_SIZE = 24;

export const DEFAULT_TELEPROMPTER_SCRIPT = `Welcome to today's broadcast.
Look directly into the camera lens as you begin.

[PAUSE]

Over the next few minutes, we will walk through three key takeaways designed to give your audience immediate clarity and actionable value.

First, focus on the core problem your viewers face every day.
Speak slowly, breathe naturally between thoughts, and let your voice carry steady confidence.

[PAUSE]

Second, share one concrete example or story that makes the takeaway memorable.
Use the AI Script drawer above anytime to generate a custom script or calibrate your scroll pace.`;

export function clampTeleprompterSpeed(pxPerSec: number): number {
  if (!Number.isFinite(pxPerSec)) return DEFAULT_TELEPROMPTER_SPEED;
  return Math.round(Math.max(MIN_TELEPROMPTER_SPEED, Math.min(MAX_TELEPROMPTER_SPEED, pxPerSec)));
}

export function clampTeleprompterFontSize(fontSizePx: number): number {
  if (!Number.isFinite(fontSizePx)) return DEFAULT_TELEPROMPTER_FONT_SIZE;
  return Math.round(Math.max(MIN_TELEPROMPTER_FONT_SIZE, Math.min(MAX_TELEPROMPTER_FONT_SIZE, fontSizePx)));
}

/**
 * Counts spoken words while excluding bracketed stage cues like [PAUSE] or [SMILE].
 */
export function countScriptWords(script: string): number {
  if (!script || !script.trim()) return 0;
  const cleaned = script.replace(/\[[^\]]+\]/g, ' ').trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(Boolean).length;
}

export function estimateReadingSeconds(script: string, wpm = 135): number {
  const words = countScriptWords(script);
  if (words === 0) return 0;
  const safeWpm = Math.max(70, Math.min(240, wpm || 135));
  const pauseMatches = script.match(/\[PAUSE\]/gi);
  const pauseBonusSec = pauseMatches ? pauseMatches.length * 1.5 : 0;
  return Math.max(1, Math.round((words / safeWpm) * 60 + pauseBonusSec));
}

/**
 * Approximates comfortable vertical scroll speed (px/s) for a given speaking rate (WPM)
 * and teleprompter font size, assuming ~7.5 words per wrapped line at 1.55 line height.
 */
export function wpmToScrollPxPerSec(wpm: number, fontSizePx: number): number {
  const safeWpm = Math.max(70, Math.min(240, wpm));
  const safeFont = clampTeleprompterFontSize(fontSizePx);
  const wordsPerSecond = safeWpm / 60;
  const wordsPerLine = 7.5;
  const linesPerSecond = wordsPerSecond / wordsPerLine;
  const lineHeightPx = safeFont * 1.55;
  return clampTeleprompterSpeed(linesPerSecond * lineHeightPx);
}

export function scrollPxPerSecToWpm(pxPerSec: number, fontSizePx: number): number {
  const safeSpeed = clampTeleprompterSpeed(pxPerSec);
  const safeFont = clampTeleprompterFontSize(fontSizePx);
  const lineHeightPx = safeFont * 1.55;
  const wordsPerLine = 7.5;
  const linesPerSecond = safeSpeed / lineHeightPx;
  return Math.round(Math.max(60, Math.min(260, linesPerSecond * wordsPerLine * 60)));
}
