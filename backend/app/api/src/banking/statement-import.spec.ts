import {
  maskSensitiveData,
  parseCsvRows,
  parseCsvStatement,
  parseDateWithFormat,
} from './statement-import';
import { StatementMappingDto } from './dto/banking.dto';

describe('Banking Statement Import & PAN Sanitization', () => {
  describe('maskSensitiveData', () => {
    it('should mask 16-digit PAN numbers into [CARD ...XXXX]', () => {
      const raw = 'Payment received for card 4532123456789012 via POS';
      const masked = maskSensitiveData(raw);
      expect(masked).toBe('Payment received for card [CARD ...9012] via POS');
    });

    it('should mask space-separated card numbers', () => {
      const raw = 'PURCHASE AT HOME DEPOT 5412 7512 3412 3456 REF 9981';
      const masked = maskSensitiveData(raw);
      expect(masked).toBe('PURCHASE AT HOME DEPOT [CARD ...3456] REF 9981');
    });

    it('should mask hyphen-separated card numbers', () => {
      const raw = 'SHELL OIL 4000-1234-5678-9999 TORONTO ON';
      const masked = maskSensitiveData(raw);
      expect(masked).toBe('SHELL OIL [CARD ...9999] TORONTO ON');
    });

    it('should not mask numbers with fewer than 13 digits', () => {
      const raw = 'Invoice #10492 Phone 416-555-0199 Ref 123456';
      const masked = maskSensitiveData(raw);
      expect(masked).toBe('Invoice #10492 Phone 416-555-0199 Ref 123456');
    });

    it('should handle empty or null string gracefully', () => {
      expect(maskSensitiveData('')).toBe('');
      expect(maskSensitiveData(null as any)).toBe('');
    });
  });

  describe('parseCsvRows', () => {
    it('should parse standard CSV lines', () => {
      const csv = 'Date,Description,Amount\n2026-03-01,Office Depot,-45.50\n2026-03-02,Client Payment,1200.00';
      const rows = parseCsvRows(csv);
      expect(rows).toEqual([
        ['Date', 'Description', 'Amount'],
        ['2026-03-01', 'Office Depot', '-45.50'],
        ['2026-03-02', 'Client Payment', '1200.00'],
      ]);
    });

    it('should handle quoted fields with commas and escaped quotes', () => {
      const csv = '"2026-03-01","Acme, Inc. - ""Supplies""",-150.00';
      const rows = parseCsvRows(csv);
      expect(rows.length).toBe(1);
      expect(rows[0][0]).toBe('2026-03-01');
      expect(rows[0][1]).toBe('Acme, Inc. - "Supplies"');
      expect(rows[0][2]).toBe('-150.00');
    });

    it('should handle Windows CRLF newlines and blank lines', () => {
      const csv = 'Header1,Header2\r\nValue1,Value2\r\n\r\nValue3,Value4\r\n';
      const rows = parseCsvRows(csv);
      expect(rows.length).toBe(3);
      expect(rows[0]).toEqual(['Header1', 'Header2']);
      expect(rows[1]).toEqual(['Value1', 'Value2']);
      expect(rows[2]).toEqual(['Value3', 'Value4']);
    });
  });

  describe('parseDateWithFormat', () => {
    it('should parse YYYY-MM-DD', () => {
      expect(parseDateWithFormat('2026-05-18', 'YYYY-MM-DD')).toBe('2026-05-18');
    });

    it('should parse MM/DD/YYYY', () => {
      expect(parseDateWithFormat('05/18/2026', 'MM/DD/YYYY')).toBe('2026-05-18');
    });

    it('should parse DD/MM/YYYY', () => {
      expect(parseDateWithFormat('18/05/2026', 'DD/MM/YYYY')).toBe('2026-05-18');
    });

    it('should return null on invalid date strings', () => {
      expect(parseDateWithFormat('not-a-date', 'YYYY-MM-DD')).toBeNull();
      expect(parseDateWithFormat('', 'YYYY-MM-DD')).toBeNull();
    });
  });

  describe('parseCsvStatement', () => {
    const mapping: StatementMappingDto = {
      hasHeader: true,
      dateColumn: 'Date',
      dateFormat: 'YYYY-MM-DD',
      descriptionColumn: 'Description',
      amountColumn: 'Amount',
    };

    it('should parse valid statement rows and mask card numbers in descriptions', () => {
      const csv = `Date,Description,Amount
2026-04-01,PAYMENT TO VENDOR 4111 2222 3333 4444,-500.00
2026-04-02,CUSTOMER DEPOSIT WIRE,1500.00`;

      const result = parseCsvStatement(csv, mapping, 'CAD');
      expect(result.errors).toHaveLength(0);
      expect(result.validRows).toHaveLength(2);

      const debitRow = result.validRows[0];
      expect(debitRow.direction).toBe('DEBIT');
      expect(debitRow.amountMinor).toBe(50000);
      expect(debitRow.description).toBe('PAYMENT TO VENDOR [CARD ...4444]');
      expect(debitRow.dedupeHash).toBeDefined();

      const creditRow = result.validRows[1];
      expect(creditRow.direction).toBe('CREDIT');
      expect(creditRow.amountMinor).toBe(150000);
      expect(creditRow.transactionDate).toBe('2026-04-02');
    });

    it('should parse separate debit and credit columns', () => {
      const splitMapping: StatementMappingDto = {
        hasHeader: true,
        dateColumn: 'Date',
        descriptionColumn: 'Description',
        debitColumn: 'Debit',
        creditColumn: 'Credit',
        dateFormat: 'YYYY-MM-DD',
      };

      const csv = `Date,Description,Debit,Credit
2026-04-10,Hydro Bill,125.50,
2026-04-11,Refund Received,,25.00`;

      const result = parseCsvStatement(csv, splitMapping, 'CAD');
      expect(result.errors).toHaveLength(0);
      expect(result.validRows).toHaveLength(2);
      expect(result.validRows[0].direction).toBe('DEBIT');
      expect(result.validRows[0].amountMinor).toBe(12550);
      expect(result.validRows[1].direction).toBe('CREDIT');
      expect(result.validRows[1].amountMinor).toBe(2500);
    });

    it('should catch invalid rows and report row numbers', () => {
      const csv = `Date,Description,Amount
INVALID-DATE,Invalid Row,10.00
2026-04-15,Zero Amount,0.00
2026-04-16,Good Row,50.00`;

      const result = parseCsvStatement(csv, mapping, 'CAD');
      expect(result.errors.length).toBe(2);
      expect(result.validRows.length).toBe(1);
      expect(result.validRows[0].amountMinor).toBe(5000);
    });
  });
});
