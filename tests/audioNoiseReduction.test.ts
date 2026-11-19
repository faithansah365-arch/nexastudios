import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  AdaptiveNoiseEstimator,
  computeVoiceActivityGain,
} from '../src/engine/audioNoiseReduction.ts';
import { db } from '../server/db.ts';
import { hashPassword, signEphemeralPayload, verifyEphemeralPayload } from '../server/security.ts';

test('AdaptiveNoiseEstimator tracks ambient noise floor while ignoring speech bursts', () => {
  const estimator = new AdaptiveNoiseEstimator(0.02);

  // Quiet frames pull the floor down
  for (let i = 0; i < 20; i++) {
    estimator.update(0.005, 0.25);
  }
  const settledFloor = estimator.getFloor();
  assert.ok(settledFloor < 0.01, `expected floor < 0.01, got ${settledFloor}`);

  // High-energy speech burst in vocal band should NOT pull noise floor upward
  for (let i = 0; i < 15; i++) {
    estimator.update(0.18, 0.78);
  }
  assert.equal(estimator.getFloor(), settledFloor);
});

test('computeVoiceActivityGain attenuates background noise and opens smoothly on speech', () => {
  const noiseFloor = 0.01;

  // Low ambient noise (at floor) stays attenuated
  const quiet = computeVoiceActivityGain({
    rms: 0.011,
    voiceBandRatio: 0.22,
    noiseFloor,
    strength: 'studio',
    currentlyOpen: false,
  });
  assert.equal(quiet.gateOpen, false);
  assert.ok(quiet.targetGain < 0.25, `expected strong attenuation, got ${quiet.targetGain}`);
  assert.ok(quiet.attenuationDb >= 12);

  // Speech energy above threshold opens gate cleanly
  const speech = computeVoiceActivityGain({
    rms: 0.06,
    voiceBandRatio: 0.72,
    noiseFloor,
    strength: 'balanced',
    currentlyOpen: false,
  });
  assert.equal(speech.gateOpen, true);
  assert.equal(speech.targetGain, 1.0);
  assert.equal(speech.attenuationDb, 0);
});

test('signEphemeralPayload and verifyEphemeralPayload validate OAuth state and reject tampering', () => {
  const token = signEphemeralPayload({ userId: 'u-123', purpose: 'google_signin' }, 60_000);
  const verified = verifyEphemeralPayload<{ userId: string; purpose: string }>(token);
  assert.ok(verified);
  assert.equal(verified.userId, 'u-123');
  assert.equal(verified.purpose, 'google_signin');

  // Tampered signature must fail
  const [body, sig] = token.split('.');
  const tampered = `${body}.${sig.slice(0, -2)}xx`;
  assert.equal(verifyEphemeralPayload(tampered), null);

  // Expired token must fail
  const expired = signEphemeralPayload({ userId: 'u-123' }, -500);
  assert.equal(verifyEphemeralPayload(expired), null);
});

test('database stores Google OAuth users and uploaded assets without Firebase', async () => {
  await db.close();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexaflow-google-test-'));
  await db.init(path.join(tmpDir, 'test.db'));

  try {
    const now = new Date().toISOString();
    const userId = crypto.randomUUID();
    await db.createUser({
      id: userId,
      name: 'Google Presenter',
      email: 'presenter@example.com',
      passwordHash: hashPassword('RandomUnusedSecret123!'),
      googleId: 'google-sub-999',
      authProvider: 'google',
      emailVerified: true,
      verificationToken: null,
      verificationExpiresAt: null,
      resetToken: null,
      resetExpiresAt: null,
      role: 'free',
      status: 'active',
      mfaEnabled: false,
      mfaSecret: null,
      createdAt: now,
      updatedAt: now,
    });

    const foundByGoogle = await db.findUserByGoogleId('google-sub-999');
    assert.ok(foundByGoogle);
    assert.equal(foundByGoogle.email, 'presenter@example.com');
    assert.equal(foundByGoogle.authProvider, 'google');
    assert.equal(foundByGoogle.emailVerified, true);

    const payload = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await db.saveUploadedAsset('sample_bg.png', 'image/png', payload);
    const loaded = await db.getUploadedAsset('sample_bg.png');
    assert.ok(loaded);
    assert.equal(loaded.mimeType, 'image/png');
    assert.deepEqual(loaded.data, payload);
  } finally {
    await db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
