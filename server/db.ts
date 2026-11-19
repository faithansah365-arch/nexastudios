import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { MongoClient, type Db as MongoDb } from 'mongodb';
import type {
  AppSettings,
  AuditLog,
  CouponRecord,
  CustomStudio,
  ExportRecord,
  PaymentRecord,
  PlanId,
  PlanRecord,
  ProjectRecord,
  PublicUser,
  StudioTemplate,
  SubscriptionRecord,
  SupportRequest,
  UsageRecord,
  UserRole,
} from '../shared/types.ts';

export interface StoredUser extends PublicUser {
  passwordHash: string;
  googleId?: string | null;
  authProvider?: 'local' | 'google';
  verificationToken?: string | null;
  verificationExpiresAt?: string | null;
  resetToken?: string | null;
  resetExpiresAt?: string | null;
  mfaSecret?: string | null;
  updatedAt: string;
}

export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  ip: string;
  userAgent: string;
  expiresAt: string;
  createdAt: string;
}

export interface TeamMembershipRecord {
  id: string;
  ownerUserId: string;
  memberEmail: string;
  memberUserId?: string;
  role: 'editor' | 'viewer';
  status: 'pending' | 'active';
  createdAt: string;
}

function resolveDataDir(): string {
  const isServerless = Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME);
  if (isServerless) {
    return path.join(os.tmpdir(), 'nexaflow-data');
  }
  return path.resolve(process.cwd(), 'data');
}

const DATA_DIR = resolveDataDir();
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

export function ensureDataDirectories(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  } catch {
    // Read-only filesystem in restricted serverless containers; MongoDB handles persistence
  }
}

export function getDataDir(): string {
  return DATA_DIR;
}

export function getUploadDir(): string {
  return UPLOAD_DIR;
}

export function currentPeriodKey(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function toPublicUser(u: StoredUser): PublicUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    emailVerified: u.emailVerified,
    role: u.role,
    status: u.status,
    mfaEnabled: u.mfaEnabled,
    createdAt: u.createdAt,
  };
}

const DEFAULT_PLANS: PlanRecord[] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'For testing browser-based virtual production',
    monthlyPriceUsd: 0,
    annualPriceUsd: 0,
    limits: {
      maxTemplates: 2,
      maxSavedStudios: 1,
      maxRecordingMinutes: 3,
      maxExportsPerMonth: 2,
      maxExportResolution: '720p',
      watermarkRequired: true,
      maxUploadMb: 100,
      customBranding: false,
      teleprompter: false,
      obsWorkflow: false,
      teamMembers: 1,
      prioritySupport: false,
      advancedBroadcast: false,
    },
    active: true,
    sortOrder: 1,
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'creator',
    name: 'Creator',
    tagline: 'For YouTubers, podcasters, and solo educators',
    monthlyPriceUsd: 19,
    annualPriceUsd: 190,
    limits: {
      maxTemplates: 15,
      maxSavedStudios: 5,
      maxRecordingMinutes: 30,
      maxExportsPerMonth: 30,
      maxExportResolution: '1080p',
      watermarkRequired: false,
      maxUploadMb: 1024,
      customBranding: true,
      teleprompter: true,
      obsWorkflow: true,
      teamMembers: 1,
      prioritySupport: false,
      advancedBroadcast: false,
    },
    active: true,
    sortOrder: 2,
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'pro_studio',
    name: 'Pro Studio',
    tagline: 'For churches, agencies, and recurring broadcasts',
    monthlyPriceUsd: 49,
    annualPriceUsd: 490,
    limits: {
      maxTemplates: 50,
      maxSavedStudios: 25,
      maxRecordingMinutes: 120,
      maxExportsPerMonth: 100,
      maxExportResolution: '1080p',
      watermarkRequired: false,
      maxUploadMb: 3072,
      customBranding: true,
      teleprompter: true,
      obsWorkflow: true,
      teamMembers: 2,
      prioritySupport: true,
      advancedBroadcast: false,
    },
    active: true,
    sortOrder: 3,
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'business',
    name: 'Business',
    tagline: 'For media teams and multi-operator organizations',
    monthlyPriceUsd: 99,
    annualPriceUsd: 990,
    limits: {
      maxTemplates: -1,
      maxSavedStudios: 100,
      maxRecordingMinutes: 240,
      maxExportsPerMonth: 300,
      maxExportResolution: '4k',
      watermarkRequired: false,
      maxUploadMb: 5120,
      customBranding: true,
      teleprompter: true,
      obsWorkflow: true,
      teamMembers: 5,
      prioritySupport: true,
      advancedBroadcast: true,
    },
    active: true,
    sortOrder: 4,
    updatedAt: new Date().toISOString(),
  },
];

