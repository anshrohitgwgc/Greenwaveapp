import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { AccountingReportsService } from '../accounting/accounting-reports.service';
import { LedgerAccount } from '../accounting/entities/ledger-account.entity';
import { LedgerService } from '../accounting/ledger.service';
import { BankingService } from './banking.service';
import { BankReconciliation } from './entities/bank-reconciliation.entity';
import { FinancialAccount } from './entities/financial-account.entity';
import { FinancialTransaction } from './entities/financial-transaction.entity';
import { ImportBatch } from './entities/import-batch.entity';
import { ImportBatchRow } from './entities/import-batch-row.entity';
import { TransactionSplit } from './entities/transaction-split.entity';

describe('BankingService', () => {
  let service: BankingService;
  let accountsRepo: any;
  let transactionsRepo: any;
  let reconciliationsRepo: any;
  let reportsService: any;
  let ledgerService: any;

  beforeEach(async () => {
    accountsRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((dto) => ({ id: 'acc-1', ...dto })),
      save: jest.fn((entity) => Promise.resolve({ id: 'acc-1', ...entity })),
    };

    transactionsRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((dto) => dto),
      save: jest.fn((entity) => Promise.resolve(entity)),
      createQueryBuilder: jest.fn(),
    };

    reconciliationsRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn((entity) => Promise.resolve(entity)),
    };

    reportsService = {
      balances: jest.fn().mockResolvedValue(new Map()),
    };

    ledgerService = {
      postJournalEntry: jest.fn().mockResolvedValue({ id: 'je-1' }),
      getDefaultChartAccounts: jest.fn().mockResolvedValue([]),
    };

    const mockDataSource = {
      transaction: jest.fn((cb) => cb({
        getRepository: jest.fn((entity) => {
          if (entity === FinancialTransaction) return transactionsRepo;
          if (entity === TransactionSplit) return { save: jest.fn() };
          if (entity === BankReconciliation) return reconciliationsRepo;
          return {};
        }),
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BankingService,
        { provide: getRepositoryToken(FinancialAccount), useValue: accountsRepo },
        { provide: getRepositoryToken(FinancialTransaction), useValue: transactionsRepo },
        { provide: getRepositoryToken(ImportBatch), useValue: {} },
        { provide: getRepositoryToken(ImportBatchRow), useValue: {} },
        { provide: getRepositoryToken(BankReconciliation), useValue: reconciliationsRepo },
        { provide: getRepositoryToken(TransactionSplit), useValue: {} },
        { provide: getRepositoryToken(LedgerAccount), useValue: {} },
        { provide: DataSource, useValue: mockDataSource },
        { provide: AccountingReportsService, useValue: reportsService },
        { provide: LedgerService, useValue: ledgerService },
      ],
    }).compile();

    service = module.get<BankingService>(BankingService);
  });

  describe('listAccounts', () => {
    it('should calculate correct book balance for BANK and CREDIT_CARD accounts', async () => {
      const mockAccounts = [
        {
          id: 'acc-bank',
          name: 'Operating Checking',
          kind: 'BANK',
          currency: 'CAD',
          ledgerAccountId: 'la-bank',
          isActive: true,
        },
        {
          id: 'acc-cc',
          name: 'Corporate Visa',
          kind: 'CREDIT_CARD',
          currency: 'CAD',
          ledgerAccountId: 'la-cc',
          isActive: true,
        },
      ];

      accountsRepo.find.mockResolvedValue(mockAccounts);

      const balancesMap = new Map([
        ['la-bank', { debit: 150000, credit: 50000 }], // Net debit: 100000
        ['la-cc', { debit: 20000, credit: 70000 }],    // Net credit: 50000
      ]);
      reportsService.balances.mockResolvedValue(balancesMap);

      const result = await service.listAccounts();

      expect(result).toHaveLength(2);
      // For BANK: debit - credit = 150000 - 50000 = 100000
      expect(result[0].bookBalanceMinor).toBe(100000);
      // For CREDIT_CARD: credit - debit = 70000 - 20000 = 50000
      expect(result[1].bookBalanceMinor).toBe(50000);
    });
  });

  describe('getAccount', () => {
    it('should throw NotFoundException if account does not exist', async () => {
      accountsRepo.findOne.mockResolvedValue(null);

      await expect(service.getAccount('non-existent-id')).rejects.toThrow(NotFoundException);
    });

    it('should return account with book balance', async () => {
      accountsRepo.findOne.mockResolvedValue({
        id: 'acc-1',
        name: 'Checking',
        kind: 'BANK',
        currency: 'CAD',
        ledgerAccountId: 'la-1',
      });

      reportsService.balances.mockResolvedValue(
        new Map([['la-1', { debit: 50000, credit: 10000 }]])
      );

      const result = await service.getAccount('acc-1');
      expect(result.id).toBe('acc-1');
      expect(result.bookBalanceMinor).toBe(40000);
    });
  });

  describe('exclude', () => {
    it('should throw NotFoundException if transaction not found', async () => {
      transactionsRepo.findOne.mockResolvedValue(null);

      await expect(
        service.exclude('tx-not-found', { reason: 'Duplicate row' }, { id: 1, email: 'admin@gwgc.ca', role: 'admin' } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException if transaction is already reconciled', async () => {
      transactionsRepo.findOne.mockResolvedValue({
        id: 'tx-reconciled',
        status: 'RECONCILED',
      });

      await expect(
        service.exclude('tx-reconciled', { reason: 'Duplicate row' }, { id: 1, email: 'admin@gwgc.ca', role: 'admin' } as any),
      ).rejects.toThrow();
    });

    it('should exclude an unreviewed transaction', async () => {
      const tx = {
        id: 'tx-1',
        description: 'Test Charge',
        status: 'UNREVIEWED',
        notes: null,
      };
      transactionsRepo.findOne.mockResolvedValue(tx);

      const result = await service.exclude(
        'tx-1',
        { reason: 'Duplicate statement row' },
        { id: 1, email: 'admin@gwgc.ca', role: 'admin' } as any,
      );

      expect(result.status).toBe('EXCLUDED');
      expect(result.notes).toBe('Duplicate statement row');
      expect(transactionsRepo.save).toHaveBeenCalled();
    });
  });
});
