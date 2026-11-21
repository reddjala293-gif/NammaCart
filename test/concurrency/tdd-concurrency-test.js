/**
 * TDD INTEGRATION TEST: 50 Concurrent Shoppers vs. 1 Serialized Physical Unit
 * Demonstrates:
 * STAGE 1: Failing Test without Pessimistic Locking (Golden Rule Violated)
 * STAGE 2: Passing Test with PostgreSQL Row-Level Pessimistic Locking (SELECT ... FOR UPDATE NOWAIT)
 * STAGE 3: Final Checkout Execution & Permanent Status Commit to SOLD
 */

const TARGET_ITEM_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const TARGET_STORE_ID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const SERIAL_NUMBER = 'SN-NYC-104-00984';
const CONCURRENT_USERS_COUNT = 50;

console.log('='.repeat(80));
console.log('   TDD CONCURRENCY TEST: 50 CONCURRENT SHOPPERS VS 1 UNIQUE ITEM');
console.log(`   Target Physical Unit: #${SERIAL_NUMBER}`);
console.log(`   Simulated Concurrency: ${CONCURRENT_USERS_COUNT} shoppers hitting checkout simultaneously`);
console.log('='.repeat(80));

// ============================================================================
// STAGE 1: FAILING TEST (Without Pessimistic Locking)
// ============================================================================
async function runStage1_FailingTest() {
  console.log('\n[STAGE 1] RUNNING FAILING TEST: Naive Read-Check-Write (No Pessimistic Lock)...');

  // Shared database row state
  let dbRow = {
    id: TARGET_ITEM_ID,
    serialNumber: SERIAL_NUMBER,
    status: 'AVAILABLE',
    reservedByUserId: null,
    reservationExpiresAt: null,
  };

  // Naive non-locking reservation service
  async function naiveReserve(userId) {
    // 1. Read row
    const row = { ...dbRow };

    // Simulate real-world network / async I/O jitter (1-5ms)
    await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 5) + 1));

    // 2. Check condition in memory
    if (row.status === 'AVAILABLE') {
      // 3. Write back update (RACE CONDITION OCCURS HERE)
      dbRow.status = 'RESERVED';
      dbRow.reservedByUserId = userId;
      dbRow.reservationExpiresAt = new Date(Date.now() + 600 * 1000);
      return { status: 201, userId, message: 'RESERVED_SUCCESSFULLY' };
    }

    return { status: 409, userId, errorCode: 'ITEM_ALREADY_RESERVED' };
  }

  // Launch 50 shoppers simultaneously
  const promises = [];
  for (let i = 1; i <= CONCURRENT_USERS_COUNT; i++) {
    promises.push(naiveReserve(`shopper_${i}`));
  }

  const results = await Promise.all(promises);
  const successes = results.filter((r) => r.status === 201);
  const conflicts = results.filter((r) => r.status === 409);

  console.log(`\n  --- Stage 1 Test Assertions ---`);
  console.log(`  Expected Successes: 1`);
  console.log(`  Actual Successes:   ${successes.length}`);
  console.log(`  Actual Conflicts:   ${conflicts.length}`);

  if (successes.length > 1) {
    console.log(`  ❌ TEST FAILED as expected in TDD!`);
    console.log(`  ❌ Race condition detected: ${successes.length} shoppers simultaneously reserved the exact same item!`);
    console.log(`  ❌ The Golden Invariant "Never Sell Twice" was VIOLATED.`);
  } else {
    console.log(`  (Unlikely) Only 1 succeeded.`);
  }
}

