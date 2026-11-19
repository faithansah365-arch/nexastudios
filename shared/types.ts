export type UserRole = 'guest' | 'free' | 'creator' | 'pro_studio' | 'business' | 'admin';

export type PlanId = 'free' | 'creator' | 'pro_studio' | 'business';

export type BillingCycle = 'monthly' | 'annual' | 'none' | 'admin_preview';

export type AspectRatio = '16:9' | '9:16' | '1:1';

export type ExportResolution = '720p' | '1080p' | '4k';

export type StudioType = 'simple_background' | 'layered_2_5d' | 'true_3d';

export type StudioCategory =
  | 'Church Broadcasting Studios'
  | 'Television News Studios'
  | 'Podcast Studios'
  | 'Educational Studios'
  | 'Corporate Presentation Studios';

export type CameraFraming = 'wide' | 'medium' | 'closeup';

export type LightingPreset = 'neutral' | 'warm_studio' | 'cool_broadcast' | 'dramatic';

export interface PlanLimits {
  maxTemplates: number; // -1 means all available
  maxSavedStudios: number;
  maxRecordingMinutes: number;
  maxExportsPerMonth: number;
  maxExportResolution: ExportResolution;
  watermarkRequired: boolean;
  maxUploadMb: number;
  customBranding: boolean;
  teleprompter: boolean;
  obsWorkflow: boolean;
  teamMembers: number;
  prioritySupport: boolean;
  advancedBroadcast: boolean;
}

export interface PlanRecord {
  id: PlanId;
  name: string;
  tagline: string;
  monthlyPriceUsd: number;
  annualPriceUsd: number;
  limits: PlanLimits;
  active: boolean;
  sortOrder: number;
  updatedAt: string;
}

export interface SubjectConfig {
  scale: number; // 0.35 - 2.0
  offsetX: number; // -0.6 to 0.6 normalized
  offsetY: number; // -0.5 to 0.5 normalized
  colorTemp: number; // -50 to 50
  brightness: number; // 0.5 to 1.5
  contrast: number; // 0.5 to 1.5
  saturation: number; // 0 to 2.0
  bgBlur: number; // 0 to 24 px
  edgeSoftness: number; // 0 to 12 px
  edgeChoke?: number; // 0 to 1 (inward anti-halo trim)
  bodySensitivity?: number; // 0 to 1 (higher retains hands, arms & dark clothing)
  lightWrap?: number; // 0 to 0.85 (ambient background rim light wrap)
  shadowIntensity: number; // 0 to 1
  chromaKeyEnabled: boolean;
  chromaKeyColor: string;
  chromaSimilarity: number; // 0.05 to 0.6
  chromaSmoothness: number; // 0.01 to 0.3
}

export interface ForegroundMaskConfig {
  enabled: boolean;
  deskHeightRatio: number; // 0.15 to 0.55 from bottom
  deskStyle: 'none' | 'news_glass' | 'church_pulpit' | 'podcast_oak' | 'minimal_slate' | 'custom_mask';
  customMaskUrl?: string;
  perspectiveTilt: number; // -15 to 15 deg
  deskOpacity: number; // 0.5 to 1
}

export interface BrandingConfig {
  logoUrl?: string;
  logoPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  primaryColor: string;
  secondaryColor: string;
  screenText: string;
  showScreenGraphic: boolean;
  lowerThirdTitle: string;
  lowerThirdSubtitle: string;
  showLowerThird: boolean;
  teleprompterText?: string;
}

export interface StudioTemplate {
  id: string;
  name: string;
  category: StudioCategory;
  description: string;
  thumbnailUrl: string;
  backgroundUrl: string;
  studioType: StudioType;
  foregroundMaskConfig: ForegroundMaskConfig;
  defaultSubjectConfig: SubjectConfig;
  defaultBrandingConfig: BrandingConfig;
  recommendedFraming: CameraFraming;
  lightingPreset: LightingPreset;
  supportedAspectRatios: AspectRatio[];
  requiredPlan: PlanId;
  isAvailable: boolean;
  availabilityNote?: string;
  sortOrder: number;
  createdAt: string;
}

