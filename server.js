// Kosuke Beauty — zero-dependency Node.js server.
// Serves the storefront and exposes a small JSON API for products and orders.
//
//   node server.js                 -> http://localhost:3000
//   STRIPE_SECRET_KEY=sk_test_... node server.js   -> real card payments via Stripe Checkout

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || '';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

const products = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'products.json'), 'utf8'));
const productById = new Map(products.map((p) => [p.id, p]));

// Pricing rules. Kept on the server so the client can't change totals.
const SHIPPING = {
  standard: { label: 'Standard (5–7 days)', price: 5.99, freeOver: 50 },
  express: { label: 'Express (1–2 days)', price: 14.99 },
};
const PROMOS = { GLOW10: 0.1, WELCOME15: 0.15 };
const TAX_RATE = 0.08;
const COD_FEE = 2.0;
const PAYMENT_METHODS = ['card', 'paypal', 'upi', 'cod'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const round2 = (n) => Math.round(n * 100) / 100;

function loadOrders() {
  try {
    return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveOrders(orders) {
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': MIME['.json'] });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
  });
}

// Recalculate the order from the catalog. Never trust client-side prices.
function priceOrder({ items, shippingMethod, promoCode, paymentMethod }) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('Your bag is empty.');
  const lines = items.map((it) => {
    const product = productById.get(it.id);
    if (!product) throw new Error(`Unknown product: ${it.id}`);
    const qty = Math.floor(Number(it.qty));
    if (!(qty >= 1 && qty <= 20)) throw new Error(`Invalid quantity for ${product.name}`);
    const shade = product.shades.find((s) => s.name === it.shade) || product.shades[0];
    return {
      id: product.id,
      name: product.name,
      shade: shade.name,
      unitPrice: product.price,
      qty,
      lineTotal: round2(product.price * qty),
    };
  });

  const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const ship = SHIPPING[shippingMethod] || SHIPPING.standard;
  const shipping = ship.freeOver && subtotal >= ship.freeOver ? 0 : ship.price;
  const code = String(promoCode || '').trim().toUpperCase();
  const discountRate = PROMOS[code] || 0;
  const discount = round2(subtotal * discountRate);
  const codFee = paymentMethod === 'cod' ? COD_FEE : 0;
  const tax = round2((subtotal - discount) * TAX_RATE);
  const total = round2(subtotal - discount + shipping + tax + codFee);

  return {
    lines,
    subtotal,
    discount,
    promoCode: discountRate ? code : null,
    shippingMethod: SHIPPING[shippingMethod] ? shippingMethod : 'standard',
    shipping,
    tax,
    codFee,
    total,
  };
}

function validateCustomer(c = {}) {
  const required = ['name', 'email', 'address', 'city', 'zip', 'country'];
  for (const f of required) {
    if (!c[f] || !String(c[f]).trim()) throw new Error(`Missing field: ${f}`);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) throw new Error('Invalid email address.');
  const clean = {};
  for (const f of [...required, 'phone']) clean[f] = String(c[f] || '').trim().slice(0, 200);
  return clean;
}

// Create a hosted Stripe Checkout session (card data never touches this server).
async function createStripeSession(order) {
  const params = new URLSearchParams();
  params.append('mode', 'payment');
  params.append('customer_email', order.customer.email);
  params.append('client_reference_id', order.id);
  params.append('success_url', `${BASE_URL}/success.html?order=${order.id}&session_id={CHECKOUT_SESSION_ID}`);
  params.append('cancel_url', `${BASE_URL}/checkout.html?cancelled=1`);
  // Send a single line item for the final total so discounts, tax and shipping match exactly.
  params.append('line_items[0][quantity]', '1');
  params.append('line_items[0][price_data][currency]', 'usd');
  params.append('line_items[0][price_data][unit_amount]', String(Math.round(order.pricing.total * 100)));
  params.append('line_items[0][price_data][product_data][name]', `Kosuke Beauty order ${order.id}`);
  params.append(
    'line_items[0][price_data][product_data][description]',
    order.pricing.lines.map((l) => `${l.qty}× ${l.name} (${l.shade})`).join(', ').slice(0, 500)
  );

  const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json.error?.message || 'Stripe error');
  return json;
}

