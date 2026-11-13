/**
 * API client for interacting with the backend.
 */

async function apiFetch(endpoint, options = {}) {
  const res = await fetch(`/api${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  });

  if (res.status === 204) {
    return null;
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const error = new Error(data?.error?.message || `Pedido falhou com código ${res.status}`);
    error.code = data?.error?.code || 'UNKNOWN_ERROR';
    error.details = data?.error?.details;
    error.status = res.status;
    throw error;
  }

  return data;
}

export const api = {
  // Accounts
  getAccounts: (includeArchived = false) => apiFetch(`/accounts?includeArchived=${includeArchived}`),
  getAccountBalances: (includeArchived = false) => apiFetch(`/accounts/balances?includeArchived=${includeArchived}`),
  createAccount: (data) => apiFetch('/accounts', { method: 'POST', body: JSON.stringify(data) }),
  updateAccount: (id, data) => apiFetch(`/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // Categories
  getCategories: (includeArchived = false) => apiFetch(`/categories?includeArchived=${includeArchived}`),
  getCategoryTree: (includeArchived = false) => apiFetch(`/categories/tree?includeArchived=${includeArchived}`),
  createCategory: (data) => apiFetch('/categories', { method: 'POST', body: JSON.stringify(data) }),
  updateCategory: (id, data) => apiFetch(`/categories/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // Transactions
  getTransactions: (params = {}) => {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== '') {
        searchParams.append(key, val);
      }
    });
    const qs = searchParams.toString();
    return apiFetch(`/transactions${qs ? `?${qs}` : ''}`);
  },
  getTransaction: (id) => apiFetch(`/transactions/${id}`),
  createTransaction: (data) => apiFetch('/transactions', { method: 'POST', body: JSON.stringify(data) }),
  updateTransaction: (id, data) => apiFetch(`/transactions/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteTransaction: (id) => apiFetch(`/transactions/${id}`, { method: 'DELETE' }),

  // Suggestions
  getNameSuggestions: (categoryId, q = '') =>
    apiFetch(`/suggestions/names?categoryId=${categoryId}&q=${encodeURIComponent(q)}`),

  // Recurring Items
  getRecurring: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/recurring${qs ? `?${qs}` : ''}`);
  },
  getRecurringItem: (id) => apiFetch(`/recurring/${id}`),
  createRecurring: (data) => apiFetch('/recurring', { method: 'POST', body: JSON.stringify(data) }),
  updateRecurring: (id, data) => apiFetch(`/recurring/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteRecurring: (id) => apiFetch(`/recurring/${id}`, { method: 'DELETE' }),
  getRecurringSummary: () => apiFetch('/recurring/summary'),

  // Onboarding
  getOnboardingState: () => apiFetch('/onboarding/state'),
  saveOnboardingStep: (step, data) =>
    apiFetch('/onboarding/step', {
      method: 'PUT',
      body: JSON.stringify(data !== undefined ? { step, data } : { step })
    }),
  completeOnboarding: (data) => apiFetch('/onboarding/complete', { method: 'POST', body: JSON.stringify(data) }),

  // Budgets
  getBudgets: (month) => apiFetch(`/budgets?month=${month}`),
  saveBudgets: (month, budgets) =>
    apiFetch(`/budgets?month=${month}`, { method: 'PUT', body: JSON.stringify({ budgets }) }),

  // Reports
  getBudgetVsActual: (month) => apiFetch(`/reports/budget-vs-actual?month=${month}`),
  getCashflow: (from, to) => apiFetch(`/reports/cashflow?from=${from}&to=${to}`),

  // Settings
  getSettings: () => apiFetch('/settings'),
  saveSettings: (data) => apiFetch('/settings', { method: 'PUT', body: JSON.stringify(data) }),

  // Health
  getHealth: () => apiFetch('/health')
};

/**
 * Triggers a browser download for a file endpoint (backup / CSV export).
 * @param {string} endpoint API path without prefix, e.g. '/settings/backup'
 * @param {string} filename client-side fallback name
 */
export async function downloadFile(endpoint, filename) {
  const res = await fetch(`/api${endpoint}`);
  if (!res.ok) {
    throw new Error(`Pedido falhou com código ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