export interface CustomStudio {
  id: string;
  userId: string;
  name: string;
  category: StudioCategory;
  studioType: StudioType;
  templateId?: string;
  backgroundUrl: string;
  foregroundMaskConfig: ForegroundMaskConfig;
  subjectConfig: SubjectConfig;
  brandingConfig: BrandingConfig;
  cameraFraming: CameraFraming;
  lightingPreset: LightingPreset;
  supportedAspectRatios: AspectRatio[];
  obsShareEnabled?: boolean;
  obsShareToken?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRecord {
  id: string;
  userId: string;
  title: string;
  type: 'live_recording' | 'video_transform' | 'broadcast_prep';
  studioId?: string;
  aspectRatio: AspectRatio;
  durationSeconds: number;
  storageNote: 'local_browser' | 'metadata_only';
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ExportRecord {
  id: string;
  userId: string;
  projectId?: string;
  studioId?: string;
  title: string;
  resolution: ExportResolution;
  aspectRatio: AspectRatio;
  format: string;
  durationSeconds: number;
  watermarked: boolean;
  status: 'authorized' | 'completed' | 'failed';
  createdAt: string;
}

export interface SubscriptionRecord {
  id: string;
  userId: string;
  planId: PlanId;
  billingCycle: BillingCycle;
  status: 'active' | 'expired' | 'cancelled' | 'past_due';
  currentPeriodStart: string;
  currentPeriodEnd: string;
  autoRenew: boolean;
  paystackCustomerCode?: string;
  paystackSubscriptionCode?: string;
  updatedAt: string;
}

export interface PaymentRecord {
  id: string;
  userId: string;
  planId: PlanId;
  billingCycle: BillingCycle;
  reference: string;
  amountUsd: number;
  currency: string;
  exchangeRate: number;
  amountMinor: number;
  status: 'pending' | 'success' | 'failed' | 'abandoned';
  provider: 'paystack';
  channel?: string;
  gatewayResponse?: string;
  couponCode?: string;
  originalAmountUsd?: number;
  discountUsd?: number;
  verifiedAt?: string;
  createdAt: string;
}

export interface CouponRecord {
  id: string;
  code: string;
  description: string;
  discountType: 'percent' | 'fixed_usd';
  discountValue: number;
  applicablePlans: PlanId[];
  maxRedemptions: number | null;
  redemptionsCount: number;
  expiresAt: string | null;
  active: boolean;
  createdByEmail: string;
  createdAt: string;
  updatedAt: string;
}

export interface UsageRecord {
  id: string;
  userId: string;
  periodKey: string;
  exportsCount: number;
  recordingsCount: number;
  failedExportsCount: number;
  lastExportAt?: string;
  updatedAt: string;
}

export interface SupportRequest {
  id: string;
  userId?: string;
  name: string;
  email: string;
  subject: string;
  category: string;
  message: string;
  priority: 'standard' | 'priority';
  status: 'open' | 'in_progress' | 'resolved';
  adminNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  actorUserId: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  details: Record<string, unknown>;
  ip: string;
  createdAt: string;
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: UserRole;
  status: 'active' | 'suspended';
  mfaEnabled: boolean;
  createdAt: string;
}

export interface AppSettings {
  paystackMode: 'test' | 'live';
  paystackConfigured: boolean;
  settlementCurrency: 'GHS' | 'USD';
  usdToGhsRate: number | null;
  exchangeRateSource: string;
  exchangeRateUpdatedAt: string | null;
  directStreamingEnabled: boolean;
  cloudStorageEnabled: boolean;
  autoCaptionsEnabled: boolean;
  maintenanceMode: boolean;
  databaseEngine: 'sqlite_local' | 'mongodb_atlas';
}

export interface AuthContextData {
  user: PublicUser | null;
  subscription: SubscriptionRecord | null;
  plan: PlanRecord | null;
  usage: UsageRecord | null;
  savedStudiosCount: number;
}
