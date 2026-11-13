/**
 * Utility helpers for pt-PT formatting (currency, dates, labels).
 */

const CURRENCY_FORMATTER = new Intl.NumberFormat('pt-PT', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

/**
 * Formats integer cents to EUR currency string (e.g. 1250 -> "12,50 €").
 * @param {number} cents
 * @returns {string}
 */
export function formatCurrency(cents) {
  if (typeof cents !== 'number' || isNaN(cents)) return '0,00 €';
  return CURRENCY_FORMATTER.format(cents / 100);
}

/**
 * Converts a currency input string (e.g. "12,50", "12.50", "12") to integer cents.
 * Returns null if invalid or <= 0.
 * @param {string | number} value
 * @returns {number | null}
 */
export function parseCurrencyToCents(value) {
  if (typeof value === 'number') {
    return Math.round(value * 100);
  }
  if (!value || typeof value !== 'string') return null;
  // Replace comma with dot
  const clean = value.replace(/\s/g, '').replace('€', '').replace(',', '.');
  const num = parseFloat(clean);
  if (isNaN(num) || num <= 0) return null;
  return Math.round(num * 100);
}

/**
 * Formats a YYYY-MM-DD date string for display (DD/MM/YYYY).
 * Avoids native Date UTC shift.
 * @param {string} dateStr
 * @returns {string}
 */
export function formatDateDisplay(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

export const ACCOUNT_TYPE_LABELS = {
  checking: 'Conta à Ordem',
  savings: 'Conta Poupança',
  cash: 'Dinheiro / Carteira',
  investment: 'Investimento'
};

export const TRANSACTION_TYPE_LABELS = {
  expense: 'Despesa',
  income: 'Receita',
  transfer: 'Transferência'
};

export const BUDGET_GROUP_LABELS = {
  needs: 'Necessidades (50%)',
  wants: 'Desejos (30%)',
  savings: 'Poupança (20%)'
};
