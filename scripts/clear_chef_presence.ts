/**
 * Clear all chefs' presence (lastActiveAt) + assignment (lastAssignedAt)
 * timestamps. Used by test scripts to start from a clean dispatch slate so
 * leftover chef logins from prior test runs don't grab orders meant for the
 * chef the current test logs in as.
 *
 * Usage: npx tsx scripts/clear_chef_presence.ts
 */
import mongoose from 'mongoose';
import fs from 'fs';

const txt = fs.readFileSync('/home/z/my-project/download/restaurant-app/.env', 'utf8');
for (const line of txt.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI!);
  const User = (await import('/home/z/my-project/download/restaurant-app/src/models/User')).default;
  const r = await User.updateMany(
    { role: 'chef' },
    { $set: { lastActiveAt: null, lastAssignedAt: null } },
  );
  console.log(`cleared presence for ${r.modifiedCount} chef(s)`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
