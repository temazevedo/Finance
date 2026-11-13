import { normalizeText } from '../utils/normalize.js';

/**
 * Script CSV parser for bank statements (AGENT.md section 14.2).
 * Applies an import profile config deterministically: encoding, delimiter,
 * skipped rows, date/decimal formats, column mapping (signed amount or
 * debit/credit pair) and cleanup rules.
 */

/**
 * Decodes a Buffer with the configured encoding.
 * @param {Buffer} buffer
 * @param {'utf8'|'windows-1252'} encoding
 * @returns {string}
 */
export function decodeBuffer(buffer, encoding) {
  if (encoding === 'windows-1252') {
    return Buffer.from(buffer).toString('latin1');
  }
  return buffer.toString('utf8').replace(/^\uFEFF/, ''); // strip BOM
}

/**
 * Splits CSV text into rows of fields, honoring double-quoted fields
 * (with escaped "" quotes). Lines are split on \n after normalizing \r\n.
 * @param {string} text
 * @param {string} delimiter
 * @returns {string[][]}
 */
export function parseCsv(text, delimiter = ';') {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const rows = [];

  for (const line of lines) {
    if (line === '') continue; // skip blank lines entirely
    const fields = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        fields.push(field);
        field = '';
      } else {
        field += ch;
      }
    }
    fields.push(field);
    rows.push(fields);
  }

  return rows;
}

/**
 * Parses a bank amount string like "-1.234,56" or "1 234.56" into integer
 * cents (positive). Returns null when not parseable.
 * @param {string} raw
 * @param {{ decimal_separator: string, thousand_separator: string }} config
 * @returns {number | null} positive cents
 */
export function parseAmountToCents(raw, { decimal_separator, thousand_separator }) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  let s = String(raw).trim();
  const negative = /^\(.*\)$/.test(s) ? true : /^-/.test(s.replace(/^[+]/, ''));
  s = s.replace(/^[+-]/, '').replace(/^\((.*)\)$/, '$1');
  if (thousand_separator) s = s.split(thousand_separator).join('');
  if (decimal_separator !== '.') s = s.replace(decimal_separator, '.');
  const value = Number.parseFloat(s);
  if (Number.isNaN(value)) return null;
  const cents = Math.round(Math.abs(value) * 100);
  return negative ? -cents : cents;
}

/**
 * Parses a date string in the configured format to YYYY-MM-DD.
 * @param {string} raw
 * @param {string} dateFormat
 * @returns {string | null}
 */
export function parseDate(raw, dateFormat) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (dateFormat === 'YYYY-MM-DD') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    return s;
  }
  if (!m) return null;
  let [, day, month, year] = m;
  if (year.length === 2) year = `20${year}`;
  if (Number(month) < 1 || Number(month) > 12) return null;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/**
 * Applies the profile cleanup rules to a description.
 * @param {string} description
 * @param {Array} rules
 * @returns {string}
 */
export function applyCleanupRules(description, rules) {
  let out = description;
  for (const rule of rules || []) {
    switch (rule.type) {
      case 'strip_prefix':
        if (out.toLowerCase().startsWith(rule.value.toLowerCase())) {
          out = out.slice(rule.value.length);
        }
        break;
      case 'strip_suffix':
        if (out.toLowerCase().endsWith(rule.value.toLowerCase())) {
          out = out.slice(0, out.length - rule.value.length);
        }
        break;
      case 'replace':
        out = out.split(rule.value).join(rule.replacement);
        break;
      case 'trim':
        out = out.trim();
        break;
      default:
        break;
    }
  }
  return out;
}

/**
 * Parses a statement file into normalized rows (AGENT.md 14.2):
 * { date, amount_cents (positive), type ('income'|'expense'), description, normalized, raw }
 *
 * @param {Buffer} fileBuffer raw uploaded file
 * @param {object} config validated profile config
 * @returns {{ rows: Array, errors: Array<{ line: number, message: string }> }}
 */
export function parseStatement(fileBuffer, config) {
  const text = decodeBuffer(fileBuffer, config.encoding);
  const csvRows = parseCsv(text, config.delimiter);

  const dataRows = csvRows.slice(config.skip_rows);
  if (config.has_header_row && dataRows.length > 0) {
    dataRows.shift(); // drop the column-header row
  }

  const rows = [];
  const errors = [];

  for (let i = 0; i < dataRows.length; i++) {
    const fields = dataRows[i];
    const fileLine = config.skip_rows + i + 1;

    const dateRaw = fields[config.columns.date];
    const descriptionRaw = fields[config.columns.description];

    let signedCents = null;
    if (config.columns.amount !== undefined && config.columns.amount !== null) {
      signedCents = parseAmountToCents(fields[config.columns.amount], config);
    } else {
      const debit = config.columns.debit !== undefined && config.columns.debit !== null
        ? parseAmountToCents(fields[config.columns.debit], config)
        : null;
      const credit = config.columns.credit !== undefined && config.columns.credit !== null
        ? parseAmountToCents(fields[config.columns.credit], config)
        : null;
      if (debit !== null && credit !== null) {
        errors.push({ line: fileLine, message: 'Linha tem débito e crédito em simultâneo' });
        continue;
      }
      signedCents = debit !== null ? -debit : credit;
    }

    const date = parseDate(dateRaw ?? '', config.date_format);
    const description = applyCleanupRules(
      typeof descriptionRaw === 'string' ? descriptionRaw.trim() : '',
      config.cleanup_rules
    );

    if (!date) {
      errors.push({ line: fileLine, message: `Data inválida: "${dateRaw}"` });
      continue;
    }
    if (signedCents === null || !Number.isFinite(signedCents) || signedCents === 0) {
      errors.push({ line: fileLine, message: `Montante inválido: "${fields[config.columns.amount] ?? fields[config.columns.debit] ?? ''}"` });
      continue;
    }
    if (!description) {
      errors.push({ line: fileLine, message: 'Descrição vazia' });
      continue;
    }

    rows.push({
      date,
      amount_cents: Math.abs(signedCents),
      type: signedCents < 0 ? 'expense' : 'income',
      description,
      normalized: normalizeText(description),
      raw: fields
    });
  }

  return { rows, errors };
}
