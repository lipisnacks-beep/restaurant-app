import mongoose from 'mongoose';
import fs from 'fs';
const txt = fs.readFileSync('/home/z/my-project/download/restaurant-app/.env', 'utf8');
for (const line of txt.split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }
async function main() {
  await mongoose.connect(process.env.MONGODB_URI!);
  const Order = (await import('/home/z/my-project/download/restaurant-app/src/models/Order')).default;
  const CustomerSession = (await import('/home/z/my-project/download/restaurant-app/src/models/CustomerSession')).default;
  const Customer = (await import('/home/z/my-project/download/restaurant-app/src/models/Customer')).default;
  const Review = (await import('/home/z/my-project/download/restaurant-app/src/models/Review')).default;
  const Table = (await import('/home/z/my-project/download/restaurant-app/src/models/Table')).default;
  // Delete test customers by mobile + their cascade
  const testMobiles = ['9876543210','9999999999','9777777777','9666666666'];
  const custs = await Customer.find({ mobile: { $in: testMobiles } }).select('_id').lean();
  const custIds = custs.map(c=>c._id);
  const sessDel = await CustomerSession.deleteMany({ $or: [{ customer: { $in: custIds } }, { mobile: { $in: testMobiles } }] });
  const ordDel = await Order.deleteMany({ $or: [{ customer: { $in: custIds } }, { sessionId: { $in: ['dbg-1'] } }] });
  const revDel = await Review.deleteMany({ $or: [{ customer: { $in: custIds } }, { mobile: { $in: testMobiles } }] });
  // Clear table currentSessions that point to deleted sessions
  const tables = await Table.find({ 'currentSession.customerMobile': { $in: testMobiles } });
  for (const t of tables) { t.currentSession = undefined; await t.save(); }
  console.log('deleted:', { sessions: sessDel.deletedCount, orders: ordDel.deletedCount, reviews: revDel.deletedCount, tablesCleared: tables.length });
  // Also clear any remaining test-sess orders
  const ordDel2 = await Order.deleteMany({ sessionId: { $in: ['test-sess-1','test-sess-2','test-sess-3','t1-mwrqtrmy','scope-test-1'] } });
  console.log('extra test orders deleted:', ordDel2.deletedCount);
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
