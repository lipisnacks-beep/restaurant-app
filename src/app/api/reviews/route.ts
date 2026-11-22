import { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import Review from '@/models/Review';
import { getSession } from '@/lib/auth';
import { ok, fail } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// GET /api/reviews  -> list reviews (admin dashboard)
export async function GET(req: NextRequest) {
  await dbConnect();
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get('limit') || '50'), 200);
  const reviews = await Review.find().sort({ createdAt: -1 }).limit(limit).lean();

  // Compute average ratings
  const agg = await Review.aggregate([
    { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  const summary = agg[0] || { avg: 0, count: 0 };

  return ok({ reviews, summary });
}

// POST /api/reviews  -> customer submits a review after eating
export async function POST(req: NextRequest) {
  await dbConnect();
  const body = await req.json();
  const { order, tableNumber, customerName, rating, foodRating, serviceRating, ambianceRating, comment } = body || {};
  if (!rating || rating < 1 || rating > 5) return fail('rating (1-5) is required', 422);

  const review = await Review.create({
    order: order || undefined,
    tableNumber: tableNumber || undefined,
    customerName: customerName || 'Anonymous',
    rating: Number(rating),
    foodRating: Number(foodRating) || 0,
    serviceRating: Number(serviceRating) || 0,
    ambianceRating: Number(ambianceRating) || 0,
    comment: comment || '',
    postedToGoogle: false,
  });

  // Provide the Google review URL so the frontend can redirect the customer.
  const googleUrl = process.env.GOOGLE_REVIEW_URL || '';
  return ok({ review, googleReviewUrl: googleUrl });
}
