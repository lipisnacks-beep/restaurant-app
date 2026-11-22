/**
 * Standalone script that connects to MongoDB Atlas using the credentials in
 * restaurant-app/.env, runs the same seed logic as /api/seed (users, tables,
 * and the full 33-dish menu with Cloudinary images), then prints a summary.
 *
 * Usage:
 *   cd /home/z/my-project/download/restaurant-app
 *   npx tsx ./scripts/seed_db.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';

// Load .env from restaurant-app folder.
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const txt = fs.readFileSync(envPath, 'utf8');
  for (const line of txt.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}

const MONGODB_URI = process.env.MONGODB_URI;
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || '';
if (!MONGODB_URI) {
  console.error('MONGODB_URI missing in .env');
  process.exit(1);
}

// Reuse the app's own Mongoose models (relative imports work because the
// script is run from the restaurant-app folder).
import User from '../src/models/User';
import Table from '../src/models/Table';
import MenuItem from '../src/models/MenuItem';
import { SEED_MENU } from '../src/lib/menuData';

function cloudinaryUrl(slug: string): string {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/c_limit,w_800,h_600,q_auto/v1/restaurant/menu/${slug}`;
}

async function main() {
  console.log('Connecting to MongoDB Atlas...');
  await mongoose.connect(MONGODB_URI);
  console.log('Connected:', mongoose.connection.host);

  // ---- Users ----
  const DEFAULTS = [
    { name: 'Admin', email: 'admin@restaurant.com', password: 'admin123', role: 'admin' },
    { name: 'Head Chef', email: 'chef@restaurant.com', password: 'chef123', role: 'chef' },
    { name: 'Service Staff', email: 'staff@restaurant.com', password: 'staff123', role: 'staff' },
  ] as const;
  for (const d of DEFAULTS) {
    const existing = await User.findOne({ email: d.email });
    if (existing) { console.log(`  user: ${d.email} (exists)`); continue; }
    await User.create({ name: d.name, email: d.email, password: d.password, role: d.role, active: true });
    console.log(`  user: ${d.email} (created)`);
  }

  // ---- Tables ----
  const tCount = await Table.countDocuments();
  if (tCount === 0) {
    await Table.insertMany(Array.from({ length: 8 }, (_, i) => ({
      number: i + 1, name: `Table ${i + 1}`, seats: 4, active: true,
    })));
    console.log('  tables: created 8 (Table 1..Table 8)');
  } else {
    console.log(`  tables: already exist (${tCount})`);
  }

  // ---- Menu ----
  const menuCount = await MenuItem.countDocuments();
  console.log(`  menu before seed: ${menuCount} items`);
  let created = 0, updated = 0, skipped = 0;
  for (const m of SEED_MENU) {
    const existing = await MenuItem.findOne({ name: m.name });
    const image = cloudinaryUrl(m.slug);
    if (existing) {
      existing.description = m.description;
      existing.category = m.category;
      existing.price = m.price;
      existing.veg = m.veg;
      existing.prepTime = m.prepTime;
      existing.image = image;
      await existing.save();
      updated++;
    } else {
      await MenuItem.create({
        name: m.name, description: m.description, category: m.category,
        price: m.price, image, available: true, veg: m.veg, prepTime: m.prepTime,
      });
      created++;
    }
  }
  console.log(`  menu after seed: ${created} created, ${updated} updated, ${skipped} skipped (total ${SEED_MENU.length})`);

  // Print category breakdown.
  const agg = await MenuItem.aggregate([
    { $group: { _id: '$category', count: { $sum: 1 }, min: { $min: '$price' }, max: { $max: '$price' } } },
    { $sort: { _id: 1 } },
  ]);
  console.log('\nMenu by category:');
  for (const a of agg) {
    console.log(`  ${a._id.padEnd(14)} ${a.count} items, ₹${a.min}–₹${a.max}`);
  }

  await mongoose.disconnect();
  console.log('\nDone.');
}

main().catch((e) => {
  console.error('Seed failed:', e);
  process.exit(1);
});
