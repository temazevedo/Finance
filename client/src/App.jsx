import { useQuery } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api } from './api/client.js';
import Navbar from './components/Navbar.jsx';
import AccountsPage from './pages/AccountsPage.jsx';
import CategoriesPage from './pages/CategoriesPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import OnboardingPage from './pages/OnboardingPage.jsx';
import RecurringPage from './pages/RecurringPage.jsx';
import TransactionsPage from './pages/TransactionsPage.jsx';
import UpcomingPage from './pages/UpcomingPage.jsx';

export default function App() {
  // Onboarding gate: while not completed, every route is redirected to /onboarding
  const { data: onboardingState, isLoading: onboardingLoading } = useQuery({
    queryKey: ['onboarding-state'],
    queryFn: api.getOnboardingState
  });

  if (onboardingLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-sm text-slate-500">
        A carregar…
      </div>
    );
  }

  const onboardingCompleted = Boolean(onboardingState?.completed);

  if (!onboardingCompleted) {
    return <OnboardingPage />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-800 antialiased font-sans">
      <Navbar />

      <main className="flex-1 max-w-5xl w-full mx-auto p-4 sm:p-6 md:p-8">
        <Routes>
          <Route path="/onboarding" element={<Navigate to="/" replace />} />
          <Route path="/" element={<DashboardPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/upcoming" element={<UpcomingPage />} />
          <Route path="/recurring" element={<RecurringPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
        </Routes>
      </main>
    </div>
  );
}
