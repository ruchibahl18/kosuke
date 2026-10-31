# Kosuke Beauty 💄

An online makeup store with a product catalog, shopping bag, checkout and several payment options.
It runs on plain Node.js with **no dependencies**.

## Features

- **Storefront**: 13 products in 5 categories (Lips, Eyes, Face, Cheeks, Tools), with category filters, search, sorting, shade swatches and a quick-view dialog.
- **Shopping bag**: a slide-out drawer, saved in `localStorage`, with quantity controls and a free-shipping progress note.
- **Checkout**
  - Contact and shipping address form
  - Delivery choice: Standard ($5.99, free over $50) or Express ($14.99)
  - Promo codes: `GLOW10` (10% off), `WELCOME15` (15% off)
  - 8% tax, and a live order summary that the **server** prices, so the browser can't change totals
- **Payment options**
  | Method | Behaviour |
  | --- | --- |
  | Credit / Debit card | Uses **Stripe Checkout** when `STRIPE_SECRET_KEY` is set. Otherwise a demo flow with card formatting, brand detection, Luhn, expiry and CVC checks. Only the brand and last 4 digits are sent to the server. |
  | PayPal | Demo flow (checks the PayPal email) |
  | UPI | Demo flow (checks the UPI ID, e.g. `name@bank`) |
  | Cash on delivery | Places the order with a $2 COD fee; payment is due on delivery |
- **Order confirmation page**, with orders saved to `data/orders.json`

## Run it

```bash
npm start
```

Then open http://localhost:3000.

To test a card payment in demo mode, use `4242 4242 4242 4242` with any future expiry date and any 3-digit CVC.

### Real card payments with Stripe

```bash
STRIPE_SECRET_KEY=sk_test_xxx BASE_URL=http://localhost:3000 npm start
```

When the key is set, card checkout sends the customer to Stripe's hosted payment page. The order is marked
**paid** only after the server confirms the Checkout Session with Stripe.

> PayPal and UPI are simulated. To take real payments, connect them to a provider (for example the PayPal
> Orders API, or Razorpay/Stripe for UPI) inside the matching branches of `/api/checkout` in `server.js`.

## Project layout

```
server.js            HTTP server, pricing rules, orders API, Stripe integration
data/products.json   Product catalog
public/index.html    Storefront
public/checkout.html Checkout
public/success.html  Order confirmation
public/js/           common.js (cart and drawer), shop.js, checkout.js
public/css/          styles.css
```

## API

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/products` | Product catalog |
| GET | `/api/config` | Shipping, tax, promo codes and whether Stripe is on |
| POST | `/api/quote` | Price a bag: `{ items, shippingMethod, paymentMethod, promoCode }` |
| POST | `/api/checkout` | Place an order and return `{ orderId, redirectUrl }` |
| GET | `/api/orders/:id` | Look up an order (also confirms Stripe payment) |
