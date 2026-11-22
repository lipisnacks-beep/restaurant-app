import { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import MenuItem from '@/models/MenuItem';
import { getSession } from '@/lib/auth';
import { ok, fail, unauthorized, forbidden } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// GET /api/menu  -> public list of menu items
export async function GET(req: NextRequest) {
  await dbConnect();
  const { searchParams } = new URL(req.url);
  const onlyAvailable = searchParams.get('available') === 'true';
  const category = searchParams.get('category');

  const filter: Record<string, unknown> = {};
  if (onlyAvailable) filter.available = true;
  if (category) filter.category = category;

  const items = await MenuItem.find(filter).sort({ category: 1, name: 1 }).lean();
  return ok({ items });
}

// POST /api/menu  -> admin creates a menu item
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'admin') return forbidden();

  await dbConnect();
  const body = await req.json();
  const { name, description, category, price, image, available, veg, prepTime } = body || {};
  if (!name || !category || price === undefined) {
    return fail('name, category and price are required', 422);
  }
  const item = await MenuItem.create({
    name,
    description: description || '',
    category,
    price: Number(price),
    image: image || '',
    available: available !== false,
    veg: veg !== false,
    prepTime: prepTime || 15,
  });
  return ok({ item });
}
