/**
 * Calendar-safe date utility functions (YYYY-MM-DD strings).
 * Avoids JavaScript native UTC date parsing off-by-one errors in WET/WEST timezones.
 */

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Checks if a string is a valid ISO date YYYY-MM-DD.
 * @param {string} dateStr
 * @returns {boolean}
 */
export function isValidDateString(dateStr) {
  if (typeof dateStr !== 'string' || !DATE_REGEX.test(dateStr)) {
    return false;
  }
  const [year, month, day] = dateStr.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const daysInMonth = getDaysInMonth(year, month);
  return day <= daysInMonth;
}

/**
 * Returns number of days in a given month of a year.
 * @param {number} year
 * @param {number} month (1-12)
 * @returns {number}
 */
export function getDaysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Formats year, month, day numbers to YYYY-MM-DD.
 * @param {number} year
 * @param {number} month (1-12)
 * @param {number} day (1-31)
 * @returns {string}
 */
export function formatYMD(year, month, day) {
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

/**
 * Returns today's date in local system time formatted as YYYY-MM-DD.
 * @returns {string}
 */
export function getTodayYMD() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  return formatYMD(year, month, day);
}

/**
 * Adds months to an anchor YYYY-MM-DD base with month-end clamping.
 * Preserves the original anchor day (e.g. 31st) across alternating short/long months.
 * @param {string} anchorDateStr
 * @param {number} monthsToAdd
 * @returns {string}
 */
export function addMonthsFromAnchor(anchorDateStr, monthsToAdd) {
  const [startYear, startMonth, anchorDay] = anchorDateStr.split('-').map(Number);
  const targetTotalMonths = startYear * 12 + (startMonth - 1) + monthsToAdd;
  const targetYear = Math.floor(targetTotalMonths / 12);
  const targetMonth = (targetTotalMonths % 12) + 1;
  const maxDaysInTarget = getDaysInMonth(targetYear, targetMonth);
  const clampedDay = Math.min(anchorDay, maxDaysInTarget);
  return formatYMD(targetYear, targetMonth, clampedDay);
}

/**
 * Calculates occurrences for a recurring item within a rolling horizon.
 * @param {string} startDate - Anchor date (YYYY-MM-DD)
 * @param {string} frequency - ('weekly'|'biweekly'|'monthly'|'bimonthly'|'quarterly'|'semiannual'|'annual')
 * @param {string | null} [endDate=null] - Optional cutoff date
 * @param {string} horizonEndDate - Horizon cutoff (e.g. today + 60 days)
 * @returns {string[]} Array of ISO dates (YYYY-MM-DD)
 */
export function getOccurrences(startDate, frequency, endDate, horizonEndDate) {
  const occurrences = [];
  const effectiveEnd = endDate && endDate < horizonEndDate ? endDate : horizonEndDate;

  let k = 0;
  while (true) {
    let date;
    switch (frequency) {
      case 'weekly':
        date = addDays(startDate, k * 7);
        break;
      case 'biweekly':
        date = addDays(startDate, k * 14);
        break;
      case 'monthly':
        date = addMonthsFromAnchor(startDate, k);
        break;
      case 'bimonthly':
        date = addMonthsFromAnchor(startDate, k * 2);
        break;
      case 'quarterly':
        date = addMonthsFromAnchor(startDate, k * 3);
        break;
      case 'semiannual':
        date = addMonthsFromAnchor(startDate, k * 6);
        break;
      case 'annual':
        date = addMonthsFromAnchor(startDate, k * 12);
        break;
      default:
        throw new Error(`Frequência desconhecida: ${frequency}`);
    }

    if (date > effectiveEnd) {
      break;
    }

    occurrences.push(date);
    k++;

    // Safety guard against infinite loops
    if (k > 1000) break;
  }

  return occurrences;
}

/**
 * Converts an amount in integer cents and a frequency to monthly-equivalent cents.
 * Following Section 6.2 spec table.
 * @param {number} amountCents
 * @param {string} frequency
 * @returns {number}
 */
export function getMonthlyEquivalentCents(amountCents, frequency) {
  switch (frequency) {
    case 'weekly':
      return Math.round((amountCents * 52) / 12);
    case 'biweekly':
      return Math.round((amountCents * 26) / 12);
    case 'monthly':
      return amountCents;
    case 'bimonthly':
      return Math.round(amountCents / 2);
    case 'quarterly':
      return Math.round(amountCents / 3);
    case 'semiannual':
      return Math.round(amountCents / 6);
    case 'annual':
      return Math.round(amountCents / 12);
    default:
      return amountCents;
  }
}

/**
 * Adds days to a YYYY-MM-DD date string safely.
 * @param {string} dateStr
 * @param {number} daysToAdd
 * @returns {string}
 */
export function addDays(dateStr, daysToAdd) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day + daysToAdd));
  return formatYMD(utcDate.getUTCFullYear(), utcDate.getUTCMonth() + 1, utcDate.getUTCDate());
}
