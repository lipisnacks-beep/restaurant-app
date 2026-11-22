import mongoose from 'mongoose';
import fs from 'fs';
const txt = fs.readFileSync('/home/z/my-project/download/restaurant-app/.env', 'utf8');
for (const line of txt.split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }
async function main() {
  await mongoose.connect(process.env.MONGODB_URI!);
  const Order = (await import('/home/z/my-project/download/restaurant-app/src/models/Order')).default;
  const res = await Order.deleteMany({ sessionId: { $in: ['test-sess-1','test-sess-2','test-sess-3','t1-mwrqtrmy','scope-test-1'] } });
  console.log('deleted', res.deletedCount, 'test orders');
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
