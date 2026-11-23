// scripts/clear_all_presence.ts
// Clear lastActiveAt + lastAssignedAt on ALL chef AND staff accounts so the
// dispatch engines treat nobody as present until they log in / poll again.
// Used by tests for deterministic routing isolation.
import mongoose from 'mongoose';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8');
for (const line of env.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  const U = mongoose.models.User || mongoose.model('User', new mongoose.Schema({}, { strict: false }));
  const res = await U.updateMany(
    { role: { $in: ['chef', 'staff'] } },
    { $set: { lastActiveAt: null, lastAssignedAt: null } },
  );
  console.log(`cleared presence for ${res.modifiedCount} chef/staff account(s)`);
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
