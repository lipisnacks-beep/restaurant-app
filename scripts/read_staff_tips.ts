// scripts/read_staff_tips.ts — print a staff's tipsEarned + tipsWithdrawn.
// Usage: npx tsx scripts/read_staff_tips.ts <staffId>
import mongoose from 'mongoose';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8');
for (const line of env.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const staffId = process.argv[2];
if (!staffId) { console.error('staffId required'); process.exit(1); }

async function main() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  const U = mongoose.models.User || mongoose.model('User', new mongoose.Schema({}, { strict: false }));
  const u: any = await U.findById(new mongoose.Types.ObjectId(staffId)).lean();
  console.log(`earned=${u?.tipsEarned ?? 0} withdrawn=${u?.tipsWithdrawn ?? 0}`);
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
