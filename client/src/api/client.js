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

  // Health
  getHealth: () => apiFetch('/health')
};
