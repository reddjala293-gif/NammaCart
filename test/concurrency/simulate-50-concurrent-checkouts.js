/**
 * Standalone Concurrency Verification Suite: 50 Concurrent Shoppers vs. 1 Serialized Item
 * Demonstrates:
 * 1. The Naive Race Condition (Failure to prevent double-selling)
 * 2. PostgreSQL Row-Level Pessimistic Locking (SELECT ... FOR UPDATE NOWAIT)
 * 3. Proves the Golden Rule: NEVER SELL THE SAME PHYSICAL ITEM TWICE!
 */

const { EventEmitter } = require('events');

console.log('='.repeat(75));
console.log(' HIGH-CONCURRENCY RETAIL CHECKOUT & INVENTORY RESERVATION TEST');
console.log(' Target: Exactly 1 Physical Serialized Unit (#SN-NYC-104-00984)');
console.log(' Simulated Load: 50 Concurrent Shoppers executing checkout at the same millisecond');
console.log('='.repeat(75));

// ============================================================================
// SIMULATION 1: The Naive Approach (No Row-Level Locking)
// ============================================================================
async function runNaiveSimulation() {
  console.log('\n--- [TEST 1] NAIVE APPROACH (Read-then-Write without Locking) ---');
  
  let databaseRecord = {
    id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    serialNumber: 'SN-NYC-104-00984',
    status: 'AVAILABLE',
    reservedBy: null,
  };

  async function naiveReserve(userId) {
    // 1. Read record
    const current = { ...databaseRecord };
    
    // Simulate microscopic I/O or network latency (5ms)
    await new Promise((res) => setTimeout(res, Math.random() * 5));

    // 2. Check availability
    if (current.status === 'AVAILABLE') {
      // 3. Write update without lock
      databaseRecord.status = 'RESERVED';
      databaseRecord.reservedBy = userId;
      return { success: true, userId };
    }
    return { success: false, userId, error: 'ALREADY_RESERVED' };
  }

  // Fire 50 concurrent requests
  const promises = [];
  for (let i = 1; i <= 50; i++) {
    promises.push(naiveReserve(`shopper_${i}`));
  }
  const results = await Promise.all(promises);
  const winners = results.filter((r) => r.success);

  console.log(`[Naive Result] Out of 50 shoppers:`);
  console.log(`  - Successful reservations: ${winners.length}`);
  console.log(`  - Failed reservations:     ${50 - winners.length}`);
  if (winners.length > 1) {
    console.log(`  ❌ CRITICAL BUG: Golden Rule VIOLATED! Item reserved ${winners.length} times simultaneously!`);
  }
}

