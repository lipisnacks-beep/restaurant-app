'use client';
import { useState, useRef, useMemo } from 'react';
import { api } from '@/lib/apiClient';
import { toast } from 'sonner';
import {
  Save, Upload, Loader2, Trash2, ImageIcon, Store, Phone, Mail, MapPin,
  Receipt, Percent, Coins, Clock, CreditCard, Link2, Check, CalendarDays,
} from 'lucide-react';
import type { RestaurantSettings, DayKey } from '@/lib/settings';

interface Props {
  initialSettings: RestaurantSettings;
}

const DAYS: { key: DayKey; label: string }[] = [
  { key: 'mon', label: 'Mon' }, { key: 'tue', label: 'Tue' }, { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' }, { key: 'fri', label: 'Fri' }, { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
];

type TabKey = 'brand' | 'contact' | 'billing' | 'hours' | 'payment' | 'links';
const TABS: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'brand', label: 'Brand', icon: Store },
  { key: 'contact', label: 'Contact', icon: Phone },
  { key: 'billing', label: 'Billing', icon: Receipt },
  { key: 'hours', label: 'Hours', icon: Clock },
  { key: 'payment', label: 'Payments', icon: CreditCard },
  { key: 'links', label: 'Links', icon: Link2 },
];

/**
 * Admin → Settings tab.
 *
 * Comprehensive, dynamic restaurant/cafe configuration. The admin edits the
 * brand (name + tagline + logo), contact details, billing policy (currency +
 * tax + service charge), weekly operating hours, accepted payment methods and
 * external links. Everything is saved through PUT /api/settings (admin only),
 * which also uploads the logo to Cloudinary and invalidates the server cache so
 * the new values appear app-wide on the next render.
 */
