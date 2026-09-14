import { createHash } from 'crypto';

import { daysBetween, isIsoDate } from '../common/dates';
import { decimalToMinor, normalizeCurrency } from '../common/money';
import { StatementMappingDto } from './dto/banking.dto';

export interface ParsedStatementRow {
  rowNo: number;
  transactionDate: string; // YYYY-MM-DD
  postedDate: string | null;
  description: string;
  merchant: string | null;
  amountMinor: number;
  direction: 'DEBIT' | 'CREDIT';
  currency: string;
  externalId: string | null;
  dedupeHash: string;
}

export interface ParseResult {
  validRows: ParsedStatementRow[];
  errors: Array<{ rowNo: number; error: string }>;
  dateMin: string | null;
  dateMax: string | null;
}

/**
 * Replaces PAN-like digit runs (13-19 digits, optionally separated by spaces or hyphens)
 * with a safe 4-digit mask. Never store raw card numbers in transaction descriptions or memos.
 */
export function maskSensitiveData(text: string): string {
  if (!text) return '';
  return text.replace(/\b(?:\d[ -]*?){13,19}\b/g, (match) => {
    const digits = match.replace(/\D/g, '');
    if (digits.length >= 13 && digits.length <= 19) {
      return `[CARD ...${digits.slice(-4)}]`;
    }
    return match;
  });
}

/**
 * Robust CSV line splitter supporting quoted fields, escaped quotes, and newlines.
 */