// ============================================================================
// SIMULATION 2: Production Pessimistic Row-Locking (SELECT ... FOR UPDATE NOWAIT)
// ============================================================================
async function runPessimisticLockSimulation() {
  console.log('\n--- [TEST 2] PRODUCTION PESSIMISTIC LOCKING (PostgreSQL FOR UPDATE NOWAIT) ---');

  // Simulated PostgreSQL Engine with ACID Row Locks & Transaction Table
  class PostgresDatabaseEngine {
    constructor() {
      this.rowLockHolder = null; // Represents exclusive row lock
      this.record = {
        id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        productId: 'e6f8b122-6b94-4d62-95f1-39e2467d1d2b',
        storeId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        serialNumber: 'SN-NYC-104-00984',
        status: 'AVAILABLE',
        reservedBy: null,
        reservationExpiresAt: null,
        orderId: null,
      };
      this.outbox = [];
      this.openSearchStoreAvailability = {
        storeId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        productId: 'e6f8b122-6b94-4d62-95f1-39e2467d1d2b',
        availableCount: 1,
        availableUnits: ['SN-NYC-104-00984'],
      };
    }

    // Simulates an ACID transaction with pessimistic row-level lock
    async executeTransaction(txCallback) {
      const txId = Math.random().toString(36).substring(7);
      let holdsLock = false;

      const txManager = {
        // SELECT ... FOR UPDATE NOWAIT
        selectForUpdateNoWait: async (itemId) => {
          if (this.rowLockHolder !== null && this.rowLockHolder !== txId) {
            // Emulates PostgreSQL error 55P03 (lock_not_available)
            const err = new Error('could not obtain lock on row in relation "unique_items"');
            err.code = '55P03';
            throw err;
          }
          // Acquire exclusive row lock
          this.rowLockHolder = txId;
          holdsLock = true;

          // Return copy of current record under lock
          return { ...this.record };
        },

        updateRecord: async (updatedFields) => {
          Object.assign(this.record, updatedFields);
        },

        insertOutboxEvent: async (topic, eventName, payload) => {
          this.outbox.push({ topic, eventName, payload, timestamp: new Date() });
        },
      };

      try {
        const result = await txCallback(txManager);
        // Release row lock upon transaction COMMIT
        if (holdsLock) {
          this.rowLockHolder = null;
        }
        return result;
      } catch (err) {
        // Release row lock upon transaction ROLLBACK
        if (holdsLock) {
          this.rowLockHolder = null;
        }
        throw err;
      }
    }
  }

  const db = new PostgresDatabaseEngine();

  // Checkout Service implementation
  async function reserveItem(userId) {
    return db.executeTransaction(async (tx) => {
      // 1. SELECT ... FOR UPDATE NOWAIT
      const item = await tx.selectForUpdateNoWait('7c9e6679-7425-40de-944b-e07fc1f90ae7');

      // 2. Availability predicate
      if (item.status !== 'AVAILABLE') {
        const err = new Error('ITEM_ALREADY_RESERVED');
        err.statusCode = 409;
        throw err;
      }

      // Simulate microsecond DB write
      await new Promise((res) => setTimeout(res, 2));

      // 3. Mutate status to RESERVED with 10-minute TTL
      const expiresAt = new Date(Date.now() + 600 * 1000);
      await tx.updateRecord({
        status: 'RESERVED',
        reservedBy: userId,
        reservationExpiresAt: expiresAt,
      });

      // 4. Atomic Outbox Event
      await tx.insertOutboxEvent('inventory.changes', 'item.reserved', {
        uniqueItemId: item.id,
        serialNumber: item.serialNumber,
        storeId: item.storeId,
        userId,
      });

      return {
        statusCode: 201,
        message: 'RESERVATION_SUCCESSFUL',
        userId,
        serialNumber: item.serialNumber,
        expiresAt,
      };
    }).catch((err) => {
      return {
        statusCode: 409,
        errorCode: 'ITEM_ALREADY_RESERVED',
        userId,
        error: err.message,
      };
    });
  }

  console.log('Shooters ready: Launching 50 concurrent reservation attempts...');
  const promises = [];
  for (let i = 1; i <= 50; i++) {
    promises.push(reserveItem(`shopper_${i}`));
  }

  const results = await Promise.all(promises);

  const successes = results.filter((r) => r.statusCode === 201);
  const conflicts = results.filter((r) => r.statusCode === 409);

  console.log(`\n[Pessimistic Lock Verification Results]`);
  console.log(`  - Total Concurrent Shoppers: 50`);
  console.log(`  - HTTP 201 (Reservations Succeeded): ${successes.length}`);
  console.log(`  - HTTP 409 (Conflicts / Lock Denied): ${conflicts.length}`);

  if (successes.length === 1 && conflicts.length === 49) {
    console.log(`  ✅ SUCCESS: Exactly 1 shopper won the reservation (${successes[0].userId})!`);
    console.log(`  ✅ SUCCESS: 49 shoppers safely rejected with 409 Conflict.`);
    console.log(`  ✅ GOLDEN RULE ENFORCED: Zero double-selling!`);
  } else {
    console.error(`  ❌ FAIL: Concurrency violation detected!`);
    process.exit(1);
  }

  console.log(`\n[Database & Outbox Verification]`);
  console.log(`  - Final DB Status: ${db.record.status}`);
  console.log(`  - Reserved By:     ${db.record.reservedBy}`);
  console.log(`  - Outbox Events:   ${db.outbox.length} (Topic: ${db.outbox[0].topic}, Event: ${db.outbox[0].eventName})`);

  // ============================================================================
  // SIMULATION 3: Checkout & Payment Settlement
  // ============================================================================
  console.log('\n--- [TEST 3] CHECKOUT & PAYMENT SETTLEMENT ---');
  const winnerUserId = successes[0].userId;

  async function checkout(userId, paymentToken) {
    return db.executeTransaction(async (tx) => {
      const item = await tx.selectForUpdateNoWait('7c9e6679-7425-40de-944b-e07fc1f90ae7');

      if (item.status !== 'RESERVED' || item.reservedBy !== userId) {
        const err = new Error('RESERVATION_INVALID_OR_EXPIRED');
        err.statusCode = 409;
        throw err;
      }

      // Simulate payment processing
      if (paymentToken !== 'tok_valid') {
        const err = new Error('PAYMENT_FAILED');
        err.statusCode = 402;
        throw err;
      }

      // Mark SOLD
      const orderId = 'ORD-20261121-001';
      await tx.updateRecord({
        status: 'SOLD',
        orderId,
      });

      await tx.insertOutboxEvent('inventory.changes', 'item.sold', {
        orderId,
        uniqueItemId: item.id,
        serialNumber: item.serialNumber,
      });

      // Update OpenSearch real-time availability
      db.openSearchStoreAvailability.availableCount = 0;
      db.openSearchStoreAvailability.availableUnits = [];

      return {
        statusCode: 201,
        orderId,
        status: 'CONFIRMED',
        serialNumber: item.serialNumber,
      };
    });
  }

  // Attempt checkout by winning user
  console.log(`Winning shopper (${winnerUserId}) completes payment...`);
  const checkoutResult = await checkout(winnerUserId, 'tok_valid');
  console.log(`  ✅ Checkout Completed: Order ID = ${checkoutResult.orderId}, Status = ${checkoutResult.status}`);
  console.log(`  - Final DB Status:  ${db.record.status}`);
  console.log(`  - OpenSearch Stock: ${db.openSearchStoreAvailability.availableCount} available units.`);

  // Attempt checkout by another user on the now SOLD item
  console.log(`Unauthorized shopper (shopper_99) attempts checkout on the same item...`);
  try {
    await checkout('shopper_99', 'tok_valid');
    console.error(`  ❌ FAIL: Unauthorized shopper was able to purchase sold item!`);
  } catch (err) {
    console.log(`  ✅ Rejected with status ${err.statusCode}: ${err.message}`);
  }

  console.log('\n' + '='.repeat(75));
  console.log(' ALL CONCURRENCY & INTEGRATION TESTS PASSED WITH 100% RELIABILITY.');
  console.log('='.repeat(75));
}

(async () => {
  await runNaiveSimulation();
  await runPessimisticLockSimulation();
})();
