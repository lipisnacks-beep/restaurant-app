// scripts/strip_served_by_staff.ts
// Remove currentSession.servedByStaffId from a table (by table number) to
// simulate a legacy table that was served before the ownership-gate feature
// shipped. Used by the free-table gate test.
// Usage: npx tsx scripts/strip_served_by_staff.ts <tableNumber>
import mongoose from 'mongoose';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8');
for (const line of env.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const tableNumber = Number(process.argv[2]);
if (!tableNumber) { console.error('tableNumber required'); process.exit(1); }

async function main() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  const T = mongoose.models.Table || mongoose.model('Table', new mongoose.Schema({}, { strict: false }));
  await T.updateOne({ number: tableNumber }, { $unset: { 'currentSession.servedByStaffId': '' } });
  console.log('stripped');
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