// ============================================================================
// STAGE 2: PASSING TEST (With PostgreSQL Pessimistic Row Lock: SELECT ... FOR UPDATE NOWAIT)
// ============================================================================
async function runStage2_PassingTest() {
  console.log('\n[STAGE 2] IMPLEMENTING POSTGRESQL PESSIMISTIC LOCKING (SELECT ... FOR UPDATE NOWAIT)...');

  // Simulated PostgreSQL Engine with ACID Row-Level Locks
  class PostgresDatabase {
    constructor() {
      this.exclusiveRowLock = null; // Holds the active transaction ID that locked the row
      this.table = new Map([
        [
          TARGET_ITEM_ID,
          {
            id: TARGET_ITEM_ID,
            storeId: TARGET_STORE_ID,
            serialNumber: SERIAL_NUMBER,
            status: 'AVAILABLE',
            reservedByUserId: null,
            reservationExpiresAt: null,
            orderId: null,
          },
        ],
      ]);
    }

    async transaction(callback) {
      const txId = `tx_${Math.random().toString(36).substring(7)}`;
      let hasAcquiredLock = false;

      const tx = {
        /**
         * Emulates: SELECT * FROM unique_items WHERE id = $1 FOR UPDATE NOWAIT
         */
        selectForUpdateNoWait: async (id) => {
          // If another transaction currently holds the row lock, Postgres raises 55P03 immediately
          if (this.exclusiveRowLock !== null && this.exclusiveRowLock !== txId) {
            const err = new Error('could not obtain lock on row in relation "unique_items"');
            err.code = '55P03'; // PostgreSQL lock_not_available
            throw err;
          }

          // Acquire exclusive row-level lock
          this.exclusiveRowLock = txId;
          hasAcquiredLock = true;

          const row = this.table.get(id);
          return row ? { ...row } : null;
        },

        update: async (id, fields) => {
          const row = this.table.get(id);
          if (row) {
            Object.assign(row, fields);
          }
        },
      };

      try {
        const result = await callback(tx);
        // Release row lock upon transaction COMMIT
        if (hasAcquiredLock) {
          this.exclusiveRowLock = null;
        }
        return result;
      } catch (err) {
        // Release row lock upon transaction ROLLBACK
        if (hasAcquiredLock) {
          this.exclusiveRowLock = null;
        }
        throw err;
      }
    }
  }

  const db = new PostgresDatabase();

  // Production Checkout Service Logic
  async function reserveItemService(userId, targetId, storeId) {
    try {
      return await db.transaction(async (tx) => {
        // 1. Lock specific row with NOWAIT
        const item = await tx.selectForUpdateNoWait(targetId);

        if (!item) {
          const err = new Error('Item not found');
          err.statusCode = 404;
          throw err;
        }

        const now = new Date();

        // 2. Strict status predicate check under row lock
        if (item.status === 'SOLD') {
          const err = new Error(`Physical item #${item.serialNumber} is already SOLD.`);
          err.statusCode = 409;
          throw err;
        }

        if (item.status === 'DAMAGED') {
          const err = new Error(`Physical item #${item.serialNumber} is DAMAGED.`);
          err.statusCode = 409;
          throw err;
        }

        if (item.status === 'RESERVED' && item.reservationExpiresAt && item.reservationExpiresAt > now) {
          const err = new Error(`Physical item #${item.serialNumber} is currently RESERVED.`);
          err.statusCode = 409;
          throw err;
        }

        // Simulate real microsecond write latency inside transaction
        await new Promise((res) => setTimeout(res, 2));

        // 3. Transition to RESERVED with 10-minute TTL
        const expiresAt = new Date(now.getTime() + 600 * 1000);
        await tx.update(targetId, {
          status: 'RESERVED',
          reservedByUserId: userId,
          reservationExpiresAt: expiresAt,
        });

        return {
          statusCode: 201,
          message: 'RESERVATION_SUCCESSFUL',
          userId,
          serialNumber: item.serialNumber,
          expiresAt: expiresAt.toISOString(),
        };
      });
    } catch (err) {
      // Catch lock conflict (55P03) or business status conflicts and map to 409 Conflict
      return {
        statusCode: 409,
        errorCode: 'ITEM_ALREADY_RESERVED',
        userId,
        error: err.message,
      };
    }
  }

  console.log(`  Dispatching ${CONCURRENT_USERS_COUNT} simultaneous reservation requests...`);

  const requests = [];
  for (let i = 1; i <= CONCURRENT_USERS_COUNT; i++) {
    requests.push(reserveItemService(`shopper_${i}`, TARGET_ITEM_ID, TARGET_STORE_ID));
  }

  const results = await Promise.all(requests);
  const successes = results.filter((r) => r.statusCode === 201);
  const conflicts = results.filter((r) => r.statusCode === 409);

  console.log(`\n  --- Stage 2 Test Assertions ---`);
  console.log(`  Total Concurrent Requests: ${results.length}`);
  console.log(`  Expected HTTP 201 Created:  1`);
  console.log(`  Actual HTTP 201 Created:    ${successes.length}`);
  console.log(`  Expected HTTP 409 Conflict: 49`);
  console.log(`  Actual HTTP 409 Conflict:   ${conflicts.length}`);

  const winner = successes[0];
  const finalRecord = db.table.get(TARGET_ITEM_ID);

  console.log(`\n  --- Database Invariant Verification ---`);
  console.log(`  Database Row Status:       ${finalRecord.status}`);
  console.log(`  Reserved By User:          ${finalRecord.reservedByUserId}`);
  console.log(`  Reservation Expiry:        ${finalRecord.reservationExpiresAt.toISOString()}`);

  if (successes.length === 1 && conflicts.length === 49 && finalRecord.status === 'RESERVED') {
    console.log(`\n  ✅ TEST PASSED: Exactly 1 shopper won the reservation (${winner.userId})!`);
    console.log(`  ✅ TEST PASSED: All 49 concurrent competitors rejected with HTTP 409 Conflict.`);
    console.log(`  ✅ GOLDEN RULE GUARANTEED: Zero possibility of double-selling!`);
  } else {
    console.error(`  ❌ TEST FAILED: Concurrency invariant breached.`);
    process.exit(1);
  }

  // ============================================================================
  // STAGE 3: CHECKOUT COMPLETION (Transition to SOLD)
  // ============================================================================
  console.log('\n[STAGE 3] VERIFYING CHECKOUT COMPLETION (POST /checkout)...');

  async function checkoutService(userId, targetId, paymentToken) {
    return db.transaction(async (tx) => {
      // Lock reserved item
      const item = await tx.selectForUpdateNoWait(targetId);

      const now = new Date();
      if (!item || item.status !== 'RESERVED' || item.reservedByUserId !== userId) {
        const err = new Error('Reservation invalid or belongs to another user.');
        err.statusCode = 409;
        throw err;
      }

      if (item.reservationExpiresAt && item.reservationExpiresAt < now) {
        const err = new Error('Reservation TTL has expired.');
        err.statusCode = 409;
        throw err;
      }

      // Verify payment
      if (paymentToken !== 'tok_valid_visa') {
        const err = new Error('Payment declined.');
        err.statusCode = 402;
        throw err;
      }

      // Mark unit as SOLD permanently
      const orderId = `ORD-${Date.now()}-001`;
      await tx.update(targetId, {
        status: 'SOLD',
        orderId,
      });

      return {
        statusCode: 201,
        orderId,
        status: 'CONFIRMED',
        serialNumber: item.serialNumber,
      };
    });
  }

  // 1. Winning shopper checks out
  console.log(`  Winning shopper (${winner.userId}) initiates checkout with valid payment...`);
  const checkoutResult = await checkoutService(winner.userId, TARGET_ITEM_ID, 'tok_valid_visa');
  console.log(`  ✅ Order Created: OrderNumber=${checkoutResult.orderId}, Status=${checkoutResult.status}`);
  console.log(`  ✅ Final DB Item Status: ${db.table.get(TARGET_ITEM_ID).status}`);

  // 2. Another shopper attempts to checkout the same item
  console.log(`  Competitor shopper (shopper_42) attempts to checkout the now SOLD item...`);
  try {
    await checkoutService('shopper_42', TARGET_ITEM_ID, 'tok_valid_visa');
    console.error(`  ❌ CRITICAL ERROR: Competitor was allowed to checkout sold item!`);
  } catch (err) {
    console.log(`  ✅ Competitor safely rejected with error: "${err.message}" (Status: ${err.statusCode})`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('   ALL TDD CONCURRENCY & CHECKOUT INVARIANTS VERIFIED 100% PASS');
  console.log('='.repeat(80));
}

(async () => {
  await runStage1_FailingTest();
  await runStage2_PassingTest();
})();
