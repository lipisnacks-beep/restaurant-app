'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { api, getTabUser, getTabToken, clearTabIdentity } from '@/lib/apiClient';
import { toast } from 'sonner';
import { timeAgo, formatCurrency } from '@/lib/utils';
import { useBrand } from '@/components/ui/Brand';
import {
  ConciergeBell, CheckCircle2, Loader2, LogOut, Bell, BellRing, Coins, Table2,
  Volume2, VolumeX, UserCog,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface OrderItem { name: string; quantity: number; price: number; note?: string }
interface Order {
  _id: string; orderNumber: string; tableNumber: number;
  items: OrderItem[]; status: string; createdAt: string; readyAt?: string;
  acceptedAt?: string;
  servedAt?: string; customerName?: string; tip?: number; total?: number; paymentStatus?: string;
  sessionId?: string; // dining session this order belongs to (for free-table ownership)
}
interface OccupiedTable {
  _id: string; number: number; name: string;
  currentSession?: {
    sessionId: string; startedAt: string; customerName?: string;
    customerMobile?: string; sessionStatus?: 'active' | 'paid' | 'completed' | 'closed';
    // The staff who served this table's customers (stringified ObjectId, or null).
    // Used to gate the Free Table button: only this staff can free the table.
    servedByStaffId?: string | null;
  } | null;
}

const RINGTONE_URL = '/sounds/staff-order.wav';
// Poll every 4s. The API carries Cache-Control: no-store and the client uses
// cache: 'no-store', so every poll hits the DB and sees freshly ready orders.
const POLL_MS = 4000;

export default function StaffPortalClient() {
  const router = useRouter();
  const brand = useBrand();
  const [orders, setOrders] = useState<Order[]>([]);
  const [tables, setTables] = useState<OccupiedTable[]>([]);
  const [tipsAvailable, setTipsAvailable] = useState(0);  // withdrawable tips balance
  const [myStaffId, setMyStaffId] = useState<string>('');  // this staff's _id (for free-table ownership)
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // --- Per-tab staff identity ---
  // Each browser tab carries its own identity token (sessionStorage), so two
  // staff logging in on the same browser keep separate identities — the same
  // mechanism the chef portal uses. We surface the signed-in staff's name in
  // the header so it's obvious which staff this tab belongs to. If a tab
  // reaches the portal without a per-tab token, bounce to login to establish one.
  const [staffName, setStaffName] = useState<string>('');

  // --- Sound state ---
  // Browsers block audio playback until the user interacts with the page. We
  // show an "enable alerts" banner; the first tap runs audio.play() (resumes
  // the AudioContext) and flips `soundEnabled`. After that the loud doorbell
  // ringtone plays automatically whenever there are UNACCEPTED ready orders.
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [soundMuted, setSoundMuted] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Track previously-seen UNACCEPTED ready order ids so we ring the bell on
  // genuinely NEW ready orders (not on every poll).
  const seenUnacceptedRef = useRef<Set<string>>(new Set());
  const [ringing, setRinging] = useState(false);

  const loadRef = useRef<() => void>(() => {});

  const playRingtone = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = 0;
    a.volume = 1.0;
    a.play().catch(() => {
      setSoundEnabled(false);
    });
  }, []);

  const stopRingtone = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    a.pause();
    a.currentTime = 0;
  }, []);

  // One-tap unlock: a real user gesture lets us call play() and unlock audio.
  const enableAlerts = useCallback(async () => {
    const a = audioRef.current;
    if (a) {
      a.volume = 1.0;
      try {
        await a.play();
        setSoundEnabled(true);
        a.pause(); // don't ring now, just unlock
        a.currentTime = 0;
      } catch { /* ignore */ }
    }
    toast.success('Order alerts enabled — you will hear new ready orders.');
    loadRef.current();
  }, []);

  const toggleMute = useCallback(() => {
    setSoundMuted((m) => {
      const next = !m;
      if (next) stopRingtone();
      return next;
    });
  }, [stopRingtone]);

  // Establish per-tab identity on mount. If no per-tab token, the tab reached
  // the portal directly (e.g. bookmark) — redirect to login so it gets its
  // own identity instead of silently sharing whatever the browser cookie has.
  useEffect(() => {
    const token = getTabToken();
    const user = getTabUser<{ name?: string; email?: string; role?: string }>();
    if (!token || !user || user.role !== 'staff') {
      router.replace('/staff/login');
      return;
    }
    setStaffName(user.name || user.email || 'Staff');
  }, [router]);

  const load = useCallback(async () => {
    const [ordersRes, tablesRes, acctRes] = await Promise.all([
      api<{ orders: Order[] }>('/api/orders?role=staff&limit=50'),
      api<{ tables: OccupiedTable[] }>('/api/tables'),
      api<{ user?: { id?: string; _id?: string; tipsAvailable?: number } }>('/api/staff/account'),
    ]);
    if (ordersRes.ok && ordersRes.data) {
      const next = ordersRes.data.orders;
      setOrders(next);
      // UNACCEPTED ready orders = ready AND no acceptedAt yet. With smart
      // dispatch the engine sets acceptedAt at routing time, so these are
      // orders routed to me that I haven't yet acknowledged — they ring until
      // I tap Accept. Accepted-but-still-ready orders (already claimed by this
      // staff) do NOT ring (the bell already served its purpose: alerting
      // that something needs serving).
      const unaccepted = next.filter((o) => o.status === 'ready' && !o.acceptedAt);
      const unacceptedIds = new Set(unaccepted.map((o) => o._id));
      const fresh = unaccepted.filter((o) => !seenUnacceptedRef.current.has(o._id));
      seenUnacceptedRef.current = unacceptedIds;

      // Ring (loud doorbell) while there are unaccepted ready orders.
      if (unaccepted.length > 0) {
        setRinging(true);
        if ((soundEnabled || fresh.length > 0) && !soundMuted) playRingtone();
      } else {
        setRinging(false);
        stopRingtone();
      }
    }
    if (tablesRes.ok && tablesRes.data) {
      setTables(tablesRes.data.tables.filter((t) => t.currentSession?.sessionId));
    }
    if (acctRes.ok && acctRes.data?.user) {
      const u = acctRes.data.user;
      setTipsAvailable(u.tipsAvailable ?? 0);
      setMyStaffId(String(u.id || u._id || ''));
    }
    setLoading(false);
  }, [soundEnabled, soundMuted, playRingtone, stopRingtone]);

  useEffect(() => { loadRef.current = load; }, [load]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => { clearInterval(t); stopRingtone(); };
  }, [load, stopRingtone]);

  async function action(o: Order, act: 'accept' | 'serve' | 'complete') {
    setBusy(o._id);
    const { error, ok } = await api(`/api/orders/${o._id}`, {
      method: 'PATCH', body: JSON.stringify({ action: act }),
    });
    setBusy(null);
    if (!ok) {
      // The race message comes back as "...another staff just accepted it".
      // Surface it as an info toast, not an error.
      if (act === 'accept' && error && error.includes('another staff')) {
        toast.info(error);
      } else {
        toast.error(error || 'Failed');
      }
      load();
      return;
    }
    // Optimistic: accepting stops the bell immediately for this staff.
    if (act === 'accept') {
      stopRingtone();
      setRinging(false);
      toast.success('Order accepted — serve it when ready');
    } else {
      toast.success(act === 'serve' ? 'Marked as served' : 'Order completed');
    }
    load();
  }

  async function freeTable(t: OccupiedTable) {
    const status = t.currentSession?.sessionStatus;
    const confirmMsg = status === 'completed'
      ? `Free Table ${t.number}? The customer has finished dining.`
      : `Free Table ${t.number}? The customer's session is still '${status}'. Only do this if they have left.`;
    if (!confirm(confirmMsg)) return;
    setBusy(t._id);
    const { error, ok } = await api(`/api/tables/${t._id}/free`, { method: 'POST' });
    setBusy(null);
    if (!ok) { toast.error(error || 'Failed'); return; }
    toast.success(`Table ${t.number} is now free for the next guest`);
    load();
  }

  // Bucket the orders:
  //  - toAccept: ready AND not yet accepted (ring for all staff).
  //  - toServe:  ready AND accepted by THIS staff (claimed, awaiting serve).
  //  - served:   served by THIS staff (awaiting payment).
  const toAccept = orders.filter((o) => o.status === 'ready' && !o.acceptedAt);
  const toServe = orders.filter((o) => o.status === 'ready' && o.acceptedAt);
  const served = orders.filter((o) => o.status === 'served');
  // "Ready to Free" = tables THIS staff served, where the customer has paid
  // (sessionStatus 'paid' or 'completed'). Only the serving staff gets the
  // Free Table button — tying the free action to whoever handed the food over.
  const tablesToFree = tables.filter(
    (t) =>
      t.currentSession?.servedByStaffId &&
      String(t.currentSession.servedByStaffId) === myStaffId &&
      (t.currentSession?.sessionStatus === 'paid' || t.currentSession?.sessionStatus === 'completed'),
  );
  // "Occupied" = everything else with a session (still dining, or served by a
  // different staff). These show read-only unless this staff can free them.
  const tablesOccupied = tables.filter((t) => !tablesToFree.includes(t));

  // Dining sessions where THIS staff served at least one order (from the
  // orders list the portal already polls). Used to grant the Free Table
  // button on multi-staff tables where the recorded server is only the last
  // person who delivered.
  const myServedSessionIds = new Set(
    orders.filter((o) => o.status === 'served' && o.sessionId).map((o) => o.sessionId as string),
  );

  /**
   * Can THIS staff free the given occupied table? Mirrors the API gate:
   *   1. recorded server (servedByStaffId) is me, in ANY session state —
   *      active too (customer may settle cash at the counter without using
   *      the in-app pay screen; previously the button was hidden then and the
   *      staff had NO way to free the table they served);
   *   2. no server recorded (admin-served unrouted order / legacy data) — any
   *      staff may free it, otherwise nobody could;
   *   3. I served any order in this dining session.
   */
  const canFreeTable = (t: OccupiedTable): boolean => {
    const cs = t.currentSession;
    if (!cs?.sessionId) return false;
    if (!cs.servedByStaffId) return true; // unclaimed — any staff may free
    if (String(cs.servedByStaffId) === myStaffId) return true; // my table
    return myServedSessionIds.has(cs.sessionId); // I served part of this session
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-gray-50">
      {/* Hidden looping audio element (loud doorbell ringtone). */}
      <audio ref={audioRef} src={RINGTONE_URL} loop preload="auto" />

      <header className="bg-gradient-to-r from-emerald-600 to-emerald-700 text-white sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {brand.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logoUrl} alt={`${brand.restaurantName} logo`} className="w-6 h-6 rounded-md object-contain bg-white/95 p-0.5" />
            ) : (
              <ConciergeBell className="w-6 h-6" />
            )}
            <div>
              <h1 className="font-semibold leading-none">{brand.restaurantName}</h1>
              <p className="text-xs text-emerald-100">
                Staff Portal{staffName ? ` · ${staffName}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`badge ${ringing ? 'bg-amber-400 text-amber-950 animate-pulse' : 'bg-white/20 text-white'}`}>
              {ringing ? <BellRing className="w-3 h-3 mr-1" /> : <Bell className="w-3 h-3 mr-1" />}
              {toAccept.length} new
            </span>
            <Link
              href="/staff/tips"
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
              href="/staff/account"
              title="Account settings"
              className="btn-ghost text-white hover:bg-white/10 p-2"
            >
              <UserCog className="w-4 h-4" />
            </Link>
            <button
              onClick={() => {
                clearTabIdentity();
                api('/api/auth/logout', { method: 'POST', body: JSON.stringify({ scope: 'staff' }) });
                router.push('/');
              }}
              className="btn-ghost text-white hover:bg-white/10"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Enable-alerts banner (browsers block audio until a user gesture). */}
      {!soundEnabled && (
        <div className="bg-amber-50 border-b border-amber-200">
          <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-amber-800 flex items-center gap-2">
              <BellRing className="w-4 h-4" /> Enable order alerts to hear a loud bell when new orders are ready.
            </p>
            <button onClick={enableAlerts} className="btn bg-amber-500 text-white hover:bg-amber-600 text-sm">
              <BellRing className="w-4 h-4" /> Enable alerts
            </button>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 py-6">
        {loading ? (
          <div className="text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
        ) : (
          <div className="space-y-8">
            {/* New ready orders — routed to you, accept to serve */}
            <section>
              <h2 className="font-semibold text-gray-800 mb-1 flex items-center gap-2">
                <Bell className="w-4 h-4 text-emerald-500" /> Routed to You — Accept to Serve ({toAccept.length})
                {toAccept.length > 0 && soundEnabled && !soundMuted && (
                  <span className="text-xs text-amber-600 animate-pulse">🔔 ringing</span>
                )}
              </h2>
              <p className="text-xs text-gray-500 mb-3">
                These ready orders were dispatched specifically to you. Tap <strong>Accept</strong> to confirm — it then moves to your
                “To Serve” list. The bell rings while you have unaccepted orders.
              </p>
              <div className="grid gap-3 lg:grid-cols-2">
                {toAccept.length === 0 && <p className="text-sm text-gray-400">None.</p>}
                {toAccept.map((o) => (
                  <DeliveryCard key={o._id} order={o} accent="border-l-emerald-500">
                    <button onClick={() => action(o, 'accept')} disabled={busy === o._id} className="btn bg-emerald-600 text-white hover:bg-emerald-700 w-full">
                      {busy === o._id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      Accept Order
                    </button>
                  </DeliveryCard>
                ))}
              </div>
            </section>

            {/* Accepted by me — to serve */}
            <section>
              <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                <ConciergeBell className="w-4 h-4 text-teal-500" /> To Serve ({toServe.length})
              </h2>
              <p className="text-xs text-gray-500 mb-3">
                Orders you have accepted. Deliver them to the table, then tap <strong>Mark Served</strong>.
              </p>
              <div className="grid gap-3 lg:grid-cols-2">
                {toServe.length === 0 && <p className="text-sm text-gray-400">None.</p>}
                {toServe.map((o) => (
                  <DeliveryCard key={o._id} order={o} accent="border-l-teal-500">
                    <button onClick={() => action(o, 'serve')} disabled={busy === o._id} className="btn bg-teal-600 text-white hover:bg-teal-700 w-full">
                      {busy === o._id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      Mark Served
                    </button>
                  </DeliveryCard>
                ))}
              </div>
            </section>

            {/* Awaiting payment */}
            <section>
              <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                <Coins className="w-4 h-4 text-sky-500" /> Awaiting Payment ({served.length})
              </h2>
              <div className="grid gap-3 lg:grid-cols-2">
                {served.length === 0 && <p className="text-sm text-gray-400">None.</p>}
                {served.map((o) => (
                  <DeliveryCard key={o._id} order={o} accent="border-l-sky-500">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">Bill: <strong className="text-gray-800">{formatCurrency(o.total || 0)}</strong></span>
                      <span className={`badge ${o.paymentStatus === 'paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {o.paymentStatus || 'unpaid'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      The customer pays from their phone (cash / UPI / card). Once paid, tap Complete.
                    </p>
                    <button onClick={() => action(o, 'complete')} disabled={busy === o._id} className="btn-secondary w-full mt-2">
                      {busy === o._id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      Complete Order
                    </button>
                  </DeliveryCard>
                ))}
              </div>
            </section>

            {/* Tables to free (customer review done) */}
            {tablesToFree.length > 0 && (
              <section>
                <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                  <Table2 className="w-4 h-4 text-emerald-500" /> Ready to Free ({tablesToFree.length})
                </h2>
                <p className="text-xs text-gray-500 mb-3">
                  Tables you served where the customer has paid. Confirm the table is clear, then free it for the next guest.
                </p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {tablesToFree.map((t) => (
                    <TableCard key={t._id} table={t} busy={busy === t._id} onFree={() => freeTable(t)} highlight />
                  ))}
                </div>
              </section>
            )}

            {/* Occupied tables */}
            {tablesOccupied.length > 0 && (
              <section>
                <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                  <Table2 className="w-4 h-4 text-amber-500" /> Occupied Tables ({tablesOccupied.length})
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {tablesOccupied.map((t) => (
                    <TableCard
                      key={t._id}
                      table={t}
                      busy={busy === t._id}
                      onFree={() => freeTable(t)}
                      // Free button for: my tables (ANY session state — the
                      // customer may settle cash at the counter without using
                      // the in-app pay screen), unclaimed tables, and sessions
                      // where I served any order. Others stay read-only.
                      canFree={canFreeTable(t)}
                    />
                  ))}
                </div>
              </section>
            )}

            {orders.length === 0 && tables.length === 0 && (
              <div className="card p-12 text-center">
                <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-500 mb-3" />
                <h2 className="text-lg font-semibold text-gray-800">Nothing to deliver</h2>
                <p className="text-sm text-gray-500">Orders the chef marks ready will appear here automatically — the bell will ring.</p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function TableCard({ table, busy, onFree, highlight, canFree = true }: {
  table: OccupiedTable; busy: boolean; onFree: () => void; highlight?: boolean; canFree?: boolean;
}) {
  const cs = table.currentSession;
  const status = cs?.sessionStatus || 'active';
  const statusLabel = { active: 'Dining', paid: 'Paid — pending review', completed: 'Ready to free', closed: 'Closed' }[status] || status;
  return (
    <div className={`card p-4 border-l-4 ${highlight ? 'border-l-emerald-500' : 'border-l-amber-400'}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="font-semibold text-gray-800">{table.name}</p>
          <p className="text-xs text-gray-500">{cs?.customerName || 'Guest'}</p>
        </div>
        <span className={`badge text-[10px] ${
          status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
          status === 'paid' ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700'
        }`}>
          {statusLabel}
        </span>
      </div>
      <p className="text-xs text-gray-400 mt-2">
        Seated {cs?.startedAt ? timeAgo(cs.startedAt) : '—'}
      </p>
      {canFree ? (
        <>
          <button onClick={onFree} disabled={busy} className={`w-full mt-3 ${highlight ? 'btn bg-emerald-600 text-white hover:bg-emerald-700' : 'btn-secondary'}`}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Free Table
          </button>
          {!cs?.servedByStaffId && (
            <p className="text-[11px] text-gray-400 mt-1.5 italic">
              Unclaimed session — no server recorded, any staff can free it.
            </p>
          )}
        </>
      ) : (
        <p className="text-[11px] text-gray-400 mt-3 italic">
          Served by another staff — only they can free this table.
        </p>
      )}
    </div>
  );
}

function DeliveryCard({ order, accent, children }: { order: Order; accent: string; children: React.ReactNode }) {
  return (
    <div className={`card p-4 border-l-4 ${accent}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-gray-800">{order.orderNumber}</p>
          <p className="text-sm text-gray-600">Table {order.tableNumber}{order.customerName ? ` · ${order.customerName}` : ''}</p>
        </div>
        {/* For a SERVED order (Awaiting Payment) the relevant timer is how long
            since the staff delivered it (servedAt), not since the chef finished
            (readyAt) or the customer placed it (createdAt). */}
        <span className="text-xs text-gray-400">{timeAgo(order.status === 'served' ? (order.servedAt || order.readyAt || order.createdAt) : (order.readyAt || order.createdAt))}</span>
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
      <div className="mt-3">{children}</div>
    </div>
  );
}
