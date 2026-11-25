'use client';
import { useState, useRef } from 'react';
import { api } from '@/lib/apiClient';
import { toast } from 'sonner';
import { Save, Upload, Loader2, Trash2, ImageIcon, Store } from 'lucide-react';
import type { BrandSettings } from '@/components/ui/Brand';

interface Props {
  initialBrand: BrandSettings;
}

/**
 * Admin → Settings tab.
 *
 * Lets the admin change the restaurant/cafe NAME and LOGO. The logo is uploaded
 * to Cloudinary (server-side, via PUT /api/settings) and the resulting URL is
 * stored in the singleton Settings document. The name + logo then appear
 * everywhere the brand is rendered (home page, customer menu, all portal
 * headers) on the next page load — the server-side getSettings() cache is
 * invalidated on save.
 */
export default function AdminSettingsClient({ initialBrand }: Props) {
  const [name, setName] = useState(initialBrand.restaurantName);
  const [logoUrl, setLogoUrl] = useState<string | null>(initialBrand.logoUrl);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // --- logo: read the chosen file as a data URI, then PUT it to /api/settings
  //     so the server uploads to Cloudinary and stores the URL atomically. ---
  function onPickLogo(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file');
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      toast.error('Logo must be under 4 MB');
      return;
    }
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUri = reader.result as string;
      // Upload immediately and persist the returned URL — the name is saved
      // separately when the admin clicks "Save changes".
      const { data, error, ok } = await api<{ logoUrl: string | null }>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ logoDataUri: dataUri }),
      });
      setUploading(false);
      if (!ok) { toast.error(error || 'Logo upload failed'); return; }
      setLogoUrl(data!.logoUrl);
      toast.success('Logo updated');
    };
    reader.onerror = () => { setUploading(false); toast.error('Could not read the file'); };
    reader.readAsDataURL(file);
  }

  async function removeLogo() {
    if (!logoUrl) return;
    setSaving(true);
    const { error, ok } = await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ logoUrl: null }),
    });
    setSaving(false);
    if (!ok) { toast.error(error || 'Could not remove logo'); return; }
    setLogoUrl(null);
    toast.success('Logo removed');
  }

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed) { toast.error('Restaurant name cannot be empty'); return; }
    if (trimmed.length > 60) { toast.error('Name must be 60 characters or fewer'); return; }
    setSaving(true);
    const { error, ok } = await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ restaurantName: trimmed }),
    });
    setSaving(false);
    if (!ok) { toast.error(error || 'Could not save name'); return; }
    toast.success('Restaurant name updated');
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Settings</h1>
        <p className="text-sm text-gray-500">
          Change the restaurant / cafe name and logo. These appear on the home page, customer menu
          and every portal header.
        </p>
      </div>

      {/* Live preview */}
      <div className="card p-5">
        <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
          <Store className="w-4 h-4" /> Live preview
        </h2>
        <div className="flex items-center gap-3 p-4 rounded-lg bg-gradient-to-r from-brand-600 to-brand-700 text-white">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt="logo"
              className="w-10 h-10 rounded-md object-contain bg-white/95 p-1 ring-1 ring-white/40"
            />
          ) : (
            <ImageIcon className="w-10 h-10 p-1 rounded-md bg-white/10" />
          )}
          <div>
            <p className="font-semibold leading-tight">{name || 'Restaurant name'}</p>
            <p className="text-[11px] text-brand-100">This is how customers see your brand</p>
          </div>
        </div>
      </div>

      {/* Restaurant name */}
      <div className="card p-5">
        <h2 className="font-semibold text-gray-800 mb-3">Restaurant / Cafe name</h2>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            placeholder="e.g. Lipi Snacks"
            className="input flex-1"
          />
          <button
            onClick={saveName}
            disabled={saving || uploading || name.trim() === initialBrand.restaurantName.trim()}
            className="btn-primary sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save name
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">{name.trim().length}/60 characters</p>
      </div>

      {/* Logo */}
      <div className="card p-5">
        <h2 className="font-semibold text-gray-800 mb-3">Logo</h2>
        <div className="flex flex-col sm:flex-row items-start gap-5">
          <div className="w-32 h-32 rounded-lg border-2 border-dashed border-gray-200 flex items-center justify-center bg-gray-50 overflow-hidden shrink-0">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="logo" className="w-full h-full object-contain" />
            ) : (
              <ImageIcon className="w-12 h-12 text-gray-300" />
            )}
          </div>
          <div className="flex-1 space-y-3 w-full">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={(e) => onPickLogo(e.target.files?.[0])}
              className="hidden"
            />
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading || saving}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {uploading ? 'Uploading…' : logoUrl ? 'Change logo' : 'Upload logo'}
              </button>
              {logoUrl && (
                <button
                  onClick={removeLogo}
                  disabled={saving}
                  className="btn-ghost text-red-600 hover:bg-red-50 disabled:opacity-50 flex items-center gap-2"
                >
                  <Trash2 className="w-4 h-4" /> Remove
                </button>
              )}
            </div>
            <p className="text-xs text-gray-500">
              PNG, JPG or SVG · up to 4 MB · square or near-square works best. The logo is uploaded
              to Cloudinary and shown wherever the brand appears.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
