/**
 * E2E DB helpers for the strict free-table ownership tests.
 *   npx tsx scripts/e2e_db_helpers.ts strip <tableNumber>
 *     -> remove servedByStaffId from the table's current session (simulates
 *        a legacy/pre-fix unclaimed session)
 *   npx tsx scripts/e2e_db_helpers.ts unclaimed <tableNumber>
 *     -> insert a complete unclaimed session (CustomerSession + table
 *        snapshot + one served order with NO staffId) — simulates an
 *        admin-served unrouted legacy session that self-heal cannot fix
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const [, , mode, tableArg] = process.argv;
const tableNumber = Number(tableArg);

interface CsLike { sessionId: string; startedAt: Date; customerName: string; customerMobile: string; sessionStatus: string; servedByStaffId?: string }

async function main() {
  await mongoose.connect(process.env.MONGODB_URI!);
  const db = mongoose.connection.db;
  const tables = db.collection('tables');
  const customerSessions = db.collection('customersessions');
  const orders = db.collection('orders');

  const table = await tables.findOne({ number: tableNumber });
  if (!table) throw new Error(`table ${tableNumber} not found`);

  if (mode === 'strip') {
    if (!table.currentSession?.sessionId) throw new Error(`table ${tableNumber} has no session`);
    await tables.updateOne({ _id: table._id }, { $unset: { 'currentSession.servedByStaffId': '' } });
    console.log(`table ${tableNumber}: stripped servedByStaffId (session ${table.currentSession.sessionId})`);
  } else if (mode === 'unclaimed') {
    await tables.updateOne({ _id: table._id }, { $set: { currentSession: undefined } });
    const sessionId = `cs-legacy-unclaimed-${tableNumber}`;
    // Idempotent: drop leftovers from a previous run of the same sessionId.
    await customerSessions.deleteMany({ sessionId });
    await orders.deleteMany({ sessionId });
    const now = new Date();
    const cs: CsLike = {
      sessionId, startedAt: now, customerName: 'Legacy Guest', customerMobile: '9000000000',
      sessionStatus: 'completed',
    };
    await customerSessions.insertOne({
      sessionId, customer: table._id, customerName: cs.customerName, mobile: cs.customerMobile,
      table: table._id, tableNumber, status: 'completed', startedAt: now, endedAt: now,
      orderCount: 1, subtotal: 100, taxAmount: 5, serviceChargeAmount: 10, tip: 0, total: 115,
    } as any);
    await orders.insertOne({
      orderNumber: `ORD-LEGACY-${tableNumber}`, table: table._id, tableNumber,
      sessionId, customerName: 'Legacy Guest', status: 'completed', paymentStatus: 'paid',
      items: [], subtotal: 100, taxAmount: 5, serviceChargeAmount: 10, tip: 0,
      total: 115, grandTotal: 115, taxRate: 5, serviceChargeRate: 10,
      createdAt: now, completedAt: now, servedAt: now, servedAtTime: now,
    } as any);
    await tables.updateOne({ _id: table._id }, { $set: { currentSession: cs } });
    console.log(`table ${tableNumber}: seeded legacy unclaimed session ${sessionId} (order without staffId)`);
  } else {
    throw new Error('usage: strip <tableNumber> | unclaimed <tableNumber>');
  }
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