export default function AdminSettingsClient({ initialSettings }: Props) {
  const [s, setS] = useState<RestaurantSettings>(initialSettings);
  const [tab, setTab] = useState<TabKey>('brand');
  const [uploading, setUploading] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /** PATCH a partial settings update; on success merge the returned doc. */
  async function patch(patchBody: Record<string, unknown>, key: string, okMsg: string) {
    setSavingKey(key);
    const { data, error, ok } = await api<RestaurantSettings>('/api/settings', {
      method: 'PUT', body: JSON.stringify(patchBody),
    });
    setSavingKey(null);
    if (!ok) { toast.error(error || 'Could not save'); return; }
    if (data) setS(data);
    toast.success(okMsg);
  }

  function set<K extends keyof RestaurantSettings>(k: K, v: RestaurantSettings[K]) {
    setS((prev) => ({ ...prev, [k]: v }));
  }

  // --- Brand logo upload (immediate, like before) ---
  function onPickLogo(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please choose an image file'); return; }
    if (file.size > 4 * 1024 * 1024) { toast.error('Logo must be under 4 MB'); return; }
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUri = reader.result as string;
      const { data, error, ok } = await api<RestaurantSettings>('/api/settings', {
        method: 'PUT', body: JSON.stringify({ logoDataUri: dataUri }),
      });
      setUploading(false);
      if (!ok) { toast.error(error || 'Logo upload failed'); return; }
      if (data) setS(data);
      toast.success('Logo updated');
    };
    reader.onerror = () => { setUploading(false); toast.error('Could not read the file'); };
    reader.readAsDataURL(file);
  }

  function removeLogo() {
    if (!s.logoUrl) return;
    patch({ logoUrl: null }, 'logo', 'Logo removed');
  }

  const brandDirty = useMemo(
    () => s.restaurantName.trim() !== initialSettings.restaurantName.trim()
      || s.tagline.trim() !== initialSettings.tagline.trim(),
    [s.restaurantName, s.tagline, initialSettings]
  );

  return (
    <div className="space-y-6">
      {/* Heading */}
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Settings</h1>
        <p className="text-sm text-gray-500">
          Configure your restaurant / cafe. Changes appear app-wide — on the home page, customer
          menu, bills and every portal header.
        </p>
      </div>

      {/* ===== Attractive compact brand hero ===== */}
      <div className="card overflow-hidden p-0">
        <div className="bg-gradient-to-r from-brand-600 to-brand-700 p-5 text-white">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            {/* Logo tile */}
            <div className="shrink-0 flex items-center gap-4">
              <div className="w-20 h-20 rounded-xl bg-white/95 ring-2 ring-white/40 flex items-center justify-center overflow-hidden shadow-lg">
                {s.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.logoUrl} alt="logo" className="w-full h-full object-contain p-1" />
                ) : (
                  <ImageIcon className="w-9 h-9 text-gray-300" />
                )}
              </div>
              <div className="flex flex-col gap-1.5 sm:hidden">
                <LogoButtons />
              </div>
            </div>
            {/* Name + tagline + desktop logo buttons */}
            <div className="flex-1 min-w-0">
              <input
                type="text"
                value={s.restaurantName}
                onChange={(e) => set('restaurantName', e.target.value)}
                maxLength={60}
                placeholder="Restaurant / Cafe name"
                className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-xl font-bold text-white placeholder-white/50 focus:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/40"
              />
              <input
                type="text"
                value={s.tagline}
                onChange={(e) => set('tagline', e.target.value)}
                maxLength={120}
                placeholder="Tagline (shown under the name)"
                className="mt-2 w-full bg-white/10 border border-white/20 rounded-lg px-3 py-1.5 text-sm text-brand-50 placeholder-white/40 focus:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/40"
              />
            </div>
            <div className="hidden sm:flex sm:flex-col gap-1.5">
              <LogoButtons />
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-xs text-brand-100">
              {s.restaurantName.trim().length}/60 chars · shown on the home page, customer menu &amp; portal headers
            </p>
            <button
              onClick={() => patch(
                { restaurantName: s.restaurantName.trim(), tagline: s.tagline.trim() },
                'brand', 'Brand updated'
              )}
              disabled={uploading || savingKey === 'brand' || !brandDirty}
              className="btn-primary bg-white text-brand-700 hover:bg-brand-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {savingKey === 'brand' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save brand
            </button>
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={(e) => onPickLogo(e.target.files?.[0])}
          className="hidden"
        />
      </div>

      {/* ===== Tab bar ===== */}
      <div className="card p-2">
        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition ${
                  active ? 'bg-brand-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <t.icon className="w-4 h-4" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ===== Tab content ===== */}
      {tab === 'contact' && (
        <Card icon={Phone} title="Contact details" desc="Shown to customers and on receipts where relevant.">
          <Field label="Phone" icon={Phone}>
            <input className="input" value={s.phone} onChange={(e) => set('phone', e.target.value)} maxLength={30} placeholder="e.g. +91 98765 43210" />
          </Field>
          <Field label="Email" icon={Mail}>
            <input className="input" value={s.email} onChange={(e) => set('email', e.target.value)} maxLength={120} placeholder="e.g. hello@restaurant.com" />
          </Field>
          <Field label="Address" icon={MapPin}>
            <textarea className="input" rows={2} value={s.address} onChange={(e) => set('address', e.target.value)} maxLength={300} placeholder="Street, city, postcode" />
          </Field>
          <SaveRow saving={savingKey === 'contact'} onClick={() => patch(
            { phone: s.phone, email: s.email, address: s.address }, 'contact', 'Contact details saved'
          )} />
        </Card>
      )}

      {tab === 'billing' && (
        <Card icon={Receipt} title="Billing policy" desc="Currency symbol, tax and service charge applied to every customer bill.">
          <div className="grid sm:grid-cols-3 gap-4">
            <Field label="Currency symbol" icon={Coins}>
              <input className="input" value={s.currencySymbol} onChange={(e) => set('currencySymbol', e.target.value)} maxLength={4} placeholder="₹" />
            </Field>
            <Field label="Tax rate (%)" icon={Percent}>
              <input type="number" min={0} max={100} step="0.5" className="input" value={s.taxRate}
                onChange={(e) => set('taxRate', Number(e.target.value))} placeholder="0" />
            </Field>
            <Field label="Service charge (%)" icon={Percent}>
              <input type="number" min={0} max={100} step="0.5" className="input" value={s.serviceChargeRate}
                onChange={(e) => set('serviceChargeRate', Number(e.target.value))} placeholder="0" />
            </Field>
          </div>
          <div className="mt-3 p-3 rounded-lg bg-gray-50 text-xs text-gray-600">
            <Receipt className="w-3.5 h-3.5 inline mr-1" />
            Bill = subtotal + {s.taxRate}% tax + {s.serviceChargeRate}% service charge. A rate of 0 hides that line on the bill.
          </div>
          <SaveRow saving={savingKey === 'billing'} onClick={() => patch(
            { currencySymbol: s.currencySymbol, taxRate: s.taxRate, serviceChargeRate: s.serviceChargeRate },
            'billing', 'Billing policy saved'
          )} />
        </Card>
      )}

      {tab === 'hours' && (
        <Card icon={Clock} title="Operating hours" desc="Weekly hours. Leave a field empty to mark the day closed.">
          <div className="space-y-2">
            {DAYS.map((d) => {
              const day = s.hours[d.key];
              const closed = !day.open && !day.close;
              return (
                <div key={d.key} className="flex items-center gap-3">
                  <div className="w-12 flex items-center gap-1.5 text-sm font-medium text-gray-700">
                    <CalendarDays className="w-3.5 h-3.5 text-gray-400" />{d.label}
                  </div>
                  <input
                    type="time"
                    className="input flex-1"
                    value={day.open}
                    onChange={(e) => set('hours', { ...s.hours, [d.key]: { ...day, open: e.target.value } })}
                  />
                  <span className="text-gray-400 text-sm">to</span>
                  <input
                    type="time"
                    className="input flex-1"
                    value={day.close}
                    onChange={(e) => set('hours', { ...s.hours, [d.key]: { ...day, close: e.target.value } })}
                  />
                  <span className={`badge ${closed ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'} shrink-0 w-16 justify-center`}>
                    {closed ? 'Closed' : 'Open'}
                  </span>
                </div>
              );
            })}
          </div>
          <SaveRow saving={savingKey === 'hours'} onClick={() => patch({ hours: s.hours }, 'hours', 'Operating hours saved')} />
        </Card>
      )}

      {tab === 'payment' && (
        <Card icon={CreditCard} title="Payment methods" desc="Which payment options the customer sees at checkout. At least one must be enabled.">
          <div className="grid sm:grid-cols-3 gap-3">
            {([['cash', 'Cash', Coins], ['upi', 'UPI / GPay', Receipt], ['card', 'Card', CreditCard]] as const).map(([key, label, Icon]) => {
              const on = s.paymentMethods[key];
              return (
                <button
                  key={key}
                  onClick={() => set('paymentMethods', { ...s.paymentMethods, [key]: !on })}
                  className={`flex items-center gap-3 p-3 rounded-lg border-2 transition ${
                    on ? 'border-brand-500 bg-brand-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${on ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className={`font-medium ${on ? 'text-brand-700' : 'text-gray-600'}`}>{label}</span>
                  <span className={`ml-auto w-5 h-5 rounded-full border-2 flex items-center justify-center ${on ? 'border-brand-500 bg-brand-500' : 'border-gray-300'}`}>
                    {on && <Check className="w-3 h-3 text-white" />}
                  </span>
                </button>
              );
            })}
          </div>
          {s.paymentMethods.upi && (
            <Field label="UPI ID (shown to customer at checkout)" icon={Receipt} className="mt-4">
              <input className="input" value={s.upiId} onChange={(e) => set('upiId', e.target.value)} maxLength={60} placeholder="e.g. restaurant@upi" />
            </Field>
          )}
          <SaveRow saving={savingKey === 'payment'} onClick={() => patch(
            { paymentMethods: s.paymentMethods, upiId: s.upiId }, 'payment', 'Payment methods saved'
          )} />
        </Card>
      )}

      {tab === 'links' && (
        <Card icon={Link2} title="External links" desc="Google review redirect, website and social profiles.">
          <Field label="Google review URL" icon={Link2}>
            <input className="input" value={s.googleReviewUrl} onChange={(e) => set('googleReviewUrl', e.target.value)} maxLength={500} placeholder="https://search.google.com/local/writereview?placeid=…" />
          </Field>
          <Field label="Website" icon={Link2}>
            <input className="input" value={s.websiteUrl} onChange={(e) => set('websiteUrl', e.target.value)} maxLength={500} placeholder="https://your-restaurant.com" />
          </Field>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Instagram" icon={Link2}>
              <input className="input" value={s.instagramUrl} onChange={(e) => set('instagramUrl', e.target.value)} maxLength={500} placeholder="https://instagram.com/…" />
            </Field>
            <Field label="Facebook" icon={Link2}>
              <input className="input" value={s.facebookUrl} onChange={(e) => set('facebookUrl', e.target.value)} maxLength={500} placeholder="https://facebook.com/…" />
            </Field>
          </div>
          <SaveRow saving={savingKey === 'links'} onClick={() => patch(
            { googleReviewUrl: s.googleReviewUrl, websiteUrl: s.websiteUrl, instagramUrl: s.instagramUrl, facebookUrl: s.facebookUrl },
            'links', 'Links saved'
          )} />
        </Card>
      )}
    </div>
  );

  // --- inline helpers (close over component state) ---

  function LogoButtons() {
    return (
      <>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading || !!savingKey}
          className="btn-primary bg-white text-brand-700 hover:bg-brand-50 disabled:opacity-50 text-xs px-3 py-1.5 flex items-center gap-1.5"
        >
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          {uploading ? 'Uploading…' : s.logoUrl ? 'Change' : 'Upload'}
        </button>
        {s.logoUrl && (
          <button
            onClick={removeLogo}
            disabled={!!savingKey}
            className="btn-ghost bg-white/10 text-white hover:bg-white/20 disabled:opacity-50 text-xs px-3 py-1.5 flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" /> Remove
          </button>
        )}
      </>
    );
  }
}

// ---------- small presentational helpers ----------

function Card({ icon: Icon, title, desc, children }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string; desc: string; children: React.ReactNode;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-9 h-9 rounded-lg bg-brand-100 text-brand-700 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4" />
        </div>
        <div>
          <h2 className="font-semibold text-gray-800 leading-tight">{title}</h2>
          <p className="text-xs text-gray-500">{desc}</p>
        </div>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, icon: Icon, children, className = '' }: {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="flex items-center gap-1.5 text-xs font-medium text-gray-600 mb-1">
        {Icon && <Icon className="w-3.5 h-3.5 text-gray-400" />}
        {label}
      </span>
      {children}
    </label>
  );
}

function SaveRow({ saving, onClick }: { saving: boolean; onClick: () => void }) {
  return (
    <div className="flex justify-end pt-2">
      <button
        onClick={onClick}
        disabled={saving}
        className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Save changes
      </button>
    </div>
  );
}