async function fetchStripeSession(id) {
  const resp = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${STRIPE_KEY}` },
  });
  if (!resp.ok) return null;
  return resp.json();
}

function newOrderId() {
  return 'KB-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/products') {
    return sendJson(res, 200, products);
  }

  if (req.method === 'GET' && url.pathname === '/api/config') {
    return sendJson(res, 200, {
      stripeEnabled: Boolean(STRIPE_KEY),
      shipping: SHIPPING,
      taxRate: TAX_RATE,
      codFee: COD_FEE,
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/quote') {
    const body = await readBody(req);
    return sendJson(res, 200, priceOrder(body));
  }

  if (req.method === 'POST' && url.pathname === '/api/checkout') {
    const body = await readBody(req);
    const paymentMethod = body.paymentMethod;
    if (!PAYMENT_METHODS.includes(paymentMethod)) throw new Error('Choose a payment method.');

    const customer = validateCustomer(body.customer);
    const pricing = priceOrder({ ...body, paymentMethod });
    const order = {
      id: newOrderId(),
      createdAt: new Date().toISOString(),
      customer,
      pricing,
      payment: { method: paymentMethod, status: 'pending' },
    };

    if (paymentMethod === 'card') {
      if (STRIPE_KEY) {
        const session = await createStripeSession(order);
        order.payment.provider = 'stripe';
        order.payment.sessionId = session.id;
        const orders = loadOrders();
        orders[order.id] = order;
        saveOrders(orders);
        return sendJson(res, 200, { orderId: order.id, redirectUrl: session.url });
      }
      // Demo mode: the browser validated the card and only sends brand + last 4 digits.
      const card = body.card || {};
      if (!/^\d{4}$/.test(String(card.last4 || ''))) throw new Error('Card details are invalid.');
      order.payment = { method: 'card', provider: 'demo', brand: String(card.brand || 'Card').slice(0, 20), last4: card.last4, status: 'paid' };
    } else if (paymentMethod === 'paypal') {
      const email = String(body.paypalEmail || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter your PayPal email.');
      order.payment = { method: 'paypal', provider: 'demo', account: email, status: 'paid' };
    } else if (paymentMethod === 'upi') {
      const vpa = String(body.upiId || '').trim();
      if (!/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(vpa)) throw new Error('Enter a valid UPI ID (e.g. name@bank).');
      order.payment = { method: 'upi', provider: 'demo', account: vpa, status: 'paid' };
    } else if (paymentMethod === 'cod') {
      order.payment = { method: 'cod', status: 'due on delivery' };
    }

    const orders = loadOrders();
    orders[order.id] = order;
    saveOrders(orders);
    return sendJson(res, 200, { orderId: order.id, redirectUrl: `/success.html?order=${order.id}` });
  }

  const orderMatch = url.pathname.match(/^\/api\/orders\/(KB-[A-F0-9]{8})$/);
  if (req.method === 'GET' && orderMatch) {
    const orders = loadOrders();
    const order = orders[orderMatch[1]];
    if (!order) return sendJson(res, 404, { error: 'Order not found.' });

    // Confirm Stripe payments with Stripe itself, not with the redirect URL.
    if (order.payment.provider === 'stripe' && order.payment.status !== 'paid' && STRIPE_KEY) {
      const session = await fetchStripeSession(order.payment.sessionId);
      if (session && session.payment_status === 'paid') {
        order.payment.status = 'paid';
        orders[order.id] = order;
        saveOrders(orders);
      }
    }
    return sendJson(res, 200, order);
  }

  return sendJson(res, 404, { error: 'Not found' });
}

function serveStatic(req, res, url) {
  let filePath = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(url.pathname)));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  if (url.pathname.endsWith('/')) filePath = path.join(filePath, 'index.html');

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, url);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }
  serveStatic(req, res, url);
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Kosuke Beauty running at ${BASE_URL}`);
    console.log(STRIPE_KEY ? 'Card payments: Stripe Checkout' : 'Card payments: demo mode (set STRIPE_SECRET_KEY for Stripe)');
  });
}

module.exports = { server, priceOrder };
