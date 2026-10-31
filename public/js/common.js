// Shared helpers: cart storage, formatting, product artwork, cart drawer.
const CART_KEY = 'kosuke-cart';

const money = (n) => '$' + Number(n).toFixed(2);

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const Cart = {
  get() {
    try {
      return JSON.parse(localStorage.getItem(CART_KEY)) || [];
    } catch {
      return [];
    }
  },
  save(items) {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
    document.dispatchEvent(new CustomEvent('cart:change'));
  },
  add(id, shade, qty = 1) {
    const items = Cart.get();
    const existing = items.find((i) => i.id === id && i.shade === shade);
    if (existing) existing.qty = Math.min(20, existing.qty + qty);
    else items.push({ id, shade, qty });
    Cart.save(items);
  },
  setQty(index, qty) {
    const items = Cart.get();
    if (!items[index]) return;
    if (qty <= 0) items.splice(index, 1);
    else items[index].qty = Math.min(20, qty);
    Cart.save(items);
  },
  clear() {
    Cart.save([]);
  },
  count() {
    return Cart.get().reduce((s, i) => s + i.qty, 0);
  },
};

let productsCache = null;
async function loadProducts() {
  if (!productsCache) {
    const res = await fetch('/api/products');
    productsCache = await res.json();
  }
  return productsCache;
}

// Simple illustrated product art, generated as SVG from the shade colour.
function productArt(product, shadeHex) {
  const c = shadeHex || product.shades[0].hex;
  const shapes = {
    Lips: `<rect x="80" y="110" width="40" height="70" rx="4" fill="#2b2b2b"/>
           <rect x="84" y="70" width="32" height="44" rx="3" fill="#d4af7a"/>
           <path d="M86 70 L86 40 Q100 22 114 34 L114 70 Z" fill="${c}"/>`,
    Eyes: `<rect x="55" y="60" width="90" height="100" rx="10" fill="#2b2b2b"/>
           <circle cx="80" cy="90" r="14" fill="${c}"/><circle cx="120" cy="90" r="14" fill="${c}" opacity=".7"/>
           <circle cx="80" cy="130" r="14" fill="${c}" opacity=".5"/><circle cx="120" cy="130" r="14" fill="#d4af7a"/>`,
    Face: `<rect x="72" y="40" width="56" height="26" rx="6" fill="#2b2b2b"/>
           <rect x="62" y="64" width="76" height="110" rx="18" fill="${c}"/>
           <rect x="62" y="64" width="76" height="110" rx="18" fill="url(#shine)"/>`,
    Cheeks: `<circle cx="100" cy="110" r="58" fill="#2b2b2b"/>
             <circle cx="100" cy="110" r="46" fill="${c}"/>
             <circle cx="84" cy="94" r="14" fill="#fff" opacity=".25"/>`,
    Tools: `<rect x="94" y="100" width="12" height="80" rx="4" fill="#2b2b2b"/>
            <rect x="92" y="80" width="16" height="24" fill="#d4af7a"/>
            <path d="M92 80 Q100 20 108 80 Z" fill="${c}"/>`,
  };
  return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeHtml(product.name)}">
    <defs><linearGradient id="shine" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity=".25"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
    ${shapes[product.category] || shapes.Face}
  </svg>`;
}

function updateCartBadge() {
  document.querySelectorAll('[data-cart-count]').forEach((el) => {
    const n = Cart.count();
    el.textContent = n;
    el.hidden = n === 0;
  });
}

async function renderDrawer() {
  const body = document.getElementById('drawer-items');
  const footer = document.getElementById('drawer-footer');
  if (!body) return;
  const products = await loadProducts();
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));
  const items = Cart.get().filter((i) => byId[i.id]);

  if (items.length === 0) {
    body.innerHTML = `<p class="empty">Your bag is empty. Time to glow up ✨</p>`;
    footer.hidden = true;
    return;
  }

  let subtotal = 0;
  body.innerHTML = items
    .map((item, idx) => {
      const p = byId[item.id];
      const shade = p.shades.find((s) => s.name === item.shade) || p.shades[0];
      subtotal += p.price * item.qty;
      return `<div class="line">
        <div class="line-art">${productArt(p, shade.hex)}</div>
        <div class="line-info">
          <strong>${escapeHtml(p.name)}</strong>
          <span class="muted"><span class="dot" style="background:${shade.hex}"></span>${escapeHtml(shade.name)}</span>
          <div class="qty">
            <button data-qty="${idx}" data-delta="-1" aria-label="Decrease quantity">−</button>
            <span>${item.qty}</span>
            <button data-qty="${idx}" data-delta="1" aria-label="Increase quantity">+</button>
          </div>
        </div>
        <div class="line-price">${money(p.price * item.qty)}
          <button class="link" data-remove="${idx}">Remove</button>
        </div>
      </div>`;
    })
    .join('');
  footer.hidden = false;
  document.getElementById('drawer-subtotal').textContent = money(subtotal);
  const remaining = 50 - subtotal;
  document.getElementById('drawer-ship-note').textContent =
    remaining > 0 ? `Add ${money(remaining)} more for free standard shipping` : 'You’ve unlocked free standard shipping 🎉';
}

function openDrawer() {
  document.body.classList.add('drawer-open');
  renderDrawer();
}
function closeDrawer() {
  document.body.classList.remove('drawer-open');
}

function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2200);
}

document.addEventListener('DOMContentLoaded', () => {
  updateCartBadge();
  document.querySelectorAll('[data-open-cart]').forEach((b) => b.addEventListener('click', openDrawer));
  document.querySelectorAll('[data-close-cart]').forEach((b) => b.addEventListener('click', closeDrawer));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closeDrawer());

  const drawer = document.getElementById('drawer-items');
  if (drawer) {
    drawer.addEventListener('click', (e) => {
      const q = e.target.closest('[data-qty]');
      const r = e.target.closest('[data-remove]');
      const items = Cart.get();
      if (q) {
        const i = Number(q.dataset.qty);
        Cart.setQty(i, items[i].qty + Number(q.dataset.delta));
      } else if (r) {
        Cart.setQty(Number(r.dataset.remove), 0);
      }
    });
  }
});

document.addEventListener('cart:change', () => {
  updateCartBadge();
  if (document.body.classList.contains('drawer-open')) renderDrawer();
});
