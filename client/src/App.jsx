import { Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import TransactionsPage from './pages/TransactionsPage.jsx';
import AccountsPage from './pages/AccountsPage.jsx';
import CategoriesPage from './pages/CategoriesPage.jsx';

export default function App() {
  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-800 antialiased font-sans">
      <Navbar />

      <main className="flex-1 max-w-5xl w-full mx-auto p-4 sm:p-6 md:p-8">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
        </Routes>
      </main>
    </div>
  );
}
