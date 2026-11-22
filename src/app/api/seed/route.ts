import { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import User from '@/models/User';
import Table from '@/models/Table';
import MenuItem from '@/models/MenuItem';
import { ok } from '@/lib/utils';
import { SEED_MENU } from '@/lib/menuData';

export const dynamic = 'force-dynamic';

/**
 * POST /api/seed
 * Idempotent: creates the default admin/chef/staff accounts, 8 tables and a
 * full restaurant menu (33 dishes across 8 categories, Indian pricing) if missing.
 *
 * Menu item images are fetched live from Cloudinary using predictable public_ids
 * of the form `restaurant/menu/<slug>`. The slug list lives in src/lib/menuData.ts.
 * The actual image upload is done once from the deployment step (see DEPLOY_VERCEL.md
 * "Step 5 — Seed"); the seed endpoint itself does NOT need local image files.
 *
 * NOTE: we pass the *plaintext* password to User.create(); the User model's
 * pre('save') hook hashes it for us. Do NOT pre-hash here (double-hash bug).
 *
 * Query params:
 *   ?menu=1   force re-seed menu even if some items already exist (useful for
 *             refreshing after adding new dishes to menuData.ts)
 */
const DEFAULTS = [
  { name: 'Admin', email: 'admin@restaurant.com', password: 'admin123', role: 'admin' },
  { name: 'Head Chef', email: 'chef@restaurant.com', password: 'chef123', role: 'chef' },
  { name: 'Service Staff', email: 'staff@restaurant.com', password: 'staff123', role: 'staff' },
] as const;

// Cloudinary base URL — images are served directly from Cloudinary's CDN.
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || '';
function cloudinaryUrl(slug: string): string {
  // Use the same transformation as the cloudinary lib (w_800,h_600,limit,q_auto).
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/c_limit,w_800,h_600,q_auto/v1/restaurant/menu/${slug}`;
}

async function seedMenu(force: boolean) {
  const created: string[] = [];
  let skipped = 0;
  for (const m of SEED_MENU) {
    const existing = await MenuItem.findOne({ name: m.name });
    if (existing && !force) {
      skipped++;
      continue;
    }
    const image = cloudinaryUrl(m.slug);
    if (existing && force) {
      // Update existing item with latest data + image.
      existing.description = m.description;
      existing.category = m.category;
      existing.price = m.price;
      existing.veg = m.veg;
      existing.prepTime = m.prepTime;
      existing.image = image;
      await existing.save();
      created.push(`${m.name} (updated)`);
    } else {
      await MenuItem.create({
        name: m.name,
        description: m.description,
        category: m.category,
        price: m.price,
        image,
        available: true,
        veg: m.veg,
        prepTime: m.prepTime,
      });
      created.push(`${m.name} (created)`);
    }
  }
  return { created, skipped, total: SEED_MENU.length };
}

export async function POST(req: NextRequest) {
  await dbConnect();
  const result: {
    users: string[];
    tables: string;
    menu?: { created: string[]; skipped: number; total: number };
  } = { users: [], tables: '' };

  for (const d of DEFAULTS) {
    const existing = await User.findOne({ email: d.email });
    if (existing) {
      result.users.push(`${d.email} (already exists)`);
      continue;
    }
    await User.create({
      name: d.name, email: d.email, password: d.password, role: d.role, active: true,
    });
    result.users.push(`${d.email} (created)`);
  }

  const tableCount = await Table.countDocuments();
  if (tableCount === 0) {
    const tables = Array.from({ length: 8 }, (_, i) => ({
      number: i + 1, name: `Table ${i + 1}`, seats: 4, active: true,
    }));
    await Table.insertMany(tables);
    result.tables = 'Created 8 tables (Table 1 .. Table 8).';
  } else {
    result.tables = `Tables already exist (${tableCount}).`;
  }

  // Seed menu (idempotent unless ?menu=1).
  const url = new URL(req.url);
  const forceMenu = url.searchParams.get('menu') === '1';
  const menuCount = await MenuItem.countDocuments();
  if (menuCount === 0 || forceMenu) {
    result.menu = await seedMenu(forceMenu);
  } else {
    result.menu = { created: [], skipped: menuCount, total: SEED_MENU.length };
  }

  return ok(result);
}

// Allow GET so it can be triggered from a browser too.
export async function GET(req: NextRequest) {
  return POST(req);
}