export function parseCsvRows(csvText: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  const normalized = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    const nextChar = normalized[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentField += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        currentRow.push(currentField.trim());
        currentField = '';
      } else if (char === '\n') {
        currentRow.push(currentField.trim());
        if (currentRow.some((f) => f.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
      } else {
        currentField += char;
      }
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((f) => f.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

export function parseDateWithFormat(dateStr: string, format: 'YYYY-MM-DD' | 'MM/DD/YYYY' | 'DD/MM/YYYY'): string | null {
  const clean = dateStr.trim();
  if (!clean) return null;

  if (format === 'YYYY-MM-DD') {
    if (isIsoDate(clean)) return clean;
  } else if (format === 'MM/DD/YYYY') {
    const parts = clean.split(/[/-]/);
    if (parts.length === 3) {
      const m = parts[0].padStart(2, '0');
      const d = parts[1].padStart(2, '0');
      const y = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
      const iso = `${y}-${m}-${d}`;
      if (isIsoDate(iso)) return iso;
    }
  } else if (format === 'DD/MM/YYYY') {
    const parts = clean.split(/[/-]/);
    if (parts.length === 3) {
      const d = parts[0].padStart(2, '0');
      const m = parts[1].padStart(2, '0');
      const y = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
      const iso = `${y}-${m}-${d}`;
      if (isIsoDate(iso)) return iso;
    }
  }

  // Fallback: try parsing with standard Date
  const parsed = new Date(clean);
  if (!Number.isNaN(parsed.getTime())) {
    const iso = parsed.toISOString().slice(0, 10);
    if (isIsoDate(iso)) return iso;
  }

  return null;
}

export function parseCsvStatement(
  csvContent: string,
  mapping: StatementMappingDto,
  defaultCurrency: string,
): ParseResult {
  const rows = parseCsvRows(csvContent);
  if (rows.length === 0) {
    return { validRows: [], errors: [{ rowNo: 1, error: 'CSV file is empty' }], dateMin: null, dateMax: null };
  }

  let headers: string[] = [];
  let dataRows = rows;

  if (mapping.hasHeader) {
    headers = rows[0].map((h) => h.toLowerCase().trim());
    dataRows = rows.slice(1);
  }

  const getColIdx = (colNameOrIdx: string | undefined): number => {
    if (!colNameOrIdx) return -1;
    const clean = colNameOrIdx.trim();
    if (/^\d+$/.test(clean)) {
      return parseInt(clean, 10);
    }
    if (headers.length > 0) {
      const idx = headers.indexOf(clean.toLowerCase());
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const dateIdx = getColIdx(mapping.dateColumn);
  const postedDateIdx = getColIdx(mapping.postedDateColumn);
  const descIdx = getColIdx(mapping.descriptionColumn);
  const merchantIdx = getColIdx(mapping.merchantColumn);
  const amountIdx = getColIdx(mapping.amountColumn);
  const debitIdx = getColIdx(mapping.debitColumn);
  const creditIdx = getColIdx(mapping.creditColumn);
  const extIdIdx = getColIdx(mapping.externalIdColumn);
  const currencyIdx = getColIdx(mapping.currencyColumn);

  if (dateIdx < 0) {
    return { validRows: [], errors: [{ rowNo: 1, error: `Date column "${mapping.dateColumn}" not found` }], dateMin: null, dateMax: null };
  }
  if (descIdx < 0) {
    return { validRows: [], errors: [{ rowNo: 1, error: `Description column "${mapping.descriptionColumn}" not found` }], dateMin: null, dateMax: null };
  }
  if (amountIdx < 0 && debitIdx < 0 && creditIdx < 0) {
    return { validRows: [], errors: [{ rowNo: 1, error: 'Either amount column or debit/credit columns must be specified' }], dateMin: null, dateMax: null };
  }

  const validRows: ParsedStatementRow[] = [];
  const errors: Array<{ rowNo: number; error: string }> = [];
  let dateMin: string | null = null;
  let dateMax: string | null = null;

  for (let i = 0; i < dataRows.length; i++) {
    const rowNo = mapping.hasHeader ? i + 2 : i + 1;
    const row = dataRows[i];

    const rawDate = row[dateIdx] ?? '';
    const transactionDate = parseDateWithFormat(rawDate, mapping.dateFormat);
    if (!transactionDate) {
      errors.push({ rowNo, error: `Invalid transaction date: "${rawDate}"` });
      continue;
    }

    let postedDate: string | null = null;
    if (postedDateIdx >= 0 && row[postedDateIdx]) {
      postedDate = parseDateWithFormat(row[postedDateIdx], mapping.dateFormat);
    }

    const rawDesc = row[descIdx] ?? '';
    if (!rawDesc.trim()) {
      errors.push({ rowNo, error: 'Empty description' });
      continue;
    }
    const description = maskSensitiveData(rawDesc.trim());

    const merchant = merchantIdx >= 0 && row[merchantIdx] ? maskSensitiveData(row[merchantIdx].trim()) : null;
    const externalId = extIdIdx >= 0 && row[extIdIdx] ? row[extIdIdx].trim() : null;

    let currency = defaultCurrency;
    if (currencyIdx >= 0 && row[currencyIdx]) {
      try {
        currency = normalizeCurrency(row[currencyIdx]);
      } catch {
        currency = defaultCurrency;
      }
    }

    let direction: 'DEBIT' | 'CREDIT' = 'DEBIT';
    let amountMinor = 0;

    try {
      if (debitIdx >= 0 || creditIdx >= 0) {
        const rawDebit = debitIdx >= 0 ? (row[debitIdx] ?? '').replace(/[$,\s]/g, '') : '';
        const rawCredit = creditIdx >= 0 ? (row[creditIdx] ?? '').replace(/[$,\s]/g, '') : '';

        const debitVal = rawDebit ? parseFloat(rawDebit) : 0;
        const creditVal = rawCredit ? parseFloat(rawCredit) : 0;

        if (debitVal > 0) {
          direction = 'DEBIT';
          amountMinor = decimalToMinor(debitVal.toFixed(2), currency);
        } else if (creditVal > 0) {
          direction = 'CREDIT';
          amountMinor = decimalToMinor(creditVal.toFixed(2), currency);
        } else {
          errors.push({ rowNo, error: 'Row has zero or empty debit and credit amounts' });
          continue;
        }
      } else if (amountIdx >= 0) {
        const rawAmt = (row[amountIdx] ?? '').replace(/[$,\s]/g, '');
        const amtVal = parseFloat(rawAmt);
        if (Number.isNaN(amtVal) || amtVal === 0) {
          errors.push({ rowNo, error: `Invalid or zero amount: "${row[amountIdx]}"` });
          continue;
        }

        const isNegDebit = mapping.amountSign !== 'POSITIVE_IS_DEBIT';
        if (amtVal < 0) {
          direction = isNegDebit ? 'DEBIT' : 'CREDIT';
          amountMinor = decimalToMinor(Math.abs(amtVal).toFixed(2), currency);
        } else {
          direction = isNegDebit ? 'CREDIT' : 'DEBIT';
          amountMinor = decimalToMinor(amtVal.toFixed(2), currency);
        }
      }
    } catch (err) {
      errors.push({ rowNo, error: `Amount calculation error: ${err instanceof Error ? err.message : String(err)}` });
      continue;
    }

    if (amountMinor <= 0) {
      errors.push({ rowNo, error: 'Amount must be greater than zero' });
      continue;
    }

    // Dedupe hash: SHA256(date|amountMinor|direction|description|externalId)
    const hashData = `${transactionDate}|${amountMinor}|${direction}|${description.toLowerCase()}|${externalId ?? ''}`;
    const dedupeHash = createHash('sha256').update(hashData).digest('hex');

    if (!dateMin || transactionDate < dateMin) dateMin = transactionDate;
    if (!dateMax || transactionDate > dateMax) dateMax = transactionDate;

    validRows.push({
      rowNo,
      transactionDate,
      postedDate,
      description,
      merchant,
      amountMinor,
      direction,
      currency,
      externalId,
      dedupeHash,
    });
  }

  return { validRows, errors, dateMin, dateMax };
}
