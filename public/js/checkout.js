// Checkout: order summary (priced by the server), shipping, promo codes and payment methods.
(async function () {
  const form = document.getElementById('checkout-form');
  const notice = document.getElementById('notice');
  const placeBtn = document.getElementById('place-order');
  const promoInput = document.getElementById('promo');
  const promoMsg = document.getElementById('promo-msg');
  let appliedPromo = '';

  const [products, config] = await Promise.all([loadProducts(), fetch('/api/config').then((r) => r.json())]);
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));

  if (Cart.get().length === 0) {
    document.querySelector('main').innerHTML =
      '<div class="panel confirm"><h1>Your bag is empty</h1><p>Add a few favourites before checking out.</p><a href="/" class="btn btn-primary">Go shopping</a></div>';
    return;
  }

  if (config.stripeEnabled) {
    document.getElementById('stripe-note').hidden = false;
    document.getElementById('card-fields').hidden = true;
  } else {
    document.getElementById('demo-note').hidden = false;
  }
  if (new URLSearchParams(location.search).get('cancelled')) {
    showNotice('Payment was cancelled. Your bag is still saved — you can try again.');
  }

  const selected = (name) => form.querySelector(`input[name="${name}"]:checked`).value;

  function showNotice(msg, isError) {
    notice.textContent = msg;
    notice.classList.toggle('error', Boolean(isError));
    notice.hidden = false;
    notice.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function cartPayload() {
    return {
      items: Cart.get(),
      shippingMethod: selected('shipping'),
      paymentMethod: selected('payment'),
      promoCode: appliedPromo,
    };
  }

  async function refreshSummary() {
    const res = await fetch('/api/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cartPayload()),
    });
    const q = await res.json();
    if (!res.ok) return showNotice(q.error, true);

    document.getElementById('summary-items').innerHTML = q.lines
      .map((l) => {
        const p = byId[l.id];
        const shade = p.shades.find((s) => s.name === l.shade) || p.shades[0];
        return `<div class="line compact">
          <div class="line-art">${productArt(p, shade.hex)}<span class="qty-badge">${l.qty}</span></div>
          <div class="line-info"><strong>${escapeHtml(l.name)}</strong><span class="muted small">${escapeHtml(l.shade)}</span></div>
          <div class="line-price">${money(l.lineTotal)}</div>
        </div>`;
      })
      .join('');

    document.getElementById('t-subtotal').textContent = money(q.subtotal);
    document.getElementById('t-shipping').textContent = q.shipping ? money(q.shipping) : 'Free';
    document.getElementById('t-tax').textContent = money(q.tax);
    document.getElementById('t-total').textContent = money(q.total);
    document.getElementById('row-discount').hidden = !q.discount;
    document.getElementById('t-discount').textContent = '−' + money(q.discount);
    document.getElementById('t-code').textContent = q.promoCode ? `(${q.promoCode})` : '';
    document.getElementById('row-cod').hidden = !q.codFee;
    document.getElementById('t-cod').textContent = money(q.codFee);
    document.getElementById('ship-standard-price').textContent =
      q.subtotal >= config.shipping.standard.freeOver ? 'Free' : money(config.shipping.standard.price);
    placeBtn.textContent = `${selected('payment') === 'cod' ? 'Place order' : 'Pay'} · ${money(q.total)}`;
    return q;
  }

  // ---- Payment method switching ----
  function showPaymentPanel() {
    const method = selected('payment');
    document.querySelectorAll('.pay-panel').forEach((p) => (p.hidden = p.dataset.pay !== method));
    document.querySelectorAll('#payment-options .option').forEach((o) =>
      o.classList.toggle('active', o.querySelector('input').checked)
    );
  }
  function highlightShipping() {
    document.querySelectorAll('#shipping-options .option').forEach((o) =>
      o.classList.toggle('active', o.querySelector('input').checked)
    );
  }
  form.addEventListener('change', (e) => {
    if (e.target.name === 'payment') showPaymentPanel();
    if (e.target.name === 'shipping') highlightShipping();
    if (e.target.name === 'payment' || e.target.name === 'shipping') refreshSummary();
  });

  // ---- Promo codes ----
  document.getElementById('apply-promo').addEventListener('click', async () => {
    const code = promoInput.value.trim().toUpperCase();
    appliedPromo = code;
    const q = await refreshSummary();
    if (!code) {
      promoMsg.textContent = '';
    } else if (q && q.promoCode) {
      promoMsg.textContent = `Code ${q.promoCode} applied!`;
      promoMsg.className = 'small ok';
    } else {
      appliedPromo = '';
      promoMsg.textContent = 'That code isn’t valid.';
      promoMsg.className = 'small err';
    }
  });

  // ---- Card input formatting & validation ----
  const cardNumber = document.getElementById('card-number');
  const cardExp = document.getElementById('card-exp');
  const cardCvc = document.getElementById('card-cvc');
  const brandEl = document.getElementById('card-brand');

  function cardBrand(num) {
    if (/^4/.test(num)) return 'Visa';
    if (/^(5[1-5]|2[2-7])/.test(num)) return 'Mastercard';
    if (/^3[47]/.test(num)) return 'Amex';
    if (/^6(011|5)/.test(num)) return 'Discover';
    return '';
  }
  function luhn(num) {
    let sum = 0;
    let dbl = false;
    for (let i = num.length - 1; i >= 0; i--) {
      let d = Number(num[i]);
      if (dbl) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
      dbl = !dbl;
    }
    return sum % 10 === 0;
  }
  cardNumber.addEventListener('input', () => {
    const digits = cardNumber.value.replace(/\D/g, '').slice(0, 19);
    cardNumber.value = digits.replace(/(.{4})/g, '$1 ').trim();
    brandEl.textContent = cardBrand(digits);
  });
  cardExp.addEventListener('input', () => {
    const d = cardExp.value.replace(/\D/g, '').slice(0, 4);
    cardExp.value = d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d;
  });
  cardCvc.addEventListener('input', () => (cardCvc.value = cardCvc.value.replace(/\D/g, '').slice(0, 4)));

  function validateCard() {
    const num = cardNumber.value.replace(/\D/g, '');
    if (num.length < 13 || !luhn(num)) return 'Please enter a valid card number.';
    if (!document.getElementById('card-name').value.trim()) return 'Please enter the name on the card.';
    const m = cardExp.value.match(/^(\d{2})\/(\d{2})$/);
    if (!m || +m[1] < 1 || +m[1] > 12) return 'Please enter a valid expiry date (MM/YY).';
    const expEnd = new Date(2000 + +m[2], +m[1], 1);
    if (expEnd <= new Date()) return 'This card has expired.';
    const cvcLen = cardBrand(num) === 'Amex' ? 4 : 3;
    if (cardCvc.value.length !== cvcLen) return `CVC must be ${cvcLen} digits.`;
    return null;
  }

  // ---- Submit ----
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    notice.hidden = true;

    const fd = new FormData(form);
    const customer = Object.fromEntries(['name', 'email', 'phone', 'address', 'city', 'zip', 'country'].map((k) => [k, fd.get(k)]));
    const missing = form.querySelector('.fields [required]:invalid');
    if (missing) {
      missing.focus();
      return showNotice('Please complete your contact and shipping details.', true);
    }

    const payload = { ...cartPayload(), customer };
    const method = payload.paymentMethod;

    if (method === 'card' && !config.stripeEnabled) {
      const err = validateCard();
      if (err) return showNotice(err, true);
      const num = cardNumber.value.replace(/\D/g, '');
      // Only the brand and last 4 digits ever leave the browser.
      payload.card = { brand: cardBrand(num) || 'Card', last4: num.slice(-4) };
    } else if (method === 'paypal') {
      payload.paypalEmail = document.getElementById('paypal-email').value;
    } else if (method === 'upi') {
      payload.upiId = document.getElementById('upi-id').value;
    }

    placeBtn.disabled = true;
    const label = placeBtn.textContent;
    placeBtn.textContent = method === 'cod' ? 'Placing order…' : 'Processing payment…';
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');
      location.href = data.redirectUrl;
    } catch (err) {
      showNotice(err.message, true);
      placeBtn.disabled = false;
      placeBtn.textContent = label;
    }
  });

  showPaymentPanel();
  highlightShipping();
  refreshSummary();
})();
