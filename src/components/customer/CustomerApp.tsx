'use client';
import { useEffect, useMemo, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/apiClient';
import { useCart } from '@/lib/cartStore';
import type { CartItem } from '@/lib/cartStore';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/utils';
import {
  ShoppingCart, Plus, Minus, Trash2, UtensilsCrossed, Loader2, CheckCircle2,
  Receipt, Banknote, QrCode, CreditCard, Star, ChevronLeft, ChefHat, ConciergeBell,
  Phone, User, Clock,
} from 'lucide-react';

interface MenuItem {
  _id: string; name: string; description: string; category: string;
  price: number; image: string; available: boolean; veg: boolean; prepTime: number;
}
interface OrderItem { name: string; price: number; quantity: number; note?: string }
interface Order {
  _id: string; orderNumber: string; tableNumber: number; items: OrderItem[];
  subtotal: number; taxAmount: number; serviceChargeAmount: number; tip: number;
  total: number; status: string; paymentMethod?: string; paymentStatus: string;
  customerName?: string; createdAt: string; servedAt?: string | null; completedAt?: string | null;
}
interface CustomerInfo { _id: string; name: string; mobile: string }
interface DiningSession {
  _id: string; sessionId: string; customerName: string; mobile: string;
  tableNumber: number; status: 'active' | 'paid' | 'completed' | 'closed';
  startedAt: string; endedAt?: string | null; orderCount: number; total: number; tip: number;
}
interface SessionPayload {
  session: DiningSession | null;
  orders: Order[]; payable: Order[]; pending: Order[]; paid: Order[];
  bill: { subtotal: number; taxAmount: number; serviceChargeAmount: number; payableOrderCount: number };
}

type View = 'register' | 'menu' | 'cart' | 'checkout' | 'tracking' | 'pay' | 'thankyou' | 'closed';

export default function CustomerApp() {
  const search = useSearchParams();
  const tableParam = search.get('table');
  const [hydrated, setHydrated] = useState(false);

  const cart = useCart();
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('register');
  const [activeCategory, setActiveCategory] = useState('All');
  const [placing, setPlacing] = useState(false);
  const [customer, setCustomer] = useState<CustomerInfo | null>(null);
  const [diningSession, setDiningSession] = useState<DiningSession | null>(null);
  const [sessionOrders, setSessionOrders] = useState<Order[]>([]);
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [paying, setPaying] = useState(false);
  const [tip, setTip] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'upi' | 'card'>('upi');
  const [checkingSession, setCheckingSession] = useState(true);

  // 1) Hydrate the persisted cart + set table from URL.
  useEffect(() => {
    setHydrated(true);
    if (tableParam) {
      const n = Number(tableParam);
      if (!Number.isNaN(n)) {
        cart.setTable(n);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableParam]);

  // 2) On load, check if this browser already has a dining session (cookie).
  const checkSession = useCallback(async () => {
    setCheckingSession(true);
    const { data, ok } = await api<{ session: DiningSession | null; customer: CustomerInfo | null }>(
      '/api/customer/register',
    );
    if (ok && data?.session && data.customer) {
      setCustomer(data.customer);
      setDiningSession(data.session);
      cart.setSession(data.session.sessionId);
      cart.setCustomerName(data.session.customerName);
      cart.setCustomerMobile(data.session.mobile);
      // If the session is completed/closed, the meal is over.
      if (data.session.status === 'completed' || data.session.status === 'closed') {
        setView('closed');
      } else {
        setView('menu');
      }
    }
    setCheckingSession(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (hydrated) checkSession();
  }, [hydrated, checkSession]);

  const loadMenu = useCallback(async () => {
    const { data, ok } = await api<{ items: MenuItem[] }>('/api/menu?available=true');
    if (ok && data) setItems(data.items);
    setLoading(false);
  }, []);

  useEffect(() => { loadMenu(); }, [loadMenu]);

  // 3) Load the aggregated session (orders + bill) whenever we need it.
  const loadSession = useCallback(async () => {
    if (!diningSession) return;
    const { data } = await api<SessionPayload>('/api/customer/session');
    if (data) {
      setDiningSession(data.session);
      setSessionOrders(data.orders);
      // Track the most recent order for the tracking view.
      if (data.orders.length > 0) {
        setActiveOrder(data.orders[data.orders.length - 1]);
      }
    }
  }, [diningSession]);

  useEffect(() => {
    if (view === 'tracking' && diningSession) {
      loadSession();
      const t = setInterval(loadSession, 5000);
      return () => clearInterval(t);
    }
  }, [view, diningSession, loadSession]);

  const categories = useMemo(() => {
    const set = new Set(items.map((i) => i.category));
    return ['All', ...Array.from(set)];
  }, [items]);

  const filtered = useMemo(() => {
    if (activeCategory === 'All') return items;
    return items.filter((i) => i.category === activeCategory);
  }, [items, activeCategory]);

  // ---- Actions ----
  function addToCart(m: MenuItem) {
    cart.add({ menuItem: m._id, name: m.name, price: m.price, image: m.image, quantity: 1 });
    toast.success(`${m.name} added`);
  }

  async function register(name: string, mobile: string) {
    if (!cart.tableNumber) { toast.error('Unknown table — please scan the QR again'); return; }
    setPlacing(true);
    const { data, error, ok } = await api<{
      session: DiningSession; customer: CustomerInfo; resumed: boolean;
    }>('/api/customer/register', {
      method: 'POST',
      body: JSON.stringify({ name, mobile, tableNumber: cart.tableNumber }),
    });
    setPlacing(false);
    if (!ok || !data) { toast.error(error || 'Registration failed'); return; }
    setCustomer(data.customer);
    setDiningSession(data.session);
    cart.setSession(data.session.sessionId);
    cart.setCustomerName(data.customer.name);
    cart.setCustomerMobile(data.customer.mobile);
    setView('menu');
    toast.success(data.resumed ? `Welcome back, ${data.customer.name}!` : `Welcome, ${data.customer.name}!`);
  }

  async function placeOrder() {
    if (!cart.tableNumber) { toast.error('Unknown table — please scan the QR again'); return; }
    if (cart.items.length === 0) return;
    if (!cart.sessionId) { toast.error('Session expired — please scan the QR again'); return; }
    setPlacing(true);
    const body = {
      tableNumber: cart.tableNumber,
      sessionId: cart.sessionId,
      customerName: cart.customerName,
      items: cart.items.map((i) => ({ menuItem: i.menuItem, quantity: i.quantity, note: i.note || '' })),
      taxRate: cart.taxRate,
      serviceChargeRate: cart.serviceChargeRate,
    };
    const { data, error, ok } = await api<{ order: Order }>('/api/orders', { method: 'POST', body: JSON.stringify(body) });
    setPlacing(false);
    if (!ok) { toast.error(error || 'Failed to place order'); return; }
    setActiveOrder(data!.order);
    cart.clear();
    await loadSession();
    setView('tracking');
    toast.success(`Order ${data!.order.orderNumber} placed!`);
  }

  async function pay() {
    if (!activeOrder) return;
    setPaying(true);
    const { data, error, ok } = await api<{ order: Order; grandTotal: number; paidOrders: string[] }>(
      `/api/orders/${activeOrder._id}`,
      { method: 'PATCH', body: JSON.stringify({ action: 'pay', paymentMethod, tip }) },
    );
    setPaying(false);
    if (!ok) { toast.error(error || 'Payment failed'); return; }
    setActiveOrder(data!.order);
    setView('thankyou');
  }

  // ---- Render ----
  if (!hydrated || checkingSession) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  if (!cart.tableNumber) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center bg-gradient-to-br from-brand-50 to-amber-50">
        <QrCode className="w-16 h-16 text-brand-500 mb-4" />
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Welcome to Lipi Snacks</h1>
        <p className="text-gray-600 max-w-md">
          Please scan the QR code on your table to open the menu. If you arrived here directly,
          ask a staff member to point you to a table QR.
        </p>
        <a href="/" className="btn-primary mt-6">Back to home</a>
      </div>
    );
  }

  if (view === 'register') {
    return <RegisterView tableNumber={cart.tableNumber} onRegister={register} placing={placing} />;
  }

  if (view === 'closed') {
    return <ClosedView />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-gray-50 pb-24">
      {/* Header */}
      <header className="bg-gradient-to-r from-brand-600 to-brand-700 text-white sticky top-0 z-30">
        <div className="max-w-3xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UtensilsCrossed className="w-6 h-6" />
            <div>
              <h1 className="font-semibold leading-none">Lipi Snacks</h1>
              <p className="text-xs text-brand-100">
                Table {cart.tableNumber}
                {customer ? ` · ${customer.name}` : ''}
              </p>
            </div>
          </div>
          {view !== 'menu' && view !== 'thankyou' && (
            <button onClick={() => setView('menu')} className="btn-ghost text-white hover:bg-white/10">
              <ChevronLeft className="w-4 h-4" /> Menu
            </button>
          )}
          <button onClick={() => setView('cart')} className="relative btn-ghost text-white hover:bg-white/10">
            <ShoppingCart className="w-5 h-5" />
            {cart.items.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-white text-brand-700 text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                {cart.items.reduce((s, i) => s + i.quantity, 0)}
              </span>
            )}
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-4">
        {view === 'menu' && (
          <>
            <MenuView items={filtered} categories={categories} active={activeCategory} setActive={setActiveCategory}
              loading={loading} onAdd={addToCart} cartItems={cart.items} onInc={(id) => cart.setQty(id, (cart.items.find((i) => i.menuItem === id)?.quantity || 0) + 1)}
              onDec={(id) => cart.setQty(id, (cart.items.find((i) => i.menuItem === id)?.quantity || 0) - 1)} />
            {/* Order-more / view-orders shortcut */}
            {sessionOrders.length > 0 && (
              <button onClick={() => setView('tracking')} className="btn-secondary w-full mt-4">
                <Receipt className="w-4 h-4" /> View my orders ({sessionOrders.length})
              </button>
            )}
          </>
        )}

        {view === 'cart' && (
          <CartView cart={cart} onCheckout={() => setView('checkout')} onBack={() => setView('menu')} />
        )}

        {view === 'checkout' && (
          <CheckoutView cart={cart} placing={placing} onPlace={placeOrder} onBack={() => setView('cart')} />
        )}

        {view === 'tracking' && diningSession && (
          <TrackingView
            session={diningSession}
            orders={sessionOrders}
            activeOrder={activeOrder}
            onOrderMore={() => setView('menu')}
            onPay={() => setView('pay')}
          />
        )}

        {view === 'pay' && activeOrder && (
          <PayView order={activeOrder} sessionOrders={sessionOrders} tip={tip} setTip={setTip}
            method={paymentMethod} setMethod={setPaymentMethod} paying={paying} onPay={pay} onBack={() => setView('tracking')} />
        )}

        {view === 'thankyou' && activeOrder && (
          <ThankYouView order={activeOrder} sessionOrders={sessionOrders} />
        )}
      </main>
    </div>
  );
}

/* ---------------- Sub-views ---------------- */

function RegisterView({ tableNumber, onRegister, placing }: {
  tableNumber: number; onRegister: (name: string, mobile: string) => void; placing: boolean;
}) {
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const valid = name.trim().length >= 2 && /^[6-9]\d{9}$/.test(mobile.replace(/\D/g, ''));

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-gray-50 flex flex-col">
      <header className="bg-gradient-to-r from-brand-600 to-brand-700 text-white">
        <div className="max-w-3xl mx-auto px-4 h-16 flex items-center gap-2">
          <UtensilsCrossed className="w-6 h-6" />
          <div>
            <h1 className="font-semibold leading-none">Lipi Snacks</h1>
            <p className="text-xs text-brand-100">Table {tableNumber}</p>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-md mx-auto w-full px-4 py-8">
        <div className="card p-6 space-y-5">
          <div className="text-center">
            <div className="w-14 h-14 rounded-xl bg-brand-100 text-brand-700 flex items-center justify-center mx-auto mb-3">
              <User className="w-7 h-7" />
            </div>
            <h2 className="text-xl font-bold text-gray-800">Welcome!</h2>
            <p className="text-sm text-gray-500 mt-1">
              Please share your name &amp; mobile to start ordering. We use this only to serve you better.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Your name</label>
            <input className="input" placeholder="e.g. Rahim" value={name} onChange={(e) => setName(e.target.value)}
              autoComplete="name" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Mobile number</label>
            <div className="relative">
              <Phone className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input className="input pl-9" placeholder="10-digit mobile" value={mobile}
                onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                inputMode="numeric" autoComplete="tel" />
            </div>
            <p className="text-xs text-gray-400 mt-1">We&apos;ll remember you next time you visit.</p>
          </div>
          <button onClick={() => onRegister(name, mobile)} disabled={!valid || placing} className="btn-primary w-full">
            {placing ? <Loader2 className="w-4 h-4 animate-spin" /> : <UtensilsCrossed className="w-4 h-4" />}
            Start Ordering
          </button>
        </div>
      </main>
    </div>
  );
}

