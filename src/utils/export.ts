/**
 * CSV building and hand-off.
 *
 * Web gets a real download; native gets the share sheet (Files, Mail, Drive —
 * whatever the phone offers). Both go through `exportCsv`.
 */

import { Platform } from 'react-native';

/**
 * Quote a cell for CSV. Excel and Sheets both need the doubled-quote escape,
 * and a leading `=`, `+`, `-` or `@` must be defused or the spreadsheet will
 * treat pasted data as a formula.
 */
function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(
  headers: string[],
  rows: (string | number | null | undefined)[][],
): string {
  const lines = [headers.map(cell).join(',')];
  for (const row of rows) lines.push(row.map(cell).join(','));
  // CRLF + BOM so Excel opens UTF-8 correctly on Windows.
  return `﻿${lines.join('\r\n')}\r\n`;
}

export interface ExportResult {
  ok: boolean;
  message: string;
}

export async function exportCsv(filename: string, csv: string): Promise<ExportResult> {
  if (Platform.OS === 'web') {
    try {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return { ok: true, message: `${filename} downloaded.` };
    } catch {
      return { ok: false, message: 'Your browser blocked the download.' };
    }
  }

  // Native: write to the cache directory, then hand it to the share sheet.
  try {
    const [{ File, Paths }, Sharing] = await Promise.all([
      import('expo-file-system'),
      import('expo-sharing'),
    ]);

    if (!(await Sharing.isAvailableAsync())) {
      return { ok: false, message: 'Sharing is not available on this device.' };
    }

    const file = new File(Paths.cache, filename);
    if (file.exists) file.delete();
    file.create();
    file.write(csv);

    await Sharing.shareAsync(file.uri, {
      mimeType: 'text/csv',
      dialogTitle: 'Export report',
      UTI: 'public.comma-separated-values-text',
    });
    return { ok: true, message: 'Report shared.' };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : 'Could not create the report file.',
    };
  }
}
