import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import Review from '@/models/Review';
import CustomerSession from '@/models/CustomerSession';
import Table from '@/models/Table';
import Order from '@/models/Order';
import {
  getSession,
  resolveCustomerSessionId,
  getCustomerSessionId,
  clearCustomerSessionCookie,
} from '@/lib/auth';
import { ok, fail, serverError } from '@/lib/utils';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

// GET /api/reviews  -> list reviews (admin dashboard)
export async function GET(req: NextRequest) {
  try {
    await dbConnect();
    const { searchParams } = new URL(req.url);
    const limit = Math.min(Number(searchParams.get('limit') || '50'), 200);
    const reviews = await Review.find().sort({ createdAt: -1 }).limit(limit).lean();

    // Compute ALL-TIME summary aggregates over the WHOLE collection (not the
    // page-limited list). Previously the admin's "Google Posts" card counted
    // postedToGoogle only across the displayed 100 reviews, under-reporting
    // whenever reviews exceeded the limit. Now googlePosts comes from the
    // aggregate so it matches "Total Reviews".
    const agg: any[] = await Review.aggregate([
      {
        $group: {
          _id: null,
          avg: { $avg: '$rating' },
          count: { $sum: 1 },
          googlePosts: { $sum: { $cond: ['$postedToGoogle', 1, 0] } },
          foodAvg: { $avg: '$foodRating' },
          serviceAvg: { $avg: '$serviceRating' },
          ambianceAvg: { $avg: '$ambianceRating' },
        },
      },
    ]);
    const summary = agg[0] || { avg: 0, count: 0, googlePosts: 0, foodAvg: 0, serviceAvg: 0, ambianceAvg: 0 };

    return ok({ reviews, summary });
  } catch (err) {
    return serverError(err);
  }
}

/**
 * POST /api/reviews  -> customer submits a review after eating
 *
 * Marks the customer's dining session as `completed` (reviewAt set) and
 * clears the rms_customer_session cookie so the next scan starts fresh.
 * The table is NOT auto-freed here — staff confirm the table is physically
 * cleared and then free it from the staff portal.
 */
export async function POST(req: NextRequest) {
  await dbConnect();
  const body = await req.json();
  const {
    order, tableNumber, customerName, rating, foodRating, serviceRating,
    ambianceRating, comment,
  } = body || {};
  if (!rating || rating < 1 || rating > 5) return fail('rating (1-5) is required', 422);

  // Resolve the customer dining session from the cookie (if any).
  const custSessionId = await resolveCustomerSessionId(req);
  let custSession: any = null;
  let customerId: string | undefined;
  let mobile: string | undefined;
  if (custSessionId) {
    custSession = await CustomerSession.findOne({ sessionId: custSessionId });
    if (custSession) {
      customerId = String(custSession.customer);
      mobile = custSession.mobile;
    }
  }

  const review = await Review.create({
    order: order || undefined,
    session: custSession?._id || undefined,
    tableNumber: tableNumber || custSession?.tableNumber || undefined,
    customer: customerId || undefined,
    customerName: customerName || custSession?.customerName || 'Anonymous',
    mobile: mobile || '',
    rating: Number(rating),
    foodRating: Number(foodRating) || 0,
    serviceRating: Number(serviceRating) || 0,
    ambianceRating: Number(ambianceRating) || 0,
    comment: comment || '',
    postedToGoogle: false,
  });

  // Mark the dining session completed and the table's sessionStatus too.
  if (custSession) {
    custSession.status = 'completed';
    custSession.reviewAt = new Date();
    await custSession.save();
    await Table.updateOne(
      { _id: custSession.table },
      { $set: { 'currentSession.sessionStatus': 'completed' } },
    );
  }

  // Provide the Google review URL so the frontend can redirect the customer.
  // Prefer the admin-configured Settings value; fall back to the env var so
  // existing deployments keep working.
  const settings = await getSettings();
  const googleUrl = settings.googleReviewUrl || process.env.GOOGLE_REVIEW_URL || '';
  const res = NextResponse.json({
    review,
    googleReviewUrl: googleUrl,
    sessionClosed: !!custSession,
  }, { status: 200 });

  // End the customer's dining session cookie now that the meal+review is done.
  clearCustomerSessionCookie(res);
  return res;
}