const DEFAULT_TEMPLATES: StudioTemplate[] = [
  {
    id: 'tpl_grace_sanctuary',
    name: 'Grace Sanctuary Broadcast',
    category: 'Church Broadcasting Studios',
    description: 'Warm acoustic walnut sanctuary virtual backdrop with stone arches and a layered pulpit plane.',
    thumbnailUrl: '/src/assets/images/bg_sanctuary_backdrop_1795098725106.jpg',
    backgroundUrl: '/src/assets/images/bg_sanctuary_backdrop_1795098725106.jpg',
    studioType: 'layered_2_5d',
    foregroundMaskConfig: {
      enabled: true,
      deskHeightRatio: 0.24,
      deskStyle: 'church_pulpit',
      perspectiveTilt: 0,
      deskOpacity: 0.98,
    },
    defaultSubjectConfig: {
      scale: 0.96,
      offsetX: 0,
      offsetY: 0.06,
      colorTemp: 8,
      brightness: 1.02,
      contrast: 1.04,
      saturation: 1.02,
      bgBlur: 2,
      edgeSoftness: 3,
      shadowIntensity: 0.35,
      chromaKeyEnabled: false,
      chromaKeyColor: '#00b140',
      chromaSimilarity: 0.24,
      chromaSmoothness: 0.08,
    },
    defaultBrandingConfig: {
      logoPosition: 'top-right',
      primaryColor: '#6366F1',
      secondaryColor: '#F59E0B',
      screenText: 'Sunday Live Broadcast',
      showScreenGraphic: false,
      lowerThirdTitle: 'Senior Pastor',
      lowerThirdSubtitle: 'Weekly Message',
      showLowerThird: false,
    },
    recommendedFraming: 'medium',
    lightingPreset: 'warm_studio',
    supportedAspectRatios: ['16:9', '9:16', '1:1'],
    requiredPlan: 'free',
    isAvailable: true,
    sortOrder: 1,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'tpl_metro_briefing',
    name: 'Metro Briefing Desk',
    category: 'Television News Studios',
    description: 'Eye-level glass-and-navy broadcast virtual backdrop with an anchor desk foreground layer and crisp lower-third framing.',
    thumbnailUrl: '/src/assets/images/bg_news_broadcast_1795098704414.jpg',
    backgroundUrl: '/src/assets/images/bg_news_broadcast_1795098704414.jpg',
    studioType: 'layered_2_5d',
    foregroundMaskConfig: {
      enabled: true,
      deskHeightRatio: 0.28,
      deskStyle: 'news_glass',
      perspectiveTilt: 0,
      deskOpacity: 0.96,
    },
    defaultSubjectConfig: {
      scale: 0.94,
      offsetX: 0,
      offsetY: 0.04,
      colorTemp: -6,
      brightness: 1.0,
      contrast: 1.06,
      saturation: 1.0,
      bgBlur: 2,
      edgeSoftness: 3,
      shadowIntensity: 0.4,
      chromaKeyEnabled: false,
      chromaKeyColor: '#00b140',
      chromaSimilarity: 0.24,
      chromaSmoothness: 0.08,
    },
    defaultBrandingConfig: {
      logoPosition: 'top-left',
      primaryColor: '#6366F1',
      secondaryColor: '#06B6D4',
      screenText: 'GLOBAL BRIEFING',
      showScreenGraphic: true,
      lowerThirdTitle: 'Anchor Name',
      lowerThirdSubtitle: 'Live Studio Report',
      showLowerThird: true,
    },
    recommendedFraming: 'medium',
    lightingPreset: 'cool_broadcast',
    supportedAspectRatios: ['16:9', '9:16', '1:1'],
    requiredPlan: 'free',
    isAvailable: true,
    sortOrder: 2,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'tpl_midnight_podcast',
    name: 'Midnight Creator Lounge',
    category: 'Podcast Studios',
    description: 'Intimate acoustic charcoal wall with warm tungsten shelves and an oak podcast foreground table.',
    thumbnailUrl: '/src/assets/images/bg_podcast_lounge_1795098704262.jpg',
    backgroundUrl: '/src/assets/images/bg_podcast_lounge_1795098704262.jpg',
    studioType: 'layered_2_5d',
    foregroundMaskConfig: {
      enabled: true,
      deskHeightRatio: 0.26,
      deskStyle: 'podcast_oak',
      perspectiveTilt: 0,
      deskOpacity: 0.98,
    },
    defaultSubjectConfig: {
      scale: 1.0,
      offsetX: 0,
      offsetY: 0.05,
      colorTemp: 10,
      brightness: 1.02,
      contrast: 1.05,
      saturation: 1.03,
      bgBlur: 3,
      edgeSoftness: 3,
      shadowIntensity: 0.38,
      chromaKeyEnabled: false,
      chromaKeyColor: '#00b140',
      chromaSimilarity: 0.24,
      chromaSmoothness: 0.08,
    },
    defaultBrandingConfig: {
      logoPosition: 'top-left',
      primaryColor: '#6366F1',
      secondaryColor: '#06B6D4',
      screenText: 'EPISODE 01',
      showScreenGraphic: false,
      lowerThirdTitle: 'Podcast Host',
      lowerThirdSubtitle: 'Creator Commentary',
      showLowerThird: false,
    },
    recommendedFraming: 'medium',
    lightingPreset: 'warm_studio',
    supportedAspectRatios: ['16:9', '9:16', '1:1'],
    requiredPlan: 'creator',
    isAvailable: true,
    sortOrder: 3,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'tpl_horizon_led_stage',
    name: 'Horizon Curved LED Stage',
    category: 'Corporate Presentation Studios',
    description: 'Architectural slate & warm-wood keynote virtual backdrop with subtle cyan cove depth and slate foreground desk.',
    thumbnailUrl: '/src/assets/images/bg_executive_keynote_1795098704486.jpg',
    backgroundUrl: '/src/assets/images/bg_executive_keynote_1795098704486.jpg',
    studioType: 'layered_2_5d',
    foregroundMaskConfig: {
      enabled: true,
      deskHeightRatio: 0.25,
      deskStyle: 'minimal_slate',
      perspectiveTilt: 0,
      deskOpacity: 0.96,
    },
    defaultSubjectConfig: {
      scale: 0.95,
      offsetX: 0,
      offsetY: 0.06,
      colorTemp: -4,
      brightness: 1.0,
      contrast: 1.05,
      saturation: 1.02,
      bgBlur: 2,
      edgeSoftness: 3,
      shadowIntensity: 0.4,
      chromaKeyEnabled: false,
      chromaKeyColor: '#00b140',
      chromaSimilarity: 0.24,
      chromaSmoothness: 0.08,
    },
    defaultBrandingConfig: {
      logoPosition: 'top-right',
      primaryColor: '#6366F1',
      secondaryColor: '#06B6D4',
      screenText: 'QUARTERLY KEYNOTE',
      showScreenGraphic: true,
      lowerThirdTitle: 'Presenter Name',
      lowerThirdSubtitle: 'Executive Keynote',
      showLowerThird: true,
    },
    recommendedFraming: 'wide',
    lightingPreset: 'cool_broadcast',
    supportedAspectRatios: ['16:9', '9:16', '1:1'],
    requiredPlan: 'creator',
    isAvailable: true,
    sortOrder: 4,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'tpl_academy_lecture_pending',
    name: 'Academy Lecture Hall',
    category: 'Educational Studios',
    description: 'Structured template slot for educational lecture backdrops and whiteboard overlays.',
    thumbnailUrl: '',
    backgroundUrl: '',
    studioType: 'layered_2_5d',
    foregroundMaskConfig: {
      enabled: true,
      deskHeightRatio: 0.24,
      deskStyle: 'minimal_slate',
      perspectiveTilt: 0,
      deskOpacity: 0.95,
    },
    defaultSubjectConfig: {
      scale: 1.0,
      offsetX: 0,
      offsetY: 0.05,
      colorTemp: 0,
      brightness: 1.0,
      contrast: 1.0,
      saturation: 1.0,
      bgBlur: 0,
      edgeSoftness: 3,
      shadowIntensity: 0.3,
      chromaKeyEnabled: false,
      chromaKeyColor: '#00b140',
      chromaSimilarity: 0.24,
      chromaSmoothness: 0.08,
    },
    defaultBrandingConfig: {
      logoPosition: 'top-left',
      primaryColor: '#6366F1',
      secondaryColor: '#06B6D4',
      screenText: '',
      showScreenGraphic: false,
      lowerThirdTitle: 'Instructor',
      lowerThirdSubtitle: 'Course Module',
      showLowerThird: false,
    },
    recommendedFraming: 'medium',
    lightingPreset: 'neutral',
    supportedAspectRatios: ['16:9', '9:16'],
    requiredPlan: 'creator',
    isAvailable: false,
    availabilityNote: 'Premium asset unavailable until uploaded by an Administrator in /admin.',
    sortOrder: 5,
    createdAt: new Date().toISOString(),
  },
];

function getDefaultAppSettings(engine: 'sqlite_local' | 'mongodb_atlas'): AppSettings {
  const hasPaystack = Boolean(process.env.PAYSTACK_SECRET_KEY && process.env.PAYSTACK_PUBLIC_KEY);
  return {
    paystackMode: process.env.PAYSTACK_SECRET_KEY?.startsWith('sk_live_') ? 'live' : 'test',
    paystackConfigured: hasPaystack,
    settlementCurrency: 'GHS',
    usdToGhsRate: null,
    exchangeRateSource: 'Not configured',
    exchangeRateUpdatedAt: null,
    directStreamingEnabled: false,
    cloudStorageEnabled: false,
    autoCaptionsEnabled: false,
    maintenanceMode: false,
    databaseEngine: engine,
  };
}

