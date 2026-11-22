import { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { uploadImage } from '@/lib/cloudinary';
import { ok, fail, unauthorized, forbidden } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * POST /api/upload
 * Body: { dataUri: 'data:image/png;base64,...', folder?: 'menu' | 'staff' }
 * Admin-only: uploads an image to Cloudinary and returns its secure URL.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'admin') return forbidden();

  const { dataUri, folder } = await req.json();
  if (!dataUri || typeof dataUri !== 'string' || !dataUri.startsWith('data:image')) {
    return fail('A valid data:image/... dataUri is required', 422);
  }
  try {
    const url = await uploadImage(dataUri, folder || 'restaurant');
    return ok({ url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Upload failed';
    return fail(msg, 500);
  }
}
