'use client';
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/apiClient';
import { formatDate } from '@/lib/utils';
import { Star, Loader2, RefreshCw } from 'lucide-react';

interface Review {
  _id: string; customerName: string; rating: number;
  foodRating: number; serviceRating: number; ambianceRating: number;
  comment: string; tableNumber?: number; createdAt: string; postedToGoogle: boolean;
}

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={`w-3.5 h-3.5 ${i <= value ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`} />
      ))}
    </span>
  );
}

export default function AdminReviewsClient() {
  const [reviews, setReviews] = useState<Review[]>([]);
  // summary comes from a server-side aggregate over ALL reviews (not the
  // page-limited list), so the cards stay correct when reviews exceed the
  // 100-row display limit.
  const [summary, setSummary] = useState({
    avg: 0, count: 0, googlePosts: 0, foodAvg: 0, serviceAvg: 0, ambianceAvg: 0,
  });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, ok } = await api<{
      reviews: Review[];
      summary: { avg: number; count: number; googlePosts: number; foodAvg: number; serviceAvg: number; ambianceAvg: number };
    }>('/api/reviews?limit=100');
    if (ok && data) {
      setReviews(data.reviews);
      setSummary(data.summary || { avg: 0, count: 0, googlePosts: 0, foodAvg: 0, serviceAvg: 0, ambianceAvg: 0 });
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Reviews &amp; Ratings</h1>
          <p className="text-sm text-gray-500">Customer feedback collected in-app and pushed to Google.</p>
        </div>
        <button onClick={load} className="btn-secondary text-sm">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card p-4">
          <p className="text-xs text-gray-500">Average Rating (all-time)</p>
          <p className="text-2xl font-bold text-amber-600">{(summary.avg || 0).toFixed(1)} ★</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500">Total Reviews</p>
          <p className="text-2xl font-bold text-gray-800">{summary.count || 0}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500">Google Posts</p>
          {/* Use the server aggregate (all reviews), not the page-limited list. */}
          <p className="text-2xl font-bold text-sky-600">{summary.googlePosts || 0}</p>
        </div>
      </div>

      {loading ? (
        <div className="text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : reviews.length === 0 ? (
        <div className="card p-8 text-center text-gray-500">No reviews yet.</div>
      ) : (
        <div className="space-y-3">
          {reviews.map((r) => (
            <div key={r._id} className="card p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="font-semibold text-gray-800">{r.customerName || 'Anonymous'}</p>
                  <p className="text-xs text-gray-500">
                    {r.tableNumber ? `Table ${r.tableNumber} · ` : ''}{formatDate(r.createdAt)}
                  </p>
                </div>
                <Stars value={r.rating} />
              </div>
              {r.comment && <p className="text-sm text-gray-700 mt-2">{r.comment}</p>}
              <div className="mt-3 flex gap-4 text-xs text-gray-500">
                {r.foodRating > 0 && <span>Food: {r.foodRating}/5</span>}
                {r.serviceRating > 0 && <span>Service: {r.serviceRating}/5</span>}
                {r.ambianceRating > 0 && <span>Ambiance: {r.ambianceRating}/5</span>}
                {r.postedToGoogle && <span className="text-sky-600">✓ Posted to Google</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