class NexaDatabase {
  private sqlite: DatabaseSync | null = null;
  private mongoClient: MongoClient | null = null;
  private mongo: MongoDb | null = null;
  private engine: 'sqlite_local' | 'mongodb_atlas' = 'sqlite_local';
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  async init(customSqlitePath?: string): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise && !customSqlitePath) {
      return this.initPromise;
    }

    const runInit = async () => {
      if (this.initialized) return;
      ensureDataDirectories();

      const mongoUri = process.env.MONGODB_URI?.trim();
      if (mongoUri && !customSqlitePath) {
        try {
          this.mongoClient = new MongoClient(mongoUri, {
            serverSelectionTimeoutMS: 8000,
            maxPoolSize: 10,
          });
          await this.mongoClient.connect();
          this.mongo = this.mongoClient.db(process.env.MONGODB_DB_NAME || 'nexaflow_studio');
          this.engine = 'mongodb_atlas';
          await this.initMongoIndexes();
          await this.seedDefaults();
          this.initialized = true;
          console.log('[DB] Connected to MongoDB Atlas');
          return;
        } catch (err) {
          console.error('[DB] MongoDB Atlas connection failed, falling back to local SQLite:', err);
        }
      }

      const { DatabaseSync: SqliteDatabaseSync } = await import('node:sqlite');
      const dbPath = customSqlitePath || path.join(DATA_DIR, 'nexaflow.db');
      this.sqlite = new SqliteDatabaseSync(dbPath);
      this.sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
      this.initSqliteSchema();
      this.engine = 'sqlite_local';
      await this.seedDefaults();
      this.initialized = true;
      console.log(`[DB] Connected to local SQLite (${dbPath})`);
    };

    if (!customSqlitePath) {
      this.initPromise = runInit().catch((err) => {
        this.initPromise = null;
        throw err;
      });
      return this.initPromise;
    }

    return runInit();
  }

  getEngine(): 'sqlite_local' | 'mongodb_atlas' {
    return this.engine;
  }

  private initSqliteSchema(): void {
    if (!this.sqlite) return;
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        passwordHash TEXT NOT NULL,
        emailVerified INTEGER NOT NULL DEFAULT 0,
        verificationToken TEXT,
        verificationExpiresAt TEXT,
        resetToken TEXT,
        resetExpiresAt TEXT,
        role TEXT NOT NULL DEFAULT 'free',
        status TEXT NOT NULL DEFAULT 'active',
        mfaEnabled INTEGER NOT NULL DEFAULT 0,
        mfaSecret TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        tokenHash TEXT NOT NULL UNIQUE,
        ip TEXT NOT NULL,
        userAgent TEXT NOT NULL,
        expiresAt TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        tagline TEXT NOT NULL,
        monthlyPriceUsd REAL NOT NULL,
        annualPriceUsd REAL NOT NULL,
        limits TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        sortOrder INTEGER NOT NULL DEFAULT 0,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL UNIQUE,
        planId TEXT NOT NULL,
        billingCycle TEXT NOT NULL,
        status TEXT NOT NULL,
        currentPeriodStart TEXT NOT NULL,
        currentPeriodEnd TEXT NOT NULL,
        autoRenew INTEGER NOT NULL DEFAULT 0,
        paystackCustomerCode TEXT,
        paystackSubscriptionCode TEXT,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        planId TEXT NOT NULL,
        billingCycle TEXT NOT NULL,
        reference TEXT NOT NULL UNIQUE,
        amountUsd REAL NOT NULL,
        currency TEXT NOT NULL,
        exchangeRate REAL NOT NULL,
        amountMinor INTEGER NOT NULL,
        status TEXT NOT NULL,
        provider TEXT NOT NULL,
        channel TEXT,
        gatewayResponse TEXT,
        couponCode TEXT,
        originalAmountUsd REAL,
        discountUsd REAL,
        verifiedAt TEXT,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS coupons (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL,
        discountType TEXT NOT NULL,
        discountValue REAL NOT NULL,
        applicablePlans TEXT NOT NULL,
        maxRedemptions INTEGER,
        redemptionsCount INTEGER NOT NULL DEFAULT 0,
        expiresAt TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        createdByEmail TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS usage_records (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        periodKey TEXT NOT NULL,
        exportsCount INTEGER NOT NULL DEFAULT 0,
        recordingsCount INTEGER NOT NULL DEFAULT 0,
        failedExportsCount INTEGER NOT NULL DEFAULT 0,
        lastExportAt TEXT,
        updatedAt TEXT NOT NULL,
        UNIQUE(userId, periodKey)
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        title TEXT NOT NULL,
        type TEXT NOT NULL,
        studioId TEXT,
        aspectRatio TEXT NOT NULL,
        durationSeconds INTEGER NOT NULL DEFAULT 0,
        storageNote TEXT NOT NULL,
        settings TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS studios (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        studioType TEXT NOT NULL,
        templateId TEXT,
        backgroundUrl TEXT NOT NULL,
        foregroundMaskConfig TEXT NOT NULL,
        subjectConfig TEXT NOT NULL,
        brandingConfig TEXT NOT NULL,
        cameraFraming TEXT NOT NULL,
        lightingPreset TEXT NOT NULL,
        supportedAspectRatios TEXT NOT NULL,
        obsShareEnabled INTEGER NOT NULL DEFAULT 0,
        obsShareToken TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS studio_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT NOT NULL,
        thumbnailUrl TEXT NOT NULL,
        backgroundUrl TEXT NOT NULL,
        studioType TEXT NOT NULL,
        foregroundMaskConfig TEXT NOT NULL,
        defaultSubjectConfig TEXT NOT NULL,
        defaultBrandingConfig TEXT NOT NULL,
        recommendedFraming TEXT NOT NULL,
        lightingPreset TEXT NOT NULL,
        supportedAspectRatios TEXT NOT NULL,
        requiredPlan TEXT NOT NULL,
        isAvailable INTEGER NOT NULL DEFAULT 1,
        availabilityNote TEXT,
        sortOrder INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS exports (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        projectId TEXT,
        studioId TEXT,
        title TEXT NOT NULL,
        resolution TEXT NOT NULL,
        aspectRatio TEXT NOT NULL,
        format TEXT NOT NULL,
        durationSeconds INTEGER NOT NULL,
        watermarked INTEGER NOT NULL,
        status TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS team_memberships (
        id TEXT PRIMARY KEY,
        ownerUserId TEXT NOT NULL,
        memberEmail TEXT NOT NULL,
        memberUserId TEXT,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS support_requests (
        id TEXT PRIMARY KEY,
        userId TEXT,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        subject TEXT NOT NULL,
        category TEXT NOT NULL,
        message TEXT NOT NULL,
        priority TEXT NOT NULL,
        status TEXT NOT NULL,
        adminNotes TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        actorUserId TEXT NOT NULL,
        actorEmail TEXT NOT NULL,
        action TEXT NOT NULL,
        targetType TEXT NOT NULL,
        targetId TEXT NOT NULL,
        details TEXT NOT NULL,
        ip TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(userId);
      CREATE INDEX IF NOT EXISTS idx_studios_user ON studios(userId);
      CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(userId);
      CREATE INDEX IF NOT EXISTS idx_exports_user ON exports(userId);
      CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(userId);
      CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
    `);
    // Safe column additions for existing SQLite databases
    for (const col of ['couponCode TEXT', 'originalAmountUsd REAL', 'discountUsd REAL']) {
      try {
        this.sqlite.exec(`ALTER TABLE payments ADD COLUMN ${col}`);
      } catch {
        // Column already exists
      }
    }
    for (const col of ['googleId TEXT', "authProvider TEXT DEFAULT 'local'"]) {
      try {
        this.sqlite.exec(`ALTER TABLE users ADD COLUMN ${col}`);
      } catch {
        // Column already exists
      }
    }
  }

  private async initMongoIndexes(): Promise<void> {
    if (!this.mongo) return;
    await Promise.all([
      this.mongo.collection('users').createIndex({ email: 1 }, { unique: true }),
      this.mongo.collection('sessions').createIndex({ tokenHash: 1 }, { unique: true }),
      this.mongo.collection('subscriptions').createIndex({ userId: 1 }, { unique: true }),
      this.mongo.collection('payments').createIndex({ reference: 1 }, { unique: true }),
      this.mongo.collection('coupons').createIndex({ code: 1 }, { unique: true }),
      this.mongo.collection('usage_records').createIndex({ userId: 1, periodKey: 1 }, { unique: true }),
      this.mongo.collection('studios').createIndex({ userId: 1 }),
      this.mongo.collection('projects').createIndex({ userId: 1 }),
      this.mongo.collection('exports').createIndex({ userId: 1 }),
    ]);
  }

  private async seedDefaults(): Promise<void> {
    const existingPlans = await this.listPlans();
    if (existingPlans.length === 0) {
      for (const plan of DEFAULT_PLANS) {
        await this.upsertPlan(plan);
      }
    }

    const existingTemplates = await this.listTemplates();
    if (existingTemplates.length === 0) {
      for (const tpl of DEFAULT_TEMPLATES) {
        await this.upsertTemplate(tpl);
      }
    } else {
      // Idempotently upgrade legacy wide-room studio photos to true eye-level 2.5D virtual backgrounds
      const legacyImageSet = new Set([
        '/src/assets/images/studio_church_sanctuary_1795011534257.jpg',
        '/src/assets/images/studio_news_desk_1795011533684.jpg',
        '/src/assets/images/studio_podcast_lounge_1795011534156.jpg',
        '/src/assets/images/hero_virtual_studio_1795011533022.jpg',
      ]);
      for (const def of DEFAULT_TEMPLATES) {
        const cur = existingTemplates.find((t) => t.id === def.id);
        if (cur && legacyImageSet.has(cur.backgroundUrl)) {
          await this.upsertTemplate({
            ...cur,
            thumbnailUrl: def.thumbnailUrl,
            backgroundUrl: def.backgroundUrl,
            description: def.description,
          });
        }
      }
    }

    const settings = await this.getAppSettingsRaw();
    if (!settings) {
      await this.saveAppSettings(getDefaultAppSettings(this.engine));
    }
  }

  // ---- USERS ----
  async countAdmins(): Promise<number> {
    if (this.mongo) {
      return this.mongo.collection('users').countDocuments({ role: 'admin' });
    }
    const row = this.sqlite!.prepare(`SELECT COUNT(*) as cnt FROM users WHERE role = 'admin'`).get() as { cnt: number };
    return row.cnt;
  }

  async findUserByEmail(email: string): Promise<StoredUser | null> {
    const normalized = email.trim().toLowerCase();
    if (this.mongo) {
      const doc = await this.mongo.collection('users').findOne({ email: normalized });
      return doc ? (doc as unknown as StoredUser) : null;
    }
    const row = this.sqlite!.prepare(`SELECT * FROM users WHERE email = ?`).get(normalized) as Record<string, unknown> | undefined;
    return row ? this.mapSqliteUser(row) : null;
  }

  async findUserById(id: string): Promise<StoredUser | null> {
    if (this.mongo) {
      const doc = await this.mongo.collection('users').findOne({ id });
      return doc ? (doc as unknown as StoredUser) : null;
    }
    const row = this.sqlite!.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? this.mapSqliteUser(row) : null;
  }

  async findUserByVerificationToken(token: string): Promise<StoredUser | null> {
    if (this.mongo) {
      const doc = await this.mongo.collection('users').findOne({ verificationToken: token });
      return doc ? (doc as unknown as StoredUser) : null;
    }
    const row = this.sqlite!.prepare(`SELECT * FROM users WHERE verificationToken = ?`).get(token) as Record<string, unknown> | undefined;
    return row ? this.mapSqliteUser(row) : null;
  }

  async findUserByResetToken(token: string): Promise<StoredUser | null> {
    if (this.mongo) {
      const doc = await this.mongo.collection('users').findOne({ resetToken: token });
      return doc ? (doc as unknown as StoredUser) : null;
    }
    const row = this.sqlite!.prepare(`SELECT * FROM users WHERE resetToken = ?`).get(token) as Record<string, unknown> | undefined;
    return row ? this.mapSqliteUser(row) : null;
  }

  async findUserByGoogleId(googleId: string): Promise<StoredUser | null> {
    if (!googleId) return null;
    if (this.mongo) {
      const doc = await this.mongo.collection('users').findOne({ googleId });
      return doc ? (doc as unknown as StoredUser) : null;
    }
    const row = this.sqlite!.prepare(`SELECT * FROM users WHERE googleId = ?`).get(googleId) as Record<string, unknown> | undefined;
    return row ? this.mapSqliteUser(row) : null;
  }

  private mapSqliteUser(row: Record<string, unknown>): StoredUser {
    return {
      id: String(row.id),
      name: String(row.name),
      email: String(row.email),
      passwordHash: String(row.passwordHash),
      googleId: row.googleId ? String(row.googleId) : null,
      authProvider: row.authProvider === 'google' ? 'google' : 'local',
      emailVerified: Boolean(row.emailVerified),
      verificationToken: row.verificationToken ? String(row.verificationToken) : null,
      verificationExpiresAt: row.verificationExpiresAt ? String(row.verificationExpiresAt) : null,
      resetToken: row.resetToken ? String(row.resetToken) : null,
      resetExpiresAt: row.resetExpiresAt ? String(row.resetExpiresAt) : null,
      role: row.role as UserRole,
      status: row.status as 'active' | 'suspended',
      mfaEnabled: Boolean(row.mfaEnabled),
      mfaSecret: row.mfaSecret ? String(row.mfaSecret) : null,
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
    };
  }

  async createUser(user: StoredUser): Promise<void> {
    if (this.mongo) {
      await this.mongo.collection('users').insertOne({ ...user });
      return;
    }
    this.sqlite!.prepare(`
      INSERT INTO users (id, name, email, passwordHash, googleId, authProvider, emailVerified, verificationToken, verificationExpiresAt, resetToken, resetExpiresAt, role, status, mfaEnabled, mfaSecret, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user.id,
      user.name,
      user.email,
      user.passwordHash,
      user.googleId ?? null,
      user.authProvider ?? 'local',
      user.emailVerified ? 1 : 0,
      user.verificationToken ?? null,
      user.verificationExpiresAt ?? null,
      user.resetToken ?? null,
      user.resetExpiresAt ?? null,
      user.role,
      user.status,
      user.mfaEnabled ? 1 : 0,
      user.mfaSecret ?? null,
      user.createdAt,
      user.updatedAt
    );
  }

  async updateUser(id: string, patch: Partial<StoredUser>): Promise<void> {
    const updatedAt = new Date().toISOString();
    if (this.mongo) {
      await this.mongo.collection('users').updateOne({ id }, { $set: { ...patch, updatedAt } });
      return;
    }
    const current = await this.findUserById(id);
    if (!current) return;
    const merged = { ...current, ...patch, updatedAt };
    this.sqlite!.prepare(`
      UPDATE users SET name=?, email=?, passwordHash=?, googleId=?, authProvider=?, emailVerified=?, verificationToken=?, verificationExpiresAt=?, resetToken=?, resetExpiresAt=?, role=?, status=?, mfaEnabled=?, mfaSecret=?, updatedAt=?
      WHERE id=?
    `).run(
      merged.name,
      merged.email,
      merged.passwordHash,
      merged.googleId ?? null,
      merged.authProvider ?? 'local',
      merged.emailVerified ? 1 : 0,
      merged.verificationToken ?? null,
      merged.verificationExpiresAt ?? null,
      merged.resetToken ?? null,
      merged.resetExpiresAt ?? null,
      merged.role,
      merged.status,
      merged.mfaEnabled ? 1 : 0,
      merged.mfaSecret ?? null,
      merged.updatedAt,
      id
    );
  }

  async listUsers(): Promise<PublicUser[]> {
    if (this.mongo) {
      const docs = await this.mongo.collection('users').find({}).sort({ createdAt: -1 }).toArray();
      return docs.map((d) => toPublicUser(d as unknown as StoredUser));
    }
    const rows = this.sqlite!.prepare(`SELECT * FROM users ORDER BY createdAt DESC`).all() as Record<string, unknown>[];
    return rows.map((r) => toPublicUser(this.mapSqliteUser(r)));
  }

  async deleteUserAndData(userId: string): Promise<void> {
    if (this.mongo) {
      await Promise.all([
        this.mongo.collection('sessions').deleteMany({ userId }),
        this.mongo.collection('subscriptions').deleteMany({ userId }),
        this.mongo.collection('usage_records').deleteMany({ userId }),
        this.mongo.collection('projects').deleteMany({ userId }),
        this.mongo.collection('studios').deleteMany({ userId }),
        this.mongo.collection('exports').deleteMany({ userId }),
        this.mongo.collection('team_memberships').deleteMany({ ownerUserId: userId }),
        this.mongo.collection('users').deleteOne({ id: userId }),
      ]);
      return;
    }
    this.sqlite!.exec('BEGIN');
    try {
      for (const table of ['sessions', 'subscriptions', 'usage_records', 'projects', 'studios', 'exports']) {
        this.sqlite!.prepare(`DELETE FROM ${table} WHERE userId = ?`).run(userId);
      }
      this.sqlite!.prepare(`DELETE FROM team_memberships WHERE ownerUserId = ?`).run(userId);
      this.sqlite!.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
      this.sqlite!.exec('COMMIT');
    } catch (err) {
      this.sqlite!.exec('ROLLBACK');
      throw err;
    }
  }

  // ---- SESSIONS ----
  async createSession(session: SessionRecord): Promise<void> {
    if (this.mongo) {
      await this.mongo.collection('sessions').insertOne({ ...session });
      return;
    }
    this.sqlite!.prepare(`
      INSERT INTO sessions (id, userId, tokenHash, ip, userAgent, expiresAt, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(session.id, session.userId, session.tokenHash, session.ip, session.userAgent, session.expiresAt, session.createdAt);
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    if (this.mongo) {
      const doc = await this.mongo.collection('sessions').findOne({ tokenHash });
      return doc ? (doc as unknown as SessionRecord) : null;
    }
    const row = this.sqlite!.prepare(`SELECT * FROM sessions WHERE tokenHash = ?`).get(tokenHash) as Record<string, unknown> | undefined;
    return row ? (row as unknown as SessionRecord) : null;
  }

  async deleteSessionByTokenHash(tokenHash: string): Promise<void> {
    if (this.mongo) {
      await this.mongo.collection('sessions').deleteOne({ tokenHash });
      return;
    }
    this.sqlite!.prepare(`DELETE FROM sessions WHERE tokenHash = ?`).run(tokenHash);
  }

  async deleteSessionsByUserId(userId: string): Promise<void> {
    if (this.mongo) {
      await this.mongo.collection('sessions').deleteMany({ userId });
      return;
    }
    this.sqlite!.prepare(`DELETE FROM sessions WHERE userId = ?`).run(userId);
  }

  // ---- PLANS ----
  async listPlans(): Promise<PlanRecord[]> {
    if (this.mongo) {
      const docs = await this.mongo.collection('plans').find({}).sort({ sortOrder: 1 }).toArray();
      return docs as unknown as PlanRecord[];
    }
    const rows = this.sqlite!.prepare(`SELECT * FROM plans ORDER BY sortOrder ASC`).all() as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as PlanId,
      name: String(r.name),
      tagline: String(r.tagline),
      monthlyPriceUsd: Number(r.monthlyPriceUsd),
      annualPriceUsd: Number(r.annualPriceUsd),
      limits: JSON.parse(String(r.limits)),
      active: Boolean(r.active),
      sortOrder: Number(r.sortOrder),
      updatedAt: String(r.updatedAt),
    }));
  }

  async findPlanById(id: PlanId): Promise<PlanRecord | null> {
    const all = await this.listPlans();
    return all.find((p) => p.id === id) ?? null;
  }

  async upsertPlan(plan: PlanRecord): Promise<void> {
    if (this.mongo) {
      await this.mongo.collection('plans').updateOne({ id: plan.id }, { $set: plan }, { upsert: true });
      return;
    }
    this.sqlite!.prepare(`
      INSERT INTO plans (id, name, tagline, monthlyPriceUsd, annualPriceUsd, limits, active, sortOrder, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,
        tagline=excluded.tagline,
        monthlyPriceUsd=excluded.monthlyPriceUsd,
        annualPriceUsd=excluded.annualPriceUsd,
        limits=excluded.limits,
        active=excluded.active,
        sortOrder=excluded.sortOrder,
        updatedAt=excluded.updatedAt
    `).run(
      plan.id,
      plan.name,
      plan.tagline,
      plan.monthlyPriceUsd,
      plan.annualPriceUsd,
      JSON.stringify(plan.limits),
      plan.active ? 1 : 0,
      plan.sortOrder,
      plan.updatedAt
    );
  }

  // ---- SUBSCRIPTIONS ----
  async getSubscriptionByUserId(userId: string): Promise<SubscriptionRecord | null> {
    if (this.mongo) {
      const doc = await this.mongo.collection('subscriptions').findOne({ userId });
      return doc ? (doc as unknown as SubscriptionRecord) : null;
    }
    const row = this.sqlite!.prepare(`SELECT * FROM subscriptions WHERE userId = ?`).get(userId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      userId: String(row.userId),
      planId: row.planId as PlanId,
      billingCycle: row.billingCycle as SubscriptionRecord['billingCycle'],
      status: row.status as SubscriptionRecord['status'],
      currentPeriodStart: String(row.currentPeriodStart),
      currentPeriodEnd: String(row.currentPeriodEnd),
      autoRenew: Boolean(row.autoRenew),
      paystackCustomerCode: row.paystackCustomerCode ? String(row.paystackCustomerCode) : undefined,
      paystackSubscriptionCode: row.paystackSubscriptionCode ? String(row.paystackSubscriptionCode) : undefined,
      updatedAt: String(row.updatedAt),
    };
  }

  async upsertSubscription(sub: SubscriptionRecord): Promise<void> {
    if (this.mongo) {
      await this.mongo.collection('subscriptions').updateOne({ userId: sub.userId }, { $set: sub }, { upsert: true });
      return;
    }
    this.sqlite!.prepare(`
      INSERT INTO subscriptions (id, userId, planId, billingCycle, status, currentPeriodStart, currentPeriodEnd, autoRenew, paystackCustomerCode, paystackSubscriptionCode, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(userId) DO UPDATE SET
        planId=excluded.planId,
        billingCycle=excluded.billingCycle,
        status=excluded.status,
        currentPeriodStart=excluded.currentPeriodStart,
        currentPeriodEnd=excluded.currentPeriodEnd,
        autoRenew=excluded.autoRenew,
        paystackCustomerCode=excluded.paystackCustomerCode,
        paystackSubscriptionCode=excluded.paystackSubscriptionCode,
        updatedAt=excluded.updatedAt
    `).run(
      sub.id,
      sub.userId,
      sub.planId,
      sub.billingCycle,
      sub.status,
      sub.currentPeriodStart,
      sub.currentPeriodEnd,
      sub.autoRenew ? 1 : 0,
      sub.paystackCustomerCode ?? null,
      sub.paystackSubscriptionCode ?? null,
      sub.updatedAt
    );
  }

  async listSubscriptions(): Promise<SubscriptionRecord[]> {
    if (this.mongo) {
      const docs = await this.mongo.collection('subscriptions').find({}).toArray();
      return docs as unknown as SubscriptionRecord[];
    }
    const rows = this.sqlite!.prepare(`SELECT * FROM subscriptions`).all() as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row.id),
      userId: String(row.userId),
      planId: row.planId as PlanId,
      billingCycle: row.billingCycle as SubscriptionRecord['billingCycle'],
      status: row.status as SubscriptionRecord['status'],
      currentPeriodStart: String(row.currentPeriodStart),
      currentPeriodEnd: String(row.currentPeriodEnd),
      autoRenew: Boolean(row.autoRenew),
      updatedAt: String(row.updatedAt),
    }));
  }

  // ---- USAGE & ATOMIC QUOTA ----
  async getOrCreateUsage(userId: string, periodKey = currentPeriodKey()): Promise<UsageRecord> {
    const now = new Date().toISOString();
    if (this.mongo) {
      const existing = await this.mongo.collection('usage_records').findOne({ userId, periodKey });
      if (existing) return existing as unknown as UsageRecord;
      const fresh: UsageRecord = {
        id: crypto.randomUUID(),
        userId,
        periodKey,
        exportsCount: 0,
        recordingsCount: 0,
        failedExportsCount: 0,
        updatedAt: now,
      };
      await this.mongo.collection('usage_records').insertOne({ ...fresh });
      return fresh;
    }

    const row = this.sqlite!.prepare(`SELECT * FROM usage_records WHERE userId = ? AND periodKey = ?`).get(userId, periodKey) as Record<string, unknown> | undefined;
    if (row) {
      return {
        id: String(row.id),
        userId: String(row.userId),
        periodKey: String(row.periodKey),
        exportsCount: Number(row.exportsCount),
        recordingsCount: Number(row.recordingsCount),
        failedExportsCount: Number(row.failedExportsCount),
        lastExportAt: row.lastExportAt ? String(row.lastExportAt) : undefined,
        updatedAt: String(row.updatedAt),
      };
    }

    const fresh: UsageRecord = {
      id: crypto.randomUUID(),
      userId,
      periodKey,
      exportsCount: 0,
      recordingsCount: 0,
      failedExportsCount: 0,
      updatedAt: now,
    };
    this.sqlite!.prepare(`
      INSERT INTO usage_records (id, userId, periodKey, exportsCount, recordingsCount, failedExportsCount, updatedAt)
      VALUES (?, ?, ?, 0, 0, 0, ?)
    `).run(fresh.id, fresh.userId, fresh.periodKey, now);
    return fresh;
  }

  async atomicConsumeExportQuota(userId: string, maxExportsPerMonth: number): Promise<{ allowed: boolean; usage: UsageRecord }> {
    const periodKey = currentPeriodKey();
    const now = new Date().toISOString();
    await this.getOrCreateUsage(userId, periodKey);

    if (this.mongo) {
      const updated = await this.mongo.collection('usage_records').findOneAndUpdate(
        { userId, periodKey, exportsCount: { $lt: maxExportsPerMonth } },
        { $inc: { exportsCount: 1 }, $set: { lastExportAt: now, updatedAt: now } },
        { returnDocument: 'after' }
      );
      if (!updated) {
        const current = await this.getOrCreateUsage(userId, periodKey);
        return { allowed: false, usage: current };
      }
      return { allowed: true, usage: updated as unknown as UsageRecord };
    }

    const result = this.sqlite!.prepare(`
      UPDATE usage_records
      SET exportsCount = exportsCount + 1, lastExportAt = ?, updatedAt = ?
      WHERE userId = ? AND periodKey = ? AND exportsCount < ?
    `).run(now, now, userId, periodKey, maxExportsPerMonth);

    const usage = await this.getOrCreateUsage(userId, periodKey);
    return { allowed: result.changes > 0, usage };
  }

  async refundExportQuota(userId: string, periodKey = currentPeriodKey()): Promise<void> {
    const now = new Date().toISOString();
    if (this.mongo) {
      await this.mongo.collection('usage_records').updateOne(
        { userId, periodKey, exportsCount: { $gt: 0 } },
        { $inc: { exportsCount: -1, failedExportsCount: 1 }, $set: { updatedAt: now } }
      );
      return;
    }
    this.sqlite!.prepare(`
      UPDATE usage_records
      SET exportsCount = CASE WHEN exportsCount > 0 THEN exportsCount - 1 ELSE 0 END,
          failedExportsCount = failedExportsCount + 1,
          updatedAt = ?
      WHERE userId = ? AND periodKey = ?
    `).run(now, userId, periodKey);
  }

  async incrementRecordingCount(userId: string): Promise<void> {
    const periodKey = currentPeriodKey();
    const now = new Date().toISOString();
    await this.getOrCreateUsage(userId, periodKey);
    if (this.mongo) {
      await this.mongo.collection('usage_records').updateOne(
        { userId, periodKey },
        { $inc: { recordingsCount: 1 }, $set: { updatedAt: now } }
      );
      return;
    }
    this.sqlite!.prepare(`UPDATE usage_records SET recordingsCount = recordingsCount + 1, updatedAt = ? WHERE userId = ? AND periodKey = ?`).run(
      now,
      userId,
      periodKey
    );
  }

  async sumMonthlyExports(periodKey = currentPeriodKey()): Promise<number> {
    if (this.mongo) {
      const docs = await this.mongo.collection('usage_records').find({ periodKey }).toArray();
      return docs.reduce((acc, d) => acc + Number((d as unknown as UsageRecord).exportsCount || 0), 0);
    }
    const row = this.sqlite!.prepare(`SELECT COALESCE(SUM(exportsCount), 0) as total FROM usage_records WHERE periodKey = ?`).get(periodKey) as { total: number };
    return Number(row.total);
  }

  // ---- TEMPLATES ----
  async listTemplates(): Promise<StudioTemplate[]> {
    if (this.mongo) {
      const docs = await this.mongo.collection('studio_templates').find({}).sort({ sortOrder: 1 }).toArray();
      return docs as unknown as StudioTemplate[];
    }
    const rows = this.sqlite!.prepare(`SELECT * FROM studio_templates ORDER BY sortOrder ASC`).all() as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      category: r.category as StudioTemplate['category'],
      description: String(r.description),
      thumbnailUrl: String(r.thumbnailUrl),
      backgroundUrl: String(r.backgroundUrl),
      studioType: r.studioType as StudioTemplate['studioType'],
      foregroundMaskConfig: JSON.parse(String(r.foregroundMaskConfig)),
      defaultSubjectConfig: JSON.parse(String(r.defaultSubjectConfig)),
      defaultBrandingConfig: JSON.parse(String(r.defaultBrandingConfig)),
      recommendedFraming: r.recommendedFraming as StudioTemplate['recommendedFraming'],
      lightingPreset: r.lightingPreset as StudioTemplate['lightingPreset'],
      supportedAspectRatios: JSON.parse(String(r.supportedAspectRatios)),
      requiredPlan: r.requiredPlan as PlanId,
      isAvailable: Boolean(r.isAvailable),
      availabilityNote: r.availabilityNote ? String(r.availabilityNote) : undefined,
      sortOrder: Number(r.sortOrder),
      createdAt: String(r.createdAt),
    }));
  }

  async upsertTemplate(tpl: StudioTemplate): Promise<void> {
    if (this.mongo) {
      await this.mongo.collection('studio_templates').updateOne({ id: tpl.id }, { $set: tpl }, { upsert: true });
      return;
    }
    this.sqlite!.prepare(`
      INSERT INTO studio_templates (id, name, category, description, thumbnailUrl, backgroundUrl, studioType, foregroundMaskConfig, defaultSubjectConfig, defaultBrandingConfig, recommendedFraming, lightingPreset, supportedAspectRatios, requiredPlan, isAvailable, availabilityNote, sortOrder, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,
        category=excluded.category,
        description=excluded.description,
        thumbnailUrl=excluded.thumbnailUrl,
        backgroundUrl=excluded.backgroundUrl,
        studioType=excluded.studioType,
        foregroundMaskConfig=excluded.foregroundMaskConfig,
        defaultSubjectConfig=excluded.defaultSubjectConfig,
        defaultBrandingConfig=excluded.defaultBrandingConfig,
        recommendedFraming=excluded.recommendedFraming,
        lightingPreset=excluded.lightingPreset,
        supportedAspectRatios=excluded.supportedAspectRatios,
        requiredPlan=excluded.requiredPlan,
        isAvailable=excluded.isAvailable,
        availabilityNote=excluded.availabilityNote,
        sortOrder=excluded.sortOrder
    `).run(
      tpl.id,
      tpl.name,
      tpl.category,
      tpl.description,
      tpl.thumbnailUrl,
      tpl.backgroundUrl,
      tpl.studioType,
      JSON.stringify(tpl.foregroundMaskConfig),
      JSON.stringify(tpl.defaultSubjectConfig),
      JSON.stringify(tpl.defaultBrandingConfig),
      tpl.recommendedFraming,
      tpl.lightingPreset,
      JSON.stringify(tpl.supportedAspectRatios),
      tpl.requiredPlan,
      tpl.isAvailable ? 1 : 0,
      tpl.availabilityNote ?? null,
      tpl.sortOrder,
      tpl.createdAt
    );
  }

  async deleteTemplate(id: string): Promise<void> {
    if (this.mongo) {
      await this.mongo.collection('studio_templates').deleteOne({ id });
      return;
    }
    this.sqlite!.prepare(`DELETE FROM studio_templates WHERE id = ?`).run(id);
  }

  // ---- CUSTOM STUDIOS ----
  async listStudiosByUser(userId: string): Promise<CustomStudio[]> {
    if (this.mongo) {
      const docs = await this.mongo.collection('studios').find({ userId }).sort({ updatedAt: -1 }).toArray();
      return docs as unknown as CustomStudio[];
    }
    const rows = this.sqlite!.prepare(`SELECT * FROM studios WHERE userId = ? ORDER BY updatedAt DESC`).all(userId) as Record<string, unknown>[];
    return rows.map((r) => this.mapSqliteStudio(r));
  }

  async findStudioById(id: string): Promise<CustomStudio | null> {
    if (this.mongo) {
      const doc = await this.mongo.collection('studios').findOne({ id });
      return doc ? (doc as unknown as CustomStudio) : null;
    }
    const row = this.sqlite!.prepare(`SELECT * FROM studios WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? this.mapSqliteStudio(row) : null;
  }

  private mapSqliteStudio(r: Record<string, unknown>): CustomStudio {
    return {
      id: String(r.id),
      userId: String(r.userId),
      name: String(r.name),
      category: r.category as CustomStudio['category'],
      studioType: r.studioType as CustomStudio['studioType'],
      templateId: r.templateId ? String(r.templateId) : undefined,
      backgroundUrl: String(r.backgroundUrl),
      foregroundMaskConfig: JSON.parse(String(r.foregroundMaskConfig)),
      subjectConfig: JSON.parse(String(r.subjectConfig)),
      brandingConfig: JSON.parse(String(r.brandingConfig)),
      cameraFraming: r.cameraFraming as CustomStudio['cameraFraming'],
      lightingPreset: r.lightingPreset as CustomStudio['lightingPreset'],
      supportedAspectRatios: JSON.parse(String(r.supportedAspectRatios)),
      obsShareEnabled: Boolean(r.obsShareEnabled),
      obsShareToken: r.obsShareToken ? String(r.obsShareToken) : undefined,
      createdAt: String(r.createdAt),
      updatedAt: String(r.updatedAt),
    };
  }

  async countStudiosByUser(userId: string): Promise<number> {
    if (this.mongo) {
      return this.mongo.collection('studios').countDocuments({ userId });
    }
    const row = this.sqlite!.prepare(`SELECT COUNT(*) as cnt FROM studios WHERE userId = ?`).get(userId) as { cnt: number };
    return Number(row.cnt);
  }

  async saveStudio(studio: CustomStudio): Promise<void> {
    if (this.mongo) {
      await this.mongo.collection('studios').updateOne({ id: studio.id }, { $set: studio }, { upsert: true });
      return;
    }
    this.sqlite!.prepare(`
      INSERT INTO studios (id, userId, name, category, studioType, templateId, backgroundUrl, foregroundMaskConfig, subjectConfig, brandingConfig, cameraFraming, lightingPreset, supportedAspectRatios, obsShareEnabled, obsShareToken, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,
        category=excluded.category,
        studioType=excluded.studioType,
        templateId=excluded.templateId,
        backgroundUrl=excluded.backgroundUrl,
        foregroundMaskConfig=excluded.foregroundMaskConfig,
        subjectConfig=excluded.subjectConfig,
        brandingConfig=excluded.brandingConfig,
        cameraFraming=excluded.cameraFraming,
        lightingPreset=excluded.lightingPreset,
        supportedAspectRatios=excluded.supportedAspectRatios,
        obsShareEnabled=excluded.obsShareEnabled,
        obsShareToken=excluded.obsShareToken,
        updatedAt=excluded.updatedAt
    `).run(
      studio.id,
      studio.userId,
      studio.name,
      studio.category,
      studio.studioType,
      studio.templateId ?? null,
      studio.backgroundUrl,
      JSON.stringify(studio.foregroundMaskConfig),
      JSON.stringify(studio.subjectConfig),
      JSON.stringify(studio.brandingConfig),
      studio.cameraFraming,
      studio.lightingPreset,
      JSON.stringify(studio.supportedAspectRatios),
      studio.obsShareEnabled ? 1 : 0,
      studio.obsShareToken ?? null,
      studio.createdAt,
      studio.updatedAt
    );
  }

  async deleteStudio(id: string, userId: string): Promise<boolean> {
    if (this.mongo) {
      const res = await this.mongo.collection('studios').deleteOne({ id, userId });
      return res.deletedCount > 0;
    }
    const res = this.sqlite!.prepare(`DELETE FROM studios WHERE id = ? AND userId = ?`).run(id, userId);
    return res.changes > 0;
  }

  // ---- PROJECTS ----
  async listProjectsByUser(userId: string): Promise<ProjectRecord[]> {
    if (this.mongo) {
      const docs = await this.mongo.collection('projects').find({ userId }).sort({ updatedAt: -1 }).toArray();
      return docs as unknown as ProjectRecord[];
    }
    const rows = this.sqlite!.prepare(`SELECT * FROM projects WHERE userId = ? ORDER BY updatedAt DESC`).all(userId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      userId: String(r.userId),
      title: String(r.title),
      type: r.type as ProjectRecord['type'],
      studioId: r.studioId ? String(r.studioId) : undefined,
      aspectRatio: r.aspectRatio as ProjectRecord['aspectRatio'],
      durationSeconds: Number(r.durationSeconds),
      storageNote: r.storageNote as ProjectRecord['storageNote'],
      settings: JSON.parse(String(r.settings)),
      createdAt: String(r.createdAt),
      updatedAt: String(r.updatedAt),
    }));
  }

  async saveProject(project: ProjectRecord): Promise<void> {
    if (this.mongo) {
      await this.mongo.collection('projects').updateOne({ id: project.id }, { $set: project }, { upsert: true });
      return;
    }
    this.sqlite!.prepare(`
      INSERT INTO projects (id, userId, title, type, studioId, aspectRatio, durationSeconds, storageNote, settings, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title,
        type=excluded.type,
        studioId=excluded.studioId,
        aspectRatio=excluded.aspectRatio,
        durationSeconds=excluded.durationSeconds,
        storageNote=excluded.storageNote,
        settings=excluded.settings,
        updatedAt=excluded.updatedAt
    `).run(
      project.id,
      project.userId,
      project.title,
      project.type,
      project.studioId ?? null,
      project.aspectRatio,
      project.durationSeconds,
      project.storageNote,
      JSON.stringify(project.settings),
      project.createdAt,
      project.updatedAt
    );
  }

  async deleteProject(id: string, userId: string): Promise<boolean> {
    if (this.mongo) {
      const res = await this.mongo.collection('projects').deleteOne({ id, userId });
      return res.deletedCount > 0;
    }
    const res = this.sqlite!.prepare(`DELETE FROM projects WHERE id = ? AND userId = ?`).run(id, userId);
    return res.changes > 0;
  }

  // ---- EXPORTS ----
  async listExportsByUser(userId: string): Promise<ExportRecord[]> {
    if (this.mongo) {
      const docs = await this.mongo.collection('exports').find({ userId }).sort({ createdAt: -1 }).toArray();
      return docs as unknown as ExportRecord[];
    }
    const rows = this.sqlite!.prepare(`SELECT * FROM exports WHERE userId = ? ORDER BY createdAt DESC`).all(userId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      userId: String(r.userId),
      projectId: r.projectId ? String(r.projectId) : undefined,
      studioId: r.studioId ? String(r.studioId) : undefined,
      title: String(r.title),
      resolution: r.resolution as ExportRecord['resolution'],
      aspectRatio: r.aspectRatio as ExportRecord['aspectRatio'],
      format: String(r.format),
      durationSeconds: Number(r.durationSeconds),
      watermarked: Boolean(r.watermarked),
      status: r.status as ExportRecord['status'],
      createdAt: String(r.createdAt),
    }));
  }

  async findExportById(id: string): Promise<ExportRecord | null> {
    if (this.mongo) {
      const doc = await this.mongo.collection('exports').findOne({ id });
      return doc ? (doc as unknown as ExportRecord) : null;
    }
    const row = this.sqlite!.prepare(`SELECT * FROM exports WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      userId: String(row.userId),
      projectId: row.projectId ? String(row.projectId) : undefined,
      studioId: row.studioId ? String(row.studioId) : undefined,
      title: String(row.title),
      resolution: row.resolution as ExportRecord['resolution'],
      aspectRatio: row.aspectRatio as ExportRecord['aspectRatio'],
      format: String(row.format),
      durationSeconds: Number(row.durationSeconds),
      watermarked: Boolean(row.watermarked),
      status: row.status as ExportRecord['status'],
      createdAt: String(row.createdAt),
    };
  }

  async saveExport(exp: ExportRecord): Promise<void> {
    if (this.mongo) {
      await this.mongo.collection('exports').updateOne({ id: exp.id }, { $set: exp }, { upsert: true });
      return;
    }
    this.sqlite!.prepare(`
      INSERT INTO exports (id, userId, projectId, studioId, title, resolution, aspectRatio, format, durationSeconds, watermarked, status, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status
    `).run(
      exp.id,
      exp.userId,
      exp.projectId ?? null,
      exp.studioId ?? null,
      exp.title,
      exp.resolution,
      exp.aspectRatio,
      exp.format,
      exp.durationSeconds,
      exp.watermarked ? 1 : 0,
      exp.status,
      exp.createdAt
    );
  }

  // ---- PAYMENTS ----
  async createPayment(payment: PaymentRecord): Promise<void> {
    if (this.mongo) {
      await this.mongo.collection('payments').insertOne({ ...payment });
      return;
    }
    this.sqlite!.prepare(`
      INSERT INTO payments (id, userId, planId, billingCycle, reference, amountUsd, currency, exchangeRate, amountMinor, status, provider, channel, gatewayResponse, couponCode, originalAmountUsd, discountUsd, verifiedAt, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      payment.id,
      payment.userId,
      payment.planId,
      payment.billingCycle,
      payment.reference,
      payment.amountUsd,
      payment.currency,
      payment.exchangeRate,
      payment.amountMinor,
      payment.status,
      payment.provider,
      payment.channel ?? null,
      payment.gatewayResponse ?? null,
      payment.couponCode ?? null,
      payment.originalAmountUsd ?? null,
      payment.discountUsd ?? null,
      payment.verifiedAt ?? null,
      payment.createdAt
    );
  }

  async findPaymentByReference(reference: string): Promise<PaymentRecord | null> {
    if (this.mongo) {
      const doc = await this.mongo.collection('payments').findOne({ reference });
      return doc ? (doc as unknown as PaymentRecord) : null;
    }
    const row = this.sqlite!.prepare(`SELECT * FROM payments WHERE reference = ?`).get(reference) as Record<string, unknown> | undefined;
    return row ? (row as unknown as PaymentRecord) : null;
  }

  async updatePaymentByReference(reference: string, patch: Partial<PaymentRecord>): Promise<void> {
    if (this.mongo) {
      await this.mongo.collection('payments').updateOne({ reference }, { $set: patch });
      return;
    }
    const current = await this.findPaymentByReference(reference);
    if (!current) return;
    const merged = { ...current, ...patch };
    this.sqlite!.prepare(`
      UPDATE payments SET status=?, channel=?, gatewayResponse=?, verifiedAt=? WHERE reference=?
    `).run(merged.status, merged.channel ?? null, merged.gatewayResponse ?? null, merged.verifiedAt ?? null, reference);
  }

  async listPaymentsByUser(userId: string): Promise<PaymentRecord[]> {
    if (this.mongo) {
      const docs = await this.mongo.collection('payments').find({ userId }).sort({ createdAt: -1 }).toArray();
      return docs as unknown as PaymentRecord[];
    }
    const rows = this.sqlite!.prepare(`SELECT * FROM payments WHERE userId = ? ORDER BY createdAt DESC`).all(userId) as Record<string, unknown>[];
    return rows as unknown as PaymentRecord[];
  }

  async listAllPayments(): Promise<PaymentRecord[]> {
    if (this.mongo) {
      const docs = await this.mongo.collection('payments').find({}).sort({ createdAt: -1 }).toArray();
      return docs as unknown as PaymentRecord[];
    }
    const rows = this.sqlite!.prepare(`SELECT * FROM payments ORDER BY createdAt DESC`).all() as Record<string, unknown>[];
    return rows as unknown as PaymentRecord[];
  }

  // ---- COUPONS ----
  private mapSqliteCoupon(row: Record<string, unknown>): CouponRecord {
    return {
      id: String(row.id),
      code: String(row.code),
      description: String(row.description),
      discountType: row.discountType === 'fixed_usd' ? 'fixed_usd' : 'percent',
      discountValue: Number(row.discountValue),
      applicablePlans: JSON.parse(String(row.applicablePlans || '[]')) as PlanId[],
      maxRedemptions: row.maxRedemptions === null || row.maxRedemptions === undefined ? null : Number(row.maxRedemptions),
      redemptionsCount: Number(row.redemptionsCount || 0),
      expiresAt: row.expiresAt ? String(row.expiresAt) : null,
      active: Boolean(row.active),
      createdByEmail: String(row.createdByEmail),
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
    };
  }

  async listCoupons(): Promise<CouponRecord[]> {
    if (this.mongo) {
      const docs = await this.mongo.collection('coupons').find({}).sort({ createdAt: -1 }).toArray();
      return docs as unknown as CouponRecord[];
    }
    const rows = this.sqlite!.prepare(`SELECT * FROM coupons ORDER BY createdAt DESC`).all() as Record<string, unknown>[];
    return rows.map((r) => this.mapSqliteCoupon(r));
  }

  async findCouponByCode(code: string): Promise<CouponRecord | null> {
    const normalized = code.trim().toUpperCase();
    if (!normalized) return null;
    if (this.mongo) {
      const doc = await this.mongo.collection('coupons').findOne({ code: normalized });
      return doc ? (doc as unknown as CouponRecord) : null;
    }
    const row = this.sqlite!.prepare(`SELECT * FROM coupons WHERE code = ?`).get(normalized) as Record<string, unknown> | undefined;
    return row ? this.mapSqliteCoupon(row) : null;
  }

  async findCouponById(id: string): Promise<CouponRecord | null> {
    if (this.mongo) {
      const doc = await this.mongo.collection('coupons').findOne({ id });
      return doc ? (doc as unknown as CouponRecord) : null;
    }
    const row = this.sqlite!.prepare(`SELECT * FROM coupons WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? this.mapSqliteCoupon(row) : null;
  }

  async upsertCoupon(coupon: CouponRecord): Promise<void> {
    const normalized = { ...coupon, code: coupon.code.trim().toUpperCase() };
    if (this.mongo) {
      await this.mongo.collection('coupons').updateOne({ id: normalized.id }, { $set: normalized }, { upsert: true });
      return;
    }
    this.sqlite!.prepare(`
      INSERT INTO coupons (id, code, description, discountType, discountValue, applicablePlans, maxRedemptions, redemptionsCount, expiresAt, active, createdByEmail, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        code=excluded.code,
        description=excluded.description,
        discountType=excluded.discountType,
        discountValue=excluded.discountValue,
        applicablePlans=excluded.applicablePlans,
        maxRedemptions=excluded.maxRedemptions,
        redemptionsCount=excluded.redemptionsCount,
        expiresAt=excluded.expiresAt,
        active=excluded.active,
        updatedAt=excluded.updatedAt
    `).run(
      normalized.id,
      normalized.code,
      normalized.description,
      normalized.discountType,
      normalized.discountValue,
      JSON.stringify(normalized.applicablePlans),
      normalized.maxRedemptions,
      normalized.redemptionsCount,
      normalized.expiresAt,
      normalized.active ? 1 : 0,
      normalized.createdByEmail,
      normalized.createdAt,
      normalized.updatedAt
    );
  }

  async deleteCoupon(id: string): Promise<boolean> {
    if (this.mongo) {
      const res = await this.mongo.collection('coupons').deleteOne({ id });
      return res.deletedCount > 0;
    }
    const res = this.sqlite!.prepare(`DELETE FROM coupons WHERE id = ?`).run(id);
    return res.changes > 0;
  }

  async incrementCouponRedemption(code: string): Promise<void> {
    const normalized = code.trim().toUpperCase();
    const now = new Date().toISOString();
    if (this.mongo) {
      await this.mongo.collection('coupons').updateOne(
        { code: normalized },
        { $inc: { redemptionsCount: 1 }, $set: { updatedAt: now } }
      );
      return;
    }
    this.sqlite!.prepare(
      `UPDATE coupons SET redemptionsCount = redemptionsCount + 1, updatedAt = ? WHERE code = ?`
    ).run(now, normalized);
  }

  // ---- SUPPORT REQUESTS ----
  async createSupportRequest(reqItem: SupportRequest): Promise<void> {
    if (this.mongo) {
      await this.mongo.collection('support_requests').insertOne({ ...reqItem });
      return;
    }
    this.sqlite!.prepare(`
      INSERT INTO support_requests (id, userId, name, email, subject, category, message, priority, status, adminNotes, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      reqItem.id,
      reqItem.userId ?? null,
      reqItem.name,
      reqItem.email,
      reqItem.subject,
      reqItem.category,
      reqItem.message,
      reqItem.priority,
      reqItem.status,
      reqItem.adminNotes ?? null,
      reqItem.createdAt,
      reqItem.updatedAt
    );
  }

  async listSupportRequests(userId?: string): Promise<SupportRequest[]> {
    if (this.mongo) {
      const query = userId ? { userId } : {};
      const docs = await this.mongo.collection('support_requests').find(query).sort({ createdAt: -1 }).toArray();
      return docs as unknown as SupportRequest[];
    }
    const rows = userId
      ? (this.sqlite!.prepare(`SELECT * FROM support_requests WHERE userId = ? ORDER BY createdAt DESC`).all(userId) as Record<string, unknown>[])
      : (this.sqlite!.prepare(`SELECT * FROM support_requests ORDER BY createdAt DESC`).all() as Record<string, unknown>[]);
    return rows as unknown as SupportRequest[];
  }

  async updateSupportRequest(id: string, patch: Partial<SupportRequest>): Promise<void> {
    const updatedAt = new Date().toISOString();
    if (this.mongo) {
      await this.mongo.collection('support_requests').updateOne({ id }, { $set: { ...patch, updatedAt } });
      return;
    }
    const current = this.sqlite!.prepare(`SELECT * FROM support_requests WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!current) return;
    this.sqlite!.prepare(`UPDATE support_requests SET status=?, adminNotes=?, updatedAt=? WHERE id=?`).run(
      patch.status ?? String(current.status),
      patch.adminNotes !== undefined ? patch.adminNotes : (current.adminNotes ? String(current.adminNotes) : null),
      updatedAt,
      id
    );
  }

  // ---- AUDIT LOGS ----
  async insertAuditLog(entry: AuditLog): Promise<void> {
    if (this.mongo) {
      await this.mongo.collection('audit_logs').insertOne({ ...entry });
      return;
    }
    this.sqlite!.prepare(`
      INSERT INTO audit_logs (id, actorUserId, actorEmail, action, targetType, targetId, details, ip, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(entry.id, entry.actorUserId, entry.actorEmail, entry.action, entry.targetType, entry.targetId, JSON.stringify(entry.details), entry.ip, entry.createdAt);
  }

  async listAuditLogs(limit = 100): Promise<AuditLog[]> {
    if (this.mongo) {
      const docs = await this.mongo.collection('audit_logs').find({}).sort({ createdAt: -1 }).limit(limit).toArray();
      return docs as unknown as AuditLog[];
    }
    const rows = this.sqlite!.prepare(`SELECT * FROM audit_logs ORDER BY createdAt DESC LIMIT ?`).all(limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      actorUserId: String(r.actorUserId),
      actorEmail: String(r.actorEmail),
      action: String(r.action),
      targetType: String(r.targetType),
      targetId: String(r.targetId),
      details: JSON.parse(String(r.details)),
      ip: String(r.ip),
      createdAt: String(r.createdAt),
    }));
  }

  // ---- APP SETTINGS ----
  private async getAppSettingsRaw(): Promise<AppSettings | null> {
    if (this.mongo) {
      const doc = await this.mongo.collection('app_settings').findOne({ key: 'global' });
      return doc ? ((doc as unknown as { value: AppSettings }).value) : null;
    }
    const row = this.sqlite!.prepare(`SELECT value FROM app_settings WHERE key = 'global'`).get() as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as AppSettings) : null;
  }

  async getAppSettings(): Promise<AppSettings> {
    const saved = await this.getAppSettingsRaw();
    const base = saved ?? getDefaultAppSettings(this.engine);
    return {
      ...base,
      paystackConfigured: Boolean(process.env.PAYSTACK_SECRET_KEY && process.env.PAYSTACK_PUBLIC_KEY),
      databaseEngine: this.engine,
    };
  }

  async saveAppSettings(settings: AppSettings): Promise<void> {
    const now = new Date().toISOString();
    if (this.mongo) {
      await this.mongo.collection('app_settings').updateOne({ key: 'global' }, { $set: { key: 'global', value: settings, updatedAt: now } }, { upsert: true });
      return;
    }
    this.sqlite!.prepare(`
      INSERT INTO app_settings (key, value, updatedAt) VALUES ('global', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updatedAt=excluded.updatedAt
    `).run(JSON.stringify(settings), now);
  }

  // ---- UPLOADED ASSETS (Serverless MongoDB persistence + local disk fallback) ----
  async saveUploadedAsset(fileName: string, mimeType: string, data: Buffer): Promise<void> {
    if (this.mongo) {
      await this.mongo.collection('uploaded_assets').updateOne(
        { fileName },
        {
          $set: {
            fileName,
            mimeType,
            dataBase64: data.toString('base64'),
            createdAt: new Date().toISOString(),
          },
        },
        { upsert: true }
      );
      return;
    }
    ensureDataDirectories();
    fs.writeFileSync(path.join(UPLOAD_DIR, fileName), data);
  }

  async getUploadedAsset(fileName: string): Promise<{ mimeType: string; data: Buffer } | null> {
    if (this.mongo) {
      const doc = (await this.mongo.collection('uploaded_assets').findOne({ fileName })) as
        | { mimeType?: string; dataBase64?: string }
        | null;
      if (doc?.dataBase64 && doc.mimeType) {
        return { mimeType: doc.mimeType, data: Buffer.from(doc.dataBase64, 'base64') };
      }
    }
    const localPath = path.join(UPLOAD_DIR, fileName);
    if (fs.existsSync(localPath)) {
      const ext = path.extname(fileName).toLowerCase();
      const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      return { mimeType, data: fs.readFileSync(localPath) };
    }
    return null;
  }

  async close(): Promise<void> {
    if (this.sqlite) {
      this.sqlite.close();
      this.sqlite = null;
    }
    if (this.mongoClient) {
      await this.mongoClient.close();
      this.mongoClient = null;
      this.mongo = null;
    }
    this.initialized = false;
    this.initPromise = null;
  }
}

export const db = new NexaDatabase();
