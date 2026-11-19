import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampTeleprompterFontSize,
  clampTeleprompterSpeed,
  countScriptWords,
  DEFAULT_TELEPROMPTER_FONT_SIZE,
  DEFAULT_TELEPROMPTER_SPEED,
  estimateReadingSeconds,
  MAX_TELEPROMPTER_FONT_SIZE,
  MAX_TELEPROMPTER_SPEED,
  MIN_TELEPROMPTER_FONT_SIZE,
  MIN_TELEPROMPTER_SPEED,
  scrollPxPerSecToWpm,
  wpmToScrollPxPerSec,
} from '../shared/teleprompter.ts';

test('countScriptWords excludes bracketed cues such as [PAUSE]', () => {
  const sample = 'Welcome everyone.\n\n[PAUSE]\n\nToday we review three highlights [SMILE] together.';
  assert.equal(countScriptWords(sample), 8);
  assert.equal(countScriptWords('   [PAUSE]  '), 0);
});

test('estimateReadingSeconds accounts for spoken rate and pause beats', () => {
  // 135 words at 135 WPM = 60 seconds; two [PAUSE] cues add 3 seconds -> 63s
  const words = Array.from({ length: 135 }, (_, i) => `word${i}`).join(' ');
  const script = `${words}\n[PAUSE]\n[PAUSE]`;
  assert.equal(estimateReadingSeconds(script, 135), 63);
  assert.equal(estimateReadingSeconds('', 135), 0);
});

test('wpmToScrollPxPerSec scales proportionally with font size and WPM', () => {
  const smallFontSpeed = wpmToScrollPxPerSec(135, 20);
  const largeFontSpeed = wpmToScrollPxPerSec(135, 40);
  assert.ok(largeFontSpeed > smallFontSpeed, `expected ${largeFontSpeed} > ${smallFontSpeed}`);

  const fasterWpmSpeed = wpmToScrollPxPerSec(165, 24);
  const slowerWpmSpeed = wpmToScrollPxPerSec(115, 24);
  assert.ok(fasterWpmSpeed > slowerWpmSpeed, `expected ${fasterWpmSpeed} > ${slowerWpmSpeed}`);
});

test('scrollPxPerSecToWpm approximates round-trip WPM calibration', () => {
  const fontSize = 26;
  const speed = wpmToScrollPxPerSec(140, fontSize);
  const roundTrip = scrollPxPerSecToWpm(speed, fontSize);
  assert.ok(Math.abs(roundTrip - 140) <= 6, `expected ~140 WPM, got ${roundTrip}`);
});

test('clamp helpers guard bounds and non-finite inputs', () => {
  assert.equal(clampTeleprompterSpeed(Number.NaN), DEFAULT_TELEPROMPTER_SPEED);
  assert.equal(clampTeleprompterSpeed(-50), MIN_TELEPROMPTER_SPEED);
  assert.equal(clampTeleprompterSpeed(999), MAX_TELEPROMPTER_SPEED);

  assert.equal(clampTeleprompterFontSize(Number.NaN), DEFAULT_TELEPROMPTER_FONT_SIZE);
  assert.equal(clampTeleprompterFontSize(4), MIN_TELEPROMPTER_FONT_SIZE);
  assert.equal(clampTeleprompterFontSize(120), MAX_TELEPROMPTER_FONT_SIZE);
});