function ClosedView() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center bg-gradient-to-br from-emerald-50 to-gray-50">
      <CheckCircle2 className="w-16 h-16 text-emerald-500 mb-4" />
      <h1 className="text-2xl font-bold text-gray-800 mb-2">Thanks for visiting!</h1>
      <p className="text-gray-600 max-w-md">
        Your dining session has ended. You may close this page now. We hope to see you again soon at Lipi Snacks!
      </p>
    </div>
  );
}

function MenuView({ items, categories, active, setActive, loading, onAdd, cartItems, onInc, onDec }: {
  items: MenuItem[]; categories: string[]; active: string; setActive: (s: string) => void;
  loading: boolean; onAdd: (m: MenuItem) => void; cartItems: CartItem[];
  onInc: (id: string) => void; onDec: (id: string) => void;
}) {
  if (loading) return <div className="text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading menu…</div>;
  if (items.length === 0) return <div className="card p-8 text-center text-gray-500">No items available right now.</div>;
  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
        {categories.map((c) => (
          <button key={c} onClick={() => setActive(c)}
            className={`badge shrink-0 px-3 py-1.5 cursor-pointer ${active === c ? 'bg-brand-600 text-white' : 'bg-white text-gray-700 border'}`}>
            {c}
          </button>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {items.map((m) => {
          const inCart = cartItems.find((i) => i.menuItem === m._id);
          return (
            <div key={m._id} className="card overflow-hidden flex">
              <div className="w-28 sm:w-32 shrink-0 bg-gray-100">
                {m.image ? (
                  <img src={m.image} alt={m.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-300">
                    <UtensilsCrossed className="w-6 h-6" />
                  </div>
                )}
              </div>
              <div className="p-3 flex-1 flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-gray-800 text-sm leading-tight">{m.name}</h3>
                  <span className="font-semibold text-brand-700 text-sm whitespace-nowrap">{formatCurrency(m.price)}</span>
                </div>
                <p className="text-xs text-gray-500 mt-1 line-clamp-2 flex-1">{m.description || '—'}</p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[10px] text-gray-400">{m.prepTime} min</span>
                  {inCart ? (
                    <div className="flex items-center gap-2 bg-brand-50 rounded-lg p-0.5">
                      <button onClick={() => onDec(m._id)} className="w-7 h-7 flex items-center justify-center text-brand-700"><Minus className="w-3 h-3" /></button>
                      <span className="text-sm font-semibold text-brand-700 w-5 text-center">{inCart.quantity}</span>
                      <button onClick={() => onInc(m._id)} className="w-7 h-7 flex items-center justify-center text-brand-700"><Plus className="w-3 h-3" /></button>
                    </div>
                  ) : (
                    <button onClick={() => onAdd(m)} className="btn-primary text-xs px-3 py-1.5">
                      <Plus className="w-3 h-3" /> Add
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CartView({ cart, onCheckout, onBack }: { cart: any; onCheckout: () => void; onBack: () => void }) {
  if (cart.items.length === 0) {
    return (
      <div className="card p-8 text-center">
        <ShoppingCart className="w-12 h-12 mx-auto text-gray-300 mb-3" />
        <p className="text-gray-500">Your cart is empty.</p>
        <button onClick={onBack} className="btn-primary mt-4">Browse menu</button>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="card divide-y">
        {cart.items.map((i: CartItem) => (
          <div key={i.menuItem} className="p-3 flex items-center gap-3">
            <div className="w-14 h-14 rounded-lg bg-gray-100 shrink-0 overflow-hidden">
              {i.image && <img src={i.image} alt="" className="w-full h-full object-cover" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-800 text-sm">{i.name}</p>
              <p className="text-xs text-gray-500">{formatCurrency(i.price)} each</p>
            </div>
            <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-0.5">
              <button onClick={() => cart.setQty(i.menuItem, i.quantity - 1)} className="w-7 h-7 flex items-center justify-center"><Minus className="w-3 h-3" /></button>
              <span className="text-sm font-semibold w-5 text-center">{i.quantity}</span>
              <button onClick={() => cart.setQty(i.menuItem, i.quantity + 1)} className="w-7 h-7 flex items-center justify-center"><Plus className="w-3 h-3" /></button>
            </div>
            <p className="font-semibold text-gray-800 w-16 text-right text-sm">{formatCurrency(i.price * i.quantity)}</p>
            <button onClick={() => cart.remove(i.menuItem)} className="text-red-500"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
      </div>
      <BillSummary cart={cart} />
      <button onClick={onCheckout} className="btn-primary w-full">Proceed to Checkout</button>
    </div>
  );
}

function BillSummary({ cart, extraTip = 0 }: { cart: any; extraTip?: number }) {
  return (
    <div className="card p-4 space-y-2 text-sm">
      <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>{formatCurrency(cart.subtotal())}</span></div>
      {cart.taxRate > 0 && <div className="flex justify-between text-gray-600"><span>Tax ({cart.taxRate}%)</span><span>{formatCurrency(cart.taxAmount())}</span></div>}
      {cart.serviceChargeRate > 0 && <div className="flex justify-between text-gray-600"><span>Service ({cart.serviceChargeRate}%)</span><span>{formatCurrency(cart.serviceAmount())}</span></div>}
      {extraTip > 0 && <div className="flex justify-between text-gray-600"><span>Tip</span><span>{formatCurrency(extraTip)}</span></div>}
      <div className="border-t pt-2 flex justify-between font-semibold text-gray-800"><span>Total</span><span>{formatCurrency(cart.total() + extraTip)}</span></div>
    </div>
  );
}

function CheckoutView({ cart, placing, onPlace, onBack }: { cart: any; placing: boolean; onPlace: () => void; onBack: () => void }) {
  return (
    <div className="space-y-4">
      <button onClick={onBack} className="btn-ghost text-sm"><ChevronLeft className="w-4 h-4" /> Back to cart</button>
      <div className="card p-4">
        <p className="text-sm text-gray-600">
          Ordering as <strong className="text-gray-800">{cart.customerName || 'Guest'}</strong>
          {cart.customerMobile ? ` · ${cart.customerMobile}` : ''}
        </p>
        <p className="text-xs text-gray-400 mt-1">Table {cart.tableNumber}. You can order more items later — pay only when you&apos;re done.</p>
      </div>
      <BillSummary cart={cart} />
      <button onClick={onPlace} disabled={placing || cart.items.length === 0} className="btn-primary w-full">
        {placing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />}
        Place Order · {formatCurrency(cart.total())}
      </button>
      <p className="text-xs text-gray-400 text-center">Your order goes straight to the kitchen. Pay later from your table.</p>
    </div>
  );
}

const STATUS_STEPS = [
  { key: 'pending', label: 'Order Received', icon: Receipt },
  { key: 'preparing', label: 'Being Prepared', icon: ChefHat },
  { key: 'ready', label: 'Ready to Serve', icon: ConciergeBell },
  { key: 'served', label: 'Served at Table', icon: CheckCircle2 },
];
const STATUS_ORDER = ['pending', 'preparing', 'ready', 'served', 'completed'];

function TrackingView({ session, orders, activeOrder, onOrderMore, onPay }: {
  session: DiningSession; orders: Order[]; activeOrder: Order | null;
  onOrderMore: () => void; onPay: () => void;
}) {
  const payable = orders.filter((o) => o.paymentStatus === 'unpaid' && ['served', 'ready'].includes(o.status));
  const pending = orders.filter((o) => o.paymentStatus === 'unpaid' && ['pending', 'preparing'].includes(o.status));
  const paid = orders.filter((o) => o.paymentStatus === 'paid');
  const canPay = payable.length > 0;

  return (
    <div className="space-y-4">
      <div className="card p-5 text-center">
        <p className="text-xs text-gray-500">Your session</p>
        <p className="text-sm font-medium text-gray-800">
          {session.customerName} · Table {session.tableNumber}
        </p>
        <p className="text-xs text-gray-400 mt-1 flex items-center justify-center gap-1">
          <Clock className="w-3 h-3" /> Seated since {new Date(session.startedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          {' · '}{orders.length} order{orders.length !== 1 ? 's' : ''}
        </p>
      </div>

      {activeOrder && (
        <div className="card p-5">
          <p className="text-xs text-gray-500 mb-2">Latest order</p>
          <p className="text-xl font-bold text-brand-700 mb-3">{activeOrder.orderNumber}</p>
          <ol className="space-y-4">
            {STATUS_STEPS.map((s, idx) => {
              const done = idx <= STATUS_ORDER.indexOf(activeOrder.status);
              const Icon = s.icon;
              return (
                <li key={s.key} className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${done ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-400'}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <p className={`font-medium ${done ? 'text-gray-800' : 'text-gray-400'}`}>{s.label}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* All orders summary */}
      <div className="card p-4">
        <h3 className="font-semibold text-gray-800 mb-2 text-sm">All your orders</h3>
        <ul className="text-sm space-y-2">
          {orders.map((o) => (
            <li key={o._id} className="flex items-center justify-between border-b last:border-0 pb-2 last:pb-0">
              <div>
                <span className="font-medium text-gray-800">{o.orderNumber}</span>
                <span className="text-xs text-gray-400 ml-2">{o.items.reduce((s, i) => s + i.quantity, 0)} items</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-700">{formatCurrency(o.total)}</span>
                <span className={`badge text-[10px] ${o.paymentStatus === 'paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                  {o.status}
                </span>
              </div>
            </li>
          ))}
          {orders.length === 0 && <li className="text-gray-400 text-xs">No orders yet.</li>}
        </ul>
        {payable.length > 0 && (
          <div className="border-t mt-3 pt-2 text-sm flex justify-between font-semibold text-gray-800">
            <span>Payable now ({payable.length})</span>
            <span>{formatCurrency(payable.reduce((s, o) => s + o.total, 0))}</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button onClick={onOrderMore} className="btn-secondary">
          <Plus className="w-4 h-4" /> Order More
        </button>
        {canPay ? (
          <button onClick={onPay} className="btn-primary">
            <Receipt className="w-4 h-4" /> Pay Bill
          </button>
        ) : (
          <button disabled className="btn-primary opacity-50 cursor-not-allowed">
            <Receipt className="w-4 h-4" /> Pay Bill
          </button>
        )}
      </div>
      {pending.length > 0 && (
        <p className="text-xs text-amber-600 text-center">
          {pending.length} order{pending.length !== 1 ? 's are' : ' is'} still being prepared — pay after they&apos;re served.
        </p>
      )}
      {paid.length > 0 && pending.length === 0 && payable.length === 0 && (
        <div className="card p-4 bg-emerald-50 border-emerald-200 text-center">
          <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-1" />
          <p className="text-sm font-medium text-emerald-700">All paid! Thanks for dining with us.</p>
        </div>
      )}
    </div>
  );
}

function PayView({ order, sessionOrders, tip, setTip, method, setMethod, paying, onPay, onBack }: {
  order: Order; sessionOrders: Order[]; tip: number; setTip: (n: number) => void;
  method: string; setMethod: (m: any) => void; paying: boolean; onPay: () => void; onBack: () => void;
}) {
  const tipOptions = [0, 10, 20, 50, 100];
  // Aggregate all payable orders for the bill preview.
  const payable = sessionOrders.filter((o) => o.paymentStatus === 'unpaid' && ['served', 'ready'].includes(o.status));
  const billSubtotal = payable.reduce((s, o) => s + o.subtotal, 0);
  const billTax = payable.reduce((s, o) => s + o.taxAmount, 0);
  const billService = payable.reduce((s, o) => s + o.serviceChargeAmount, 0);
  const billBase = billSubtotal + billTax + billService;
  const grandTotal = billBase + tip;

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="btn-ghost text-sm"><ChevronLeft className="w-4 h-4" /> Back</button>

      {/* Aggregated bill */}
      <div className="card p-4">
        <h3 className="font-semibold text-gray-800 mb-3 text-sm">
          Bill summary ({payable.length} order{payable.length !== 1 ? 's' : ''})
        </h3>
        <div className="space-y-1 text-sm">
          {payable.map((o) => (
            <div key={o._id} className="flex justify-between text-gray-600">
              <span>{o.orderNumber}</span>
              <span>{formatCurrency(o.total)}</span>
            </div>
          ))}
        </div>
        <div className="border-t mt-3 pt-2 space-y-1 text-sm">
          <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>{formatCurrency(billSubtotal)}</span></div>
          {billTax > 0 && <div className="flex justify-between text-gray-600"><span>Tax</span><span>{formatCurrency(billTax)}</span></div>}
          {billService > 0 && <div className="flex justify-between text-gray-600"><span>Service</span><span>{formatCurrency(billService)}</span></div>}
        </div>
      </div>

      <div className="card p-4">
        <h3 className="font-semibold text-gray-800 mb-3 text-sm">Choose payment method</h3>
        <div className="grid grid-cols-3 gap-2">
          {[
            { key: 'cash', label: 'Cash', icon: Banknote },
            { key: 'upi', label: 'UPI / GPay', icon: QrCode },
            { key: 'card', label: 'Card', icon: CreditCard },
          ].map((p) => (
            <button key={p.key} onClick={() => setMethod(p.key)}
              className={`p-3 rounded-lg border flex flex-col items-center gap-1 transition ${method === p.key ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200 text-gray-600'}`}>
              <p.icon className="w-5 h-5" />
              <span className="text-xs font-medium">{p.label}</span>
            </button>
          ))}
        </div>
        {method === 'upi' && (
          <div className="mt-3 p-3 bg-gray-50 rounded-lg text-center text-xs text-gray-500">
            Pay via UPI/GPay to <strong className="text-gray-700">lipisnacks@upi</strong> and tap confirm. Show the staff your payment confirmation.
          </div>
        )}
      </div>

      <div className="card p-4">
        <h3 className="font-semibold text-gray-800 mb-3 text-sm">Add a tip for the staff?</h3>
        <div className="flex flex-wrap gap-2">
          {tipOptions.map((t) => (
            <button key={t} onClick={() => setTip(t)}
              className={`badge px-3 py-1.5 cursor-pointer ${tip === t ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-700'}`}>
              {t === 0 ? 'No tip' : formatCurrency(t)}
            </button>
          ))}
        </div>
      </div>

      <div className="card p-4 space-y-2 text-sm">
        <div className="flex justify-between text-gray-600"><span>Bill total</span><span>{formatCurrency(billBase)}</span></div>
        <div className="flex justify-between text-gray-600"><span>Tip</span><span>{formatCurrency(tip)}</span></div>
        <div className="border-t pt-2 flex justify-between font-semibold text-gray-800"><span>Grand Total</span><span>{formatCurrency(grandTotal)}</span></div>
      </div>

      <button onClick={onPay} disabled={paying} className="btn-primary w-full">
        {paying ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
        Confirm Payment · {formatCurrency(grandTotal)}
      </button>
    </div>
  );
}

function ThankYouView({ order, sessionOrders }: { order: Order; sessionOrders: Order[] }) {
  const [rating, setRating] = useState(0);
  const [foodRating, setFoodRating] = useState(0);
  const [serviceRating, setServiceRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [googleUrl, setGoogleUrl] = useState('');
  const [closed, setClosed] = useState(false);

  const grandTotal = sessionOrders.filter((o) => o.paymentStatus === 'paid')
    .reduce((s, o) => s + o.total, 0);

  async function submitReview() {
    if (rating < 1) { toast.error('Please pick an overall rating'); return; }
    setSubmitting(true);
    const { data, error, ok } = await api<{ googleReviewUrl: string; sessionClosed: boolean }>('/api/reviews', {
      method: 'POST',
      body: JSON.stringify({
        order: order._id,
        tableNumber: order.tableNumber,
        customerName: order.customerName || 'Anonymous',
        rating, foodRating, serviceRating, comment,
      }),
    });
    setSubmitting(false);
    if (!ok) { toast.error(error || 'Failed'); return; }
    toast.success('Thanks for your feedback!');
    setGoogleUrl(data!.googleReviewUrl || '');
    setClosed(!!data!.sessionClosed);
  }

  // After the review is submitted and the Google link shown, attempt to close
  // the tab. Browsers only allow window.close() on tabs the script opened; we
  // provide a fallback message if it can't close programmatically.
  function closeTab() {
    setTimeout(() => {
      window.close();
      // Fallback: if the tab didn't close (most QR-scanned tabs can't), show
      // a friendly message instead of leaving the user on a dead page.
      setClosed(true);
    }, 100);
  }

  return (
    <div className="space-y-4">
      <div className="card p-6 text-center">
        <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto mb-2" />
        <h2 className="text-xl font-bold text-gray-800">Thank you!</h2>
        <p className="text-sm text-gray-500 mt-1">
          Your payment of <strong>{formatCurrency(grandTotal)}</strong> is confirmed.
        </p>
      </div>

      {!googleUrl && (
        <div className="card p-5 space-y-4">
          <div>
            <h3 className="font-semibold text-gray-800 mb-2 text-sm">How was your experience?</h3>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((i) => (
                <button key={i} onClick={() => setRating(i)}>
                  <Star className={`w-8 h-8 ${i <= rating ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`} />
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-gray-500 mb-1">Food</p>
              <div className="flex gap-0.5">
                {[1, 2, 3, 4, 5].map((i) => (
                  <button key={i} onClick={() => setFoodRating(i)}>
                    <Star className={`w-5 h-5 ${i <= foodRating ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`} />
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Service</p>
              <div className="flex gap-0.5">
                {[1, 2, 3, 4, 5].map((i) => (
                  <button key={i} onClick={() => setServiceRating(i)}>
                    <Star className={`w-5 h-5 ${i <= serviceRating ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`} />
                  </button>
                ))}
              </div>
            </div>
          </div>
          <textarea className="input" rows={2} placeholder="Leave a comment (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
          <button onClick={submitReview} disabled={submitting} className="btn-primary w-full">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Star className="w-4 h-4" />}
            Submit Feedback
          </button>
        </div>
      )}

      {googleUrl && !closed && (
        <div className="card p-5 text-center">
          <Star className="w-10 h-10 text-amber-400 mx-auto mb-2" />
          <h3 className="font-semibold text-gray-800">Thanks for your feedback!</h3>
          <p className="text-sm text-gray-500 mt-1 mb-4">
            Your dining session has ended. You can post on Google too — then this page will close automatically.
          </p>
          {googleUrl && googleUrl.includes('YOUR_PLACE_ID') ? (
            <p className="text-xs text-amber-600 bg-amber-50 rounded-lg p-3">
              Google review link is not configured yet. Ask the restaurant admin to set <code>GOOGLE_REVIEW_URL</code> in the environment.
            </p>
          ) : (
            <a href={googleUrl} target="_blank" rel="noopener noreferrer" className="btn-primary w-full">
              <Star className="w-4 h-4" /> Post on Google Reviews
            </a>
          )}
          <button onClick={closeTab} className="btn-secondary w-full mt-2">
            <CheckCircle2 className="w-4 h-4" /> Done — Close this page
          </button>
        </div>
      )}

      {googleUrl && closed && (
        <div className="card p-6 text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-2" />
          <h3 className="font-semibold text-gray-800">All done!</h3>
          <p className="text-sm text-gray-500 mt-1">
            Your session has ended. You can close this page now. We hope to see you again at Lipi Snacks!
          </p>
          <a href="/" className="btn-ghost w-full mt-3">Back to home</a>
        </div>
      )}
    </div>
  );
}
