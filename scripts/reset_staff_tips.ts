// scripts/reset_staff_tips.ts
// Deterministically reset a staff user's tipsEarned + tipsWithdrawn to 0,
// and clear their TipWithdrawal ledger. Used by the tips test for isolation.
// Usage: npx tsx scripts/reset_staff_tips.ts <staffId> [earned] [withdrawn]
import mongoose from 'mongoose';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8');
for (const line of env.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const staffId = process.argv[2];
const earned = Number(process.argv[3] ?? 0);
const withdrawn = Number(process.argv[4] ?? 0);

if (!staffId) { console.error('staffId required'); process.exit(1); }

const USchema = new mongoose.Schema({}, { strict: false });
const WSchema = new mongoose.Schema({}, { strict: false });

async function main() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  const U = mongoose.models.User || mongoose.model('User', USchema);
  const W = mongoose.models.TipWithdrawal || mongoose.model('TipWithdrawal', WSchema);
  await U.updateOne(
    { _id: new mongoose.Types.ObjectId(staffId) },
    { $set: { tipsEarned: earned, tipsWithdrawn: withdrawn, lastActiveAt: null, lastAssignedAt: null } },
  );
  await W.deleteMany({ staffId: new mongoose.Types.ObjectId(staffId) });
  console.log('reset');
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
