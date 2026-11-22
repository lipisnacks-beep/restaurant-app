/**
 * Seed script: run with `npm run seed` (or `npx tsx src/lib/seed.ts`)
 * - Creates the default admin / chef / staff accounts if missing.
 * - Creates 8 tables if the collection is empty.
 *
 * Default credentials (change the admin password in production!):
 *   admin  / admin@restaurant.com / admin123
 *   chef   / chef@restaurant.com  / chef123
 *   staff  / staff@restaurant.com / staff123
 */
import bcrypt from 'bcryptjs';
import dbConnect from './db';
import User from '@/models/User';
import Table from '@/models/Table';

const DEFAULTS = [
  { name: 'Admin', email: 'admin@restaurant.com', password: 'admin123', role: 'admin' },
  { name: 'Head Chef', email: 'chef@restaurant.com', password: 'chef123', role: 'chef' },
  { name: 'Service Staff', email: 'staff@restaurant.com', password: 'staff123', role: 'staff' },
] as const;

async function seed() {
  await dbConnect();
  console.log('Connected to MongoDB, seeding...');

  for (const d of DEFAULTS) {
    const existing = await User.findOne({ email: d.email });
    if (existing) {
      console.log(`User already exists: ${d.email} (${d.role})`);
      continue;
    }
    const hash = await bcrypt.hash(d.password, 10);
    await User.create({ name: d.name, email: d.email, password: hash, role: d.role });
    console.log(`Created user: ${d.email} / ${d.password} (${d.role})`);
  }

  const tableCount = await Table.countDocuments();
  if (tableCount === 0) {
    const tables = Array.from({ length: 8 }, (_, i) => ({
      number: i + 1,
      name: `Table ${i + 1}`,
      seats: 4,
      active: true,
    }));
    await Table.insertMany(tables);
    console.log('Created 8 default tables (Table 1 .. Table 8).');
  } else {
    console.log(`Tables already exist (${tableCount}). Skipping table seed.`);
  }

  console.log('Seed complete.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
