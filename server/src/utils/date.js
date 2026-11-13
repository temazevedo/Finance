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
 * Adds months to a YYYY-MM-DD date with month-end clamping.
 * E.g., adding 1 month to 2026-01-31 results in 2026-02-28.
 * @param {string} dateStr
 * @param {number} monthsToAdd
 * @returns {string}
 */
export function addMonthsClamped(dateStr, monthsToAdd) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const targetTotalMonths = year * 12 + (month - 1) + monthsToAdd;
  const targetYear = Math.floor(targetTotalMonths / 12);
  const targetMonth = (targetTotalMonths % 12) + 1;
  const maxDays = getDaysInMonth(targetYear, targetMonth);
  const clampedDay = Math.min(day, maxDays);
  return formatYMD(targetYear, targetMonth, clampedDay);
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
