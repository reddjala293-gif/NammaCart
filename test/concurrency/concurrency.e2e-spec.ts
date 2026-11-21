import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { CheckoutService } from '../../src/modules/checkout/checkout.service';
import { InventoryRepository } from '../../src/modules/inventory/inventory.repository';
import { OutboxService } from '../../src/common/outbox/outbox.service';
import { ItemUnavailableException } from '../../src/common/exceptions/retail.exceptions';
import { ItemStatus } from '../../src/common/enums/item-status.enum';

describe('High-Concurrency Checkout Simulation (50 Concurrent Shoppers)', () => {
  let checkoutService: CheckoutService;
  let targetItemId: string;
  let targetStoreId: string;

  beforeEach(async () => {
    targetItemId = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
    targetStoreId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
  });

  it('guarantees that 50 concurrent users competing for 1 physical item results in exactly 1 winner and 49 conflicts', async () => {
    // Shared state simulating PostgreSQL table row with ACID row-lock state
    let isRowLocked = false;
    let itemState = {
      id: targetItemId,
      storeId: targetStoreId,
      productId: 'e6f8b122-6b94-4d62-95f1-39e2467d1d2b',
      serialNumber: 'SN-PROTOTYPE-001',
      status: ItemStatus.AVAILABLE,
      reservedByUserId: null as string | null,
      reservationExpiresAt: null as Date | null,
    };

    // Mock DataSource simulating PostgreSQL connection pool and transaction manager
    const mockDataSource = {
      createQueryRunner: () => {
        let inTransaction = false;
        let holdsRowLock = false;

        return {
          connect: jest.fn().mockResolvedValue(true),
          startTransaction: jest.fn().mockImplementation(async () => {
            inTransaction = true;
          }),
          commitTransaction: jest.fn().mockImplementation(async () => {
            inTransaction = false;
            if (holdsRowLock) {
              isRowLocked = false;
              holdsRowLock = false;
            }
          }),
          rollbackTransaction: jest.fn().mockImplementation(async () => {
            inTransaction = false;
            if (holdsRowLock) {
              isRowLocked = false;
              holdsRowLock = false;
            }
          }),
          release: jest.fn().mockResolvedValue(true),
          manager: {
            save: jest.fn().mockImplementation(async (entity) => {
              Object.assign(itemState, entity);
              return itemState;
            }),
          },
        };
      },
    };

    // Mock InventoryRepository with strict pessimistic NOWAIT semantics
    const mockInventoryRepo = {
      lockSpecificItemForReservation: jest.fn().mockImplementation(async (manager, itemId, storeId) => {
        // PostgreSQL SELECT ... FOR UPDATE NOWAIT behavior:
        // If row is already locked by another tx, PG throws 55P03 (lock_not_available)
        if (isRowLocked) {
          const pgError: any = new Error('could not obtain lock on row in relation "unique_items"');
          pgError.code = '55P03';
          throw pgError;
        }

        // If item is already reserved or sold, return null
        if (itemState.status !== ItemStatus.AVAILABLE) {
          return null;
        }

        // Acquire row lock exclusively
        isRowLocked = true;
        // In PostgreSQL, row lock is held until transaction commit/rollback
        return { ...itemState };
      }),
      lockReservedItemForCheckout: jest.fn().mockImplementation(async (manager, itemId, userId) => {
        if (
          itemState.id === itemId &&
          itemState.status === ItemStatus.RESERVED &&
          itemState.reservedByUserId === userId
        ) {
          return { ...itemState };
        }
        return null;
      }),
    };

    const mockOutboxService = {
      recordEvent: jest.fn().mockResolvedValue({ id: 'outbox-uuid' }),
    };

    checkoutService = new CheckoutService(
      mockDataSource as any,
      mockInventoryRepo as any,
      mockOutboxService as any,
    );

    const CONCURRENT_USERS = 50;
    const userIds = Array.from({ length: CONCURRENT_USERS }, (_, i) => `shopper_${i + 1}`);

    // Fire all 50 reservation requests simultaneously
    const results = await Promise.allSettled(
      userIds.map((userId) =>
        checkoutService.reserveItem({
          uniqueItemId: targetItemId,
          storeId: targetStoreId,
          userId,
          ttlSeconds: 600,
        }),
      ),
    );

    const successes = results.filter((r) => r.status === 'fulfilled');
    const failures = results.filter((r) => r.status === 'rejected');

    // VERIFICATION:
    // 1. Exactly ONE shopper must win the reservation
    expect(successes.length).toBe(1);

    // 2. Exactly 49 shoppers must receive ItemUnavailableException (HTTP 409 Conflict)
    expect(failures.length).toBe(49);
    for (const fail of failures) {
      const error = (fail as PromiseRejectedResult).reason;
      expect(error).toBeInstanceOf(ItemUnavailableException);
    }

    // 3. Database row must strictly be in RESERVED state with winning shopper's ID
    const winnerResult = (successes[0] as PromiseFulfilledResult<any>).value;
    expect(itemState.status).toBe(ItemStatus.RESERVED);
    expect(itemState.reservedByUserId).toBe(winnerResult.userId);
  });
});
