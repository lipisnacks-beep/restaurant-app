/**
 * One-time backfill: stamp table.currentSession.servedByStaffId for occupied
 * tables whose session has no recorded server, using order attribution.
 *
 * Why: sessions created before the attribution fixes (serve/pay/complete
 * stamping) stay UNCLAIMED, and the old "unclaimed → any staff may free"
 * rule made the Free Table option appear in every staff account. With the
 * strict rule an unclaimed session is invisible to unrelated staff, so
 * legacy sessions need their server backfilled or only admin could free them.
 *
 * Attribution (same precedence as the pay-time fix):
 *   1. the most recent staff who actually delivered an order (servedAt set)
 *   2. otherwise the first dispatch-assigned staff on the session's orders
 * Sessions whose orders have no staff at all are left for admin and reported.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

interface SessionLike { sessionId: string; sessionStatus?: string; servedByStaffId?: string | null }

async function main() {
  await mongoose.connect(process.env.MONGODB_URI!);
  const db = mongoose.connection.db;
  const tables = db.collection('tables');
  const orders = db.collection('orders');

  const occupied = await tables
    .find({ 'currentSession.sessionId': { $exists: true, $ne: '' } })
    .project({ number: 1, name: 1, currentSession: 1 })
    .toArray();

  let stamped = 0;
  let alreadyOk = 0;
  const adminOnly: string[] = [];

  for (const t of occupied) {
    const cs = t.currentSession as SessionLike;
    if (!cs?.sessionId) continue;
    if (cs.servedByStaffId) { alreadyOk++; continue; }

    const sessionOrders = await orders
      .find({ sessionId: cs.sessionId })
      .project({ staffId: 1, servedAt: 1, servedAtTime: 1, orderNumber: 1 })
      .sort({ createdAt: 1 })
      .toArray();

    const servedOrders = sessionOrders
      .filter((o) => o.staffId && (o.servedAt || o.servedAtTime))
      .sort((a, b) => new Date(a.servedAt || a.servedAtTime).getTime() - new Date(b.servedAt || b.servedAtTime).getTime());
    const attribution =
      servedOrders[servedOrders.length - 1]?.staffId ||
      sessionOrders.find((o) => o.staffId)?.staffId;

    if (attribution) {
      await tables.updateOne(
        { _id: t._id },
        { $set: { 'currentSession.servedByStaffId': attribution } },
      );
      stamped++;
      console.log(`table ${t.number}: stamped server ${attribution} (${servedOrders.length ? 'actual server' : 'assigned staff'} from ${sessionOrders.length} orders)`);
    } else {
      adminOnly.push(`table ${t.number} (${cs.sessionId}, ${sessionOrders.length} orders, none assigned)`);
    }
  }

  console.log(`\nsummary: ${occupied.length} occupied tables | ${alreadyOk} already attributed | ${stamped} backfilled | ${adminOnly.length} admin-only`);
  for (const s of adminOnly) console.log('  admin-only:', s);
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
