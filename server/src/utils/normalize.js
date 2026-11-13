/**
 * Text normalization for import matching (AGENT.md section 14.3):
 * trim, collapse whitespace, lowercase, strip accents (NFD decomposition).
 * Used for exact-name comparison and import hashes — display names keep
 * their original spelling.
 */

const ACCENT_MAP = {
  á: 'a', à: 'a', â: 'a', ã: 'a', ä: 'a',
  é: 'e', è: 'e', ê: 'e', ë: 'e',
  í: 'i', ì: 'i', î: 'i', ï: 'i',
  ó: 'o', ò: 'o', ô: 'o', õ: 'o', ö: 'o',
  ú: 'u', ù: 'u', û: 'u', ü: 'u',
  ç: 'c', ñ: 'n'
};

/**
 * Normalizes a description for comparison/hashing.
 * @param {string} text
 * @returns {string}
 */
export function normalizeText(text) {
  if (typeof text !== 'string') return '';
  const lowered = text.toLowerCase();
  let out = '';
  for (const ch of lowered) {
    out += Object.prototype.hasOwnProperty.call(ACCENT_MAP, ch) ? ACCENT_MAP[ch] : ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}
