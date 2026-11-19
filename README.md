# NexaFlow AI Studio

**Your Studio. Anywhere.**  
AI-assisted virtual production and video creation SaaS developed by **NexaFlow Technologies**.

---

## Architecture Overview

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, React Router, Three.js (`2.5D` depth-plane preview), Canvas 2D compositing, MediaPipe Tasks Vision (`SelfieSegmenter` running locally via WebAssembly/WebGL), Web Audio API, and MediaRecorder.
- **Backend**: Express + TypeScript (`server.ts`) with `vite.middlewares` in development and static `dist/` serving in production.
- **Database**: Pluggable 14-collection repository (`server/db.ts`) supporting:
  - **Zero-cost local SQLite (`node:sqlite`)** in `data/nexaflow.db` out of the box.
  - **MongoDB Atlas** automatically when `MONGODB_URI` is provided in environment variables.
- **Security**: `crypto.scrypt` password hashing, `HttpOnly` server-validated sessions, sliding-window rate limiting, magic-byte image upload validation, optional TOTP MFA for `/admin`, and one-time token initial administrator provisioning (`data/admin-bootstrap.token`).

---

## Local Development

```bash
npm install
npm run dev
```

The server binds to `http://0.0.0.0:3000`.

### Initial Administrator Provisioning

No administrator credentials are hardcoded. When zero administrators exist in the database:

1. Start the server (`npm run dev`).
2. Read the one-time setup token generated in `data/admin-bootstrap.token` (or configure `INITIAL_ADMIN_PROVISION_TOKEN`).
3. Navigate to `/admin` and complete the Initial Administrator Provisioning form.

---

## Automated Tests

```bash
npm run lint
npm run build
npm test
```

---

## Feature Implementation Status

### Implemented and Tested (Server & Unit Tests)
- User registration, `scrypt` hashing, login, logout, HttpOnly session management, password change/reset, account & data deletion.
- 4-tier subscription plan configuration (`Free`, `Creator`, `Pro Studio`, `Business`) in USD.
- Server-enforced atomic monthly export quota consumption and automatic quota rollback on failed export.
- TOTP MFA generation/verification and one-time token administrator bootstrap.
- Paystack HMAC-SHA512 webhook signature verification logic.

### Implemented (Requires Live Browser Camera / Hardware / External Credentials to Exercise End-to-End)
- **Live AI Virtual Studio**: MediaPipe SelfieSegmenter (local `/models/selfie_segmenter.tflite` + `/mediapipe/wasm`), Chroma Key fallback, camera/microphone selection, audio meter, adaptive FPS / low-power mode, Canvas layered compositing, and MediaRecorder scene capture.
- **Video Transformation**: Browser-decoded video upload, timeline trim, aspect ratio switching (`16:9`, `9:16`, `1:1`), brightness/contrast/saturation, volume/mute, logo & lower thirds, and WebM export.
- **AI Studio Generator & Studio Designer**: JPG/PNG/WebP photo upload, 2.5D foreground desk occlusion, Three.js depth-plane inspector, and custom studio CRUD.
- **OBS Clean Output (`/obs/:studioId?token=...`)**: Tokenized account-free browser source view with optional transparent keying.
- **Paystack Checkout (`test` / `live` mode)**: Requires `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, and an admin-configured or synced `USD -> GHS` exchange rate in `/admin` before initializing live/test transactions.

### Unavailable (Architecture Preserved, Marked Honestly in UI)
- **Direct Browser-to-RTMP Streaming & Multistreaming**: Marked unavailable until a dedicated server-side WebRTC/FFmpeg RTMP ingest pipeline is deployed; creators use the OBS Studio workflow in the interim.
- **Cloud Raw Video Object Storage**: Marked unavailable in $0 local mode; raw video exports download directly to the creator's device.
- **Automatic Speech-to-Text Captions & Paid Cloud Relighting**: Marked unavailable without external ASR/GPU infrastructure.
