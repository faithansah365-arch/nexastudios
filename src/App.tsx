import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { PublicHome } from './pages/PublicHome';
import {
  AboutPage,
  ContactPage,
  FeaturesPage,
  HelpCenterPage,
  HowItWorksPage,
  LegalPage,
  UseCasesPage,
  VirtualStudiosPage,
} from './pages/PublicPages';
import { PricingPage } from './pages/PricingPage';
import { ForgotPasswordPage, ResetPasswordPage, SignInPage, SignUpPage } from './pages/AuthPages';
import { DashboardOverview } from './pages/DashboardOverview';
import { LiveStudioPage } from './pages/LiveStudioPage';
import { VideoTransformPage } from './pages/VideoTransformPage';
import { StudioGeneratorPage } from './pages/StudioGeneratorPage';
import { StudioDesignerPage } from './pages/StudioDesignerPage';
import { LiveBroadcastPage } from './pages/LiveBroadcastPage';
import { ObsCleanOutputPage } from './pages/ObsCleanOutputPage';
import {
  AccountSettingsPage,
  BillingHistoryPage,
  DashboardSupportPage,
  ExportsPage,
  MyProjectsPage,
  MyStudiosPage,
  SubscriptionPage,
} from './pages/DashboardCollections';
import { AdminDashboard } from './pages/AdminDashboard';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen bg-[#080B14] text-slate-300 flex items-center justify-center text-sm">
        Loading workspace...
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/signin" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public Marketing Website */}
          <Route path="/" element={<PublicHome />} />
          <Route path="/features" element={<FeaturesPage />} />
          <Route path="/virtual-studios" element={<VirtualStudiosPage />} />
          <Route path="/how-it-works" element={<HowItWorksPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/use-cases" element={<UseCasesPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/help" element={<HelpCenterPage />} />
          <Route path="/signin" element={<SignInPage />} />
          <Route path="/signup" element={<SignUpPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/legal/privacy" element={<LegalPage type="privacy" />} />
          <Route path="/legal/terms" element={<LegalPage type="terms" />} />
          <Route path="/legal/refund" element={<LegalPage type="refund" />} />

          {/* Clean Tokenized OBS Browser Source Output */}
          <Route path="/obs/:studioId" element={<ObsCleanOutputPage />} />

          {/* Protected Creator Dashboard */}
          <Route path="/dashboard" element={<ProtectedRoute><DashboardOverview /></ProtectedRoute>} />
          <Route path="/dashboard/live-studio" element={<ProtectedRoute><LiveStudioPage /></ProtectedRoute>} />
          <Route path="/dashboard/video-transform" element={<ProtectedRoute><VideoTransformPage /></ProtectedRoute>} />
          <Route path="/dashboard/studio-generator" element={<ProtectedRoute><StudioGeneratorPage /></ProtectedRoute>} />
          <Route path="/dashboard/studio-designer" element={<ProtectedRoute><StudioDesignerPage /></ProtectedRoute>} />
          <Route path="/dashboard/live-broadcast" element={<ProtectedRoute><LiveBroadcastPage /></ProtectedRoute>} />
          <Route path="/dashboard/projects" element={<ProtectedRoute><MyProjectsPage /></ProtectedRoute>} />
          <Route path="/dashboard/studios" element={<ProtectedRoute><MyStudiosPage /></ProtectedRoute>} />
          <Route path="/dashboard/exports" element={<ProtectedRoute><ExportsPage /></ProtectedRoute>} />
          <Route path="/dashboard/subscription" element={<ProtectedRoute><SubscriptionPage /></ProtectedRoute>} />
          <Route path="/dashboard/billing" element={<ProtectedRoute><BillingHistoryPage /></ProtectedRoute>} />
          <Route path="/dashboard/settings" element={<ProtectedRoute><AccountSettingsPage /></ProtectedRoute>} />
          <Route path="/dashboard/support" element={<ProtectedRoute><DashboardSupportPage /></ProtectedRoute>} />

          {/* Separate Protected Administrator Workspace (unlisted in public nav) */}
          <Route path="/admin" element={<AdminDashboard />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
