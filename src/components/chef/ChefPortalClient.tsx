'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { api, getTabUser, getTabToken, clearTabIdentity } from '@/lib/apiClient';
import { toast } from 'sonner';
import { timeAgo } from '@/lib/utils';
import { useBrand } from '@/components/ui/Brand';
import {
  ChefHat, Flame, CheckCircle2, Loader2, Clock, LogOut, Bell,
  BellRing, Volume2, VolumeX, UserCog, Coins,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { formatCurrency } from '@/lib/utils';

interface OrderItem { name: string; quantity: number; note?: string; price: number }
interface Order {
  _id: string; orderNumber: string; tableNumber: number;
  items: OrderItem[]; status: string; createdAt: string; customerName?: string; notes?: string;
  assignedAt?: string | null;  // when the dispatch engine routed this order to THIS chef
}

const RINGTONE_URL = '/sounds/new-order.wav';
// Poll every 3s. The API response carries `Cache-Control: no-store` and the
// client fetch uses `cache: 'no-store'`, so every poll hits the DB and sees
// freshly accepted/claimed orders immediately — no stale cached snapshots.
const POLL_MS = 3000;

export default function ChefPortalClient() {
  const router = useRouter();
  const brand = useBrand();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // --- Per-tab chef identity ---
  // Each browser tab carries its own identity token (sessionStorage), so two
  // chefs logging in on the same browser keep separate identities. We surface
  // the signed-in chef's name in the header so it's visually obvious which
  // chef this tab belongs to. If a tab somehow reaches the portal without a
  // per-tab token (e.g. opened the URL directly), bounce to login to
  // establish one — the shared cookie alone is NOT enough identity.
  const [chefName, setChefName] = useState<string>('');
  const [tipsAvailable, setTipsAvailable] = useState(0);  // withdrawable tips balance (50/50 split on cooked orders)

  useEffect(() => {
    const token = getTabToken();
    const user = getTabUser<{ name?: string; email?: string; role?: string }>();
    if (!token || !user || user.role !== 'chef') {
      router.replace('/chef/login');
      return;
    }
    setChefName(user.name || user.email || 'Chef');
    // Load the chef's withdrawable tips balance for the header badge.
    api<{ user?: { tipsAvailable?: number } }>('/api/chef/account').then(({ data }) => {
      if (data?.user?.tipsAvailable != null) setTipsAvailable(data.user.tipsAvailable);
    });
  }, [router]);

  // --- Sound state ---
  // Browsers block audio playback until the user interacts with the page. We
  // show an "enable alerts" banner; the first tap runs audio.play() (resumes
  // the AudioContext) and flips `soundEnabled`. After that the ringtone plays
  // automatically whenever there are pending orders.
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [soundMuted, setSoundMuted] = useState(false);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>('unsupported');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Track previously-seen pending order ids so we only ring the bell on
  // genuinely NEW orders (not on every poll).
  const seenPendingRef = useRef<Set<string>>(new Set());
  const [ringing, setRinging] = useState(false);

  // Always-current ref to the latest `load` so other callbacks (enableAlerts,
  // action) can trigger an immediate re-sync without going stale or hitting
  // a TDZ on the deps array (load is defined below this point).
  const loadRef = useRef<() => void>(() => {});

  const playRingtone = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = 0;
    a.volume = 1.0;
    a.play().catch(() => {
      // Autoplay still blocked (no user gesture yet). The enable-alerts
      // banner stays visible so the chef can tap to unlock.
      setSoundEnabled(false);
    });
  }, []);

  const stopRingtone = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    a.pause();
    a.currentTime = 0;
  }, []);

  // One-tap unlock: a real user gesture lets us call play() and unlock audio
  // for the rest of this tab's life.
  const enableAlerts = useCallback(async () => {
    const a = audioRef.current;
    if (a) {
      a.volume = 1.0;
      try {
        await a.play();
        setSoundEnabled(true);
        // Immediately stop (we don't want to ring now, just unlock).
        a.pause();
        a.currentTime = 0;
      } catch {
        toast.error('Could not enable sound — check your browser settings.');
        return;
      }
    }
    // Ask for desktop notifications too (bonus visual cue).
    if ('Notification' in window && Notification.permission === 'default') {
      try {
        const p = await Notification.requestPermission();
        setNotifPermission(p);
      } catch { /* ignore */ }
    }
    toast.success('Order alerts enabled — you will hear new orders.');
    // Sync immediately so any pending orders that arrived while audio was
    // locked start ringing right away (don't wait for the next poll tick).
    loadRef.current();
  }, []);

  // Toggle mute (does not lose the unlock).
  const toggleMute = useCallback(() => {
    setSoundMuted((m) => {
      const next = !m;
      if (next) stopRingtone();
      return next;
    });
  }, [stopRingtone]);

  const load = useCallback(async () => {
    const { data, ok } = await api<{ orders: Order[] }>('/api/orders?role=chef');
    if (ok && data) {
      setOrders(data.orders);

      const pendingNow = data.orders.filter((o) => o.status === 'pending');
      const pendingIds = new Set(pendingNow.map((o) => o._id));

      // Detect genuinely new pending orders.
      const fresh = pendingNow.filter((o) => !seenPendingRef.current.has(o._id));
      seenPendingRef.current = pendingIds;

      if (fresh.length > 0) {
        // Fire a desktop notification (if permitted) for the first fresh order.
        if (notifPermission === 'granted') {
          try {
            new Notification('New order 🍳', {
              body: `${fresh[0].orderNumber} · Table ${fresh[0].tableNumber}`,
              tag: 'rms-new-order',
            });
          } catch { /* ignore */ }
        }
      }

      // Ring while there are pending orders (looping audio), stop when none.
      if (pendingNow.length > 0) {
        setRinging(true);
        if (soundEnabled && !soundMuted) playRingtone();
      } else {
        setRinging(false);
        stopRingtone();
      }
    }
    setLoading(false);
  }, [soundEnabled, soundMuted, playRingtone, stopRingtone, notifPermission]);

  useEffect(() => {
    // Keep the ref pointed at the latest load (so enableAlerts can trigger
    // an immediate re-sync without a stale closure).
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    // Detect Notification API support on mount.
    if (typeof Notification !== 'undefined') {
      setNotifPermission(Notification.permission);
    }
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  async function action(o: Order, act: 'start_preparing' | 'mark_ready') {
    setBusy(o._id);
    const { error, ok } = await api(`/api/orders/${o._id}`, {
      method: 'PATCH', body: JSON.stringify({ action: act }),
    });
    setBusy(null);
    if (!ok) {
      // The race message comes back as "Order is already preparing — another
      // chef just accepted it". Surface it as an info toast, not an error.
      if (act === 'start_preparing' && error && error.includes('another chef')) {
        toast.info(error);
      } else {
        toast.error(error || 'Failed');
      }
      load();
      return;
    }
    // Optimistic UI: the accepting chef stops hearing the bell immediately
    // and the order leaves their 'New Orders' column right away, without
    // waiting for the next poll. The full server refresh below reconciles
    // any edge cases.
    if (act === 'start_preparing') {
      stopRingtone();
      setRinging(false);
      setOrders((prev) => prev.filter((x) => x._id !== o._id));
    }
    toast.success(act === 'start_preparing' ? 'Order accepted — start cooking' : 'Marked ready');
    load();
  }

  const pending = orders.filter((o) => o.status === 'pending');
  const preparing = orders.filter((o) => o.status === 'preparing');

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 to-gray-50">
      {/* Hidden looping audio element. Played/paused imperatively. */}
      <audio ref={audioRef} src={RINGTONE_URL} loop preload="auto" />

      <header className="bg-gradient-to-r from-rose-600 to-rose-700 text-white sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {brand.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logoUrl} alt={`${brand.restaurantName} logo`} className="w-6 h-6 rounded-md object-contain bg-white/95 p-0.5" />
            ) : (
              <ChefHat className="w-6 h-6" />
            )}
            <div>
              <h1 className="font-semibold leading-none">{brand.restaurantName}</h1>
              <p className="text-xs text-rose-100">
                Chef Portal{chefName ? ` · ${chefName}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`badge ${ringing ? 'bg-amber-400 text-amber-950 animate-pulse' : 'bg-white/20 text-white'}`}>
              {ringing ? <BellRing className="w-3 h-3 mr-1" /> : <Bell className="w-3 h-3 mr-1" />}
              {pending.length} new
            </span>
            <Link
              href="/chef/tips"
              title="View & withdraw your tips"
              className="badge bg-amber-400/30 text-amber-50 hover:bg-amber-400/50 transition-colors"
            >
              <Coins className="w-3 h-3 mr-1" /> {formatCurrency(tipsAvailable)} tips
            </Link>
            {soundEnabled && (
              <button
                onClick={toggleMute}
                title={soundMuted ? 'Unmute alerts' : 'Mute alerts'}
                className="btn-ghost text-white hover:bg-white/10 p-2"
              >
                {soundMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
            )}
            <Link
              href="/chef/account"
              title="Account settings"
              className="btn-ghost text-white hover:bg-white/10 p-2"
            >
              <UserCog className="w-4 h-4" />
            </Link>
            <button
              onClick={() => {
                clearTabIdentity();
                api('/api/auth/logout', { method: 'POST', body: JSON.stringify({ scope: 'chef' }) });
                router.push('/');
              }}
              className="btn-ghost text-white hover:bg-white/10"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Enable-alerts banner (shown until the chef unlocks audio). */}
        {!soundEnabled && (
          <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <BellRing className="w-6 h-6 text-amber-600 shrink-0" />
              <div>
                <p className="font-semibold text-amber-900">Enable order alerts</p>
                <p className="text-sm text-amber-700">
                  Tap once so you hear a loud ringtone when a new order arrives. Browsers block sound until you interact.
                </p>
              </div>
            </div>
            <button onClick={enableAlerts} className="btn-primary shrink-0">
              <Volume2 className="w-4 h-4" /> Enable
            </button>
          </div>
        )}

        {loading ? (
          <div className="text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading orders…</div>
        ) : orders.length === 0 ? (
          <div className="card p-12 text-center">
            <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-500 mb-3" />
            <h2 className="text-lg font-semibold text-gray-800">All caught up!</h2>
            <p className="text-sm text-gray-500">No orders routed to you right now. New orders assigned to you will ring here automatically.</p>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <section>
              <h2 className="font-semibold text-gray-800 mb-1 flex items-center gap-2">
                <Clock className="w-4 h-4 text-orange-500" /> Routed to You ({pending.length})
                {pending.length > 0 && soundEnabled && !soundMuted && (
                  <span className="text-xs text-amber-600 animate-pulse">🔔 ringing</span>
                )}
              </h2>
              <p className="text-xs text-gray-500 mb-3">
                These orders were dispatched specifically to you. Accept to start cooking.
              </p>
              <div className="space-y-3">
                {pending.length === 0 && <p className="text-sm text-gray-400">None.</p>}
                {pending.map((o) => (
                  <OrderCard key={o._id} order={o} accent="border-l-orange-500" ringing>
                    <button onClick={() => action(o, 'start_preparing')} disabled={busy === o._id} className="btn-primary w-full">
                      {busy === o._id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Flame className="w-4 h-4" />}
                      Accept &amp; Start Cooking
                    </button>
                  </OrderCard>
                ))}
              </div>
            </section>

            <section>
              <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                <Flame className="w-4 h-4 text-rose-500" /> Preparing ({preparing.length})
              </h2>
              <div className="space-y-3">
                {preparing.length === 0 && <p className="text-sm text-gray-400">None.</p>}
                {preparing.map((o) => (
                  <OrderCard key={o._id} order={o} accent="border-l-rose-500">
                    <button onClick={() => action(o, 'mark_ready')} disabled={busy === o._id} className="btn bg-emerald-600 text-white hover:bg-emerald-700 w-full">
                      {busy === o._id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      Mark Ready
                    </button>
                  </OrderCard>
                ))}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function OrderCard({ order, accent, children, ringing }: {
  order: Order; accent: string; children: React.ReactNode; ringing?: boolean;
}) {
  return (
    <div className={`card p-4 border-l-4 ${accent} ${ringing ? 'ring-2 ring-amber-400 ring-offset-1' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-gray-800">{order.orderNumber}</p>
          <p className="text-sm text-gray-600">Table {order.tableNumber}{order.customerName ? ` · ${order.customerName}` : ''}</p>
        </div>
        <span className="text-xs text-gray-400">{timeAgo(order.createdAt)}</span>
      </div>
      <ul className="mt-3 space-y-1.5">
        {order.items.map((i, idx) => (
          <li key={idx} className="text-sm flex items-start gap-2">
            <span className="badge bg-brand-100 text-brand-700 shrink-0">{i.quantity}×</span>
            <div>
              <span className="font-medium text-gray-800">{i.name}</span>
              {i.note && <p className="text-xs text-orange-600">⚠ {i.note}</p>}
            </div>
          </li>
        ))}
      </ul>
      {order.notes && <p className="mt-2 text-xs text-gray-500 italic">Order note: {order.notes}</p>}
      <div className="mt-3">{children}</div>
    </div>
  );
}
