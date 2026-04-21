import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { useState, useEffect, Suspense, lazy } from 'react';
import { supabase } from './lib/supabase';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/Layout';
import OfflineBanner from './components/OfflineBanner';
import { SkeletonTable } from './components/SkeletonComponents';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Customers = lazy(() => import('./pages/Customers'));
const Jobs = lazy(() => import('./pages/Jobs'));
const RoutesPage = lazy(() => import('./pages/Routes'));
const MyRoutes = lazy(() => import('./pages/MyRoutes'));
const RouteExecution = lazy(() => import('./pages/RouteExecution'));
const WorkerDashboard = lazy(() => import('./pages/WorkerDashboard'));
const Login = lazy(() => import('./pages/Login'));
const CustomerImportPage = lazy(() => import('./pages/CustomerImportPage'));
const ImportHistoryPage = lazy(() => import('./pages/ImportHistoryPage'));
const Invoices = lazy(() => import('./pages/Invoices'));
const RecurringInvoices = lazy(() => import('./pages/RecurringInvoices'));
const Quotes = lazy(() => import('./pages/Quotes'));
const QuoteBuilder = lazy(() => import('./pages/QuoteBuilder'));
const QuoteDetail = lazy(() => import('./pages/QuoteDetail'));
const Portal = lazy(() => import('./pages/Portal'));
const Expenses = lazy(() => import('./pages/Expenses'));
const Reports = lazy(() => import('./pages/Reports'));
const Settings = lazy(() => import('./pages/Settings'));
const Workers = lazy(() => import('./pages/Workers'));
const OnboardingWizard = lazy(() => import('./pages/OnboardingWizard'));
const InvitationAccept = lazy(() => import('./pages/InvitationAccept'));
const VATReturnReport = lazy(() => import('./pages/VATReturnReport'));
const AuditLog = lazy(() => import('./pages/AuditLog'));
const BankFeed = lazy(() => import('./pages/BankFeed'));
const RiskDashboard = lazy(() => import('./components/RiskDashboard'));
const NotFoundPage = lazy(() => import('./pages/NotFound'));
const QuickBooksCallback = lazy(() => import('./pages/QuickBooksCallback'));
const RoutePerformance = lazy(() => import('./pages/RoutePerformance'));
const WorkerPerformanceReport = lazy(() => import('./pages/WorkerPerformanceReport'));
const CashFlowForecast = lazy(() => import('./pages/CashFlowForecast'));
const SmartScheduling = lazy(() => import('./pages/SmartScheduling'));
const CustomerHealth = lazy(() => import('./pages/CustomerHealth'));
const CommunicationsCentre = lazy(() => import('./pages/CommunicationsCentre'));
const InviteUsers = lazy(() => import('./pages/InviteUsers'));
const BusinessInsights = lazy(() => import('./pages/BusinessInsights'));
const AnomalyManagement = lazy(() => import('./pages/AnomalyManagement'));
const Legal = lazy(() => import('./pages/Legal'));
const Privacy = lazy(() => import('./pages/Privacy'));

function PageLoading() {
  return (
    <div className="p-6">
      <SkeletonTable rows={8} columns={5} />
    </div>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingChecked, setOnboardingChecked] = useState(false);

  useEffect(() => {
    async function seedDemo() {
      try {
        const { seedDemoData } = await import('./lib/seedDemo')
        await seedDemoData()
      } catch (e) {
        console.log('Seed skipped')
      }
      setLoading(false)
    }
    seedDemo()
  }, [])

  useEffect(() => {
    async function checkOnboarding() {
      if (!user || user.is_worker || user.role === 'worker' || !onboardingChecked) return

      const { data: settings } = await supabase
        .from('company_settings')
        .select('onboarding_completed, onboarding_step')
        .limit(1)
        .single()

      if (settings && !settings.onboarding_completed) {
        setShowOnboarding(true)
      }
      setOnboardingChecked(true)
    }
    checkOnboarding()
  }, [user, onboardingChecked])

  const handleLogin = (userData) => {
    setUser(userData);
  };

  const handleLogout = () => {
    setUser(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <ErrorBoundary>
        <Login onLogin={handleLogin} />
      </ErrorBoundary>
    );
  }

  if (showOnboarding) {
    return (
      <ErrorBoundary>
        <OnboardingWizard
          user={user}
          onComplete={() => setShowOnboarding(false)}
        />
      </ErrorBoundary>
    );
  }

  if (user.is_worker) {
    return (
      <ErrorBoundary>
        <WorkerDashboard worker={user} onLogout={handleLogout} />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary user={user}>
      <OfflineBanner />
      <Router>
        <Layout user={user} onLogout={handleLogout}>
          <Suspense fallback={<PageLoading />}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/onboarding" element={<OnboardingWizard user={user} onComplete={() => setShowOnboarding(false)} />} />
              <Route path="/invitation/:token" element={<InvitationAccept />} />
              <Route path="/customers" element={<Customers />} />
              <Route path="/customers/import" element={<CustomerImportPage />} />
              <Route path="/customers/import/history" element={<ImportHistoryPage />} />
              <Route path="/quotes" element={<Quotes user={user} />} />
              <Route path="/quotes/new" element={<QuoteBuilder user={user} />} />
              <Route path="/quotes/:id" element={<QuoteDetail user={user} />} />
              <Route path="/quotes/:id/edit" element={<QuoteBuilder user={user} />} />
              <Route path="/jobs" element={<Jobs user={user} />} />
              <Route path="/routes" element={<RoutesPage user={user} />} />
              <Route path="/my-routes" element={<MyRoutes user={user} />} />
              <Route path="/my-routes/:routeId/execute" element={<RouteExecution />} />
              <Route path="/invoices" element={<Invoices user={user} />} />
              <Route path="/invoices/recurring" element={<RecurringInvoices user={user} />} />
              <Route path="/portal/:token" element={<Portal />} />
              <Route path="/expenses" element={<Expenses user={user} />} />
              <Route path="/reports" element={<Reports user={user} />} />
              <Route path="/reports/vat" element={<VATReturnReport user={user} />} />
              <Route path="/scheduling" element={<SmartScheduling user={user} />} />
              <Route path="/cashflow" element={<CashFlowForecast user={user} />} />
              <Route path="/communications" element={<CommunicationsCentre user={user} />} />
              <Route path="/legal" element={<Legal />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/customers/health" element={<CustomerHealth user={user} />} />
              <Route path="/workers" element={<Workers />} />
              <Route path="/settings" element={<Settings user={user} />} />
              <Route path="/invite" element={<InviteUsers user={user} onClose={() => navigate('/settings')} />} />
              <Route path="/settings/audit-log" element={<AuditLog />} />
              <Route path="/settings/quickbooks-callback" element={<QuickBooksCallback />} />
              <Route path="/accounting/bank-feed" element={<BankFeed />} />
<Route path="/reports/anomalies/dashboard" element={<RiskDashboard />} />
              <Route path="/reports/anomalies/invoices" element={<AnomalyManagement user={user} />} />
              <Route path="/routes/:id/performance" element={<RoutePerformance />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </Layout>
      </Router>
    </ErrorBoundary>
  );
}

export default App;
