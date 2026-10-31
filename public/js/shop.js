// Storefront: product grid, filtering, sorting, quick view.
(async function () {
  const products = await loadProducts();
  const grid = document.getElementById('grid');
  const filtersEl = document.getElementById('filters');
  const search = document.getElementById('search');
  const sort = document.getElementById('sort');
  const dialog = document.getElementById('quickview');
  const state = { category: 'All', query: '', sort: 'featured' };

  const categories = ['All', ...new Set(products.map((p) => p.category))];
  filtersEl.innerHTML = categories
    .map((c) => `<button role="tab" class="chip${c === 'All' ? ' active' : ''}" data-cat="${c}">${c}</button>`)
    .join('');

  const stars = (r) => '★'.repeat(Math.round(r)) + '☆'.repeat(5 - Math.round(r));

  function render() {
    let list = products.filter(
      (p) =>
        (state.category === 'All' || p.category === state.category) &&
        (p.name + ' ' + p.description + ' ' + p.category).toLowerCase().includes(state.query)
    );
    if (state.sort === 'price-asc') list = [...list].sort((a, b) => a.price - b.price);
    if (state.sort === 'price-desc') list = [...list].sort((a, b) => b.price - a.price);
    if (state.sort === 'rating') list = [...list].sort((a, b) => b.rating - a.rating);

    if (list.length === 0) {
      grid.innerHTML = `<p class="empty">No products match your search.</p>`;
      return;
    }

    grid.innerHTML = list
      .map(
        (p) => `<article class="card" data-id="${p.id}">
          ${p.badge ? `<span class="tag">${p.badge}</span>` : ''}
          <button class="card-art" data-view="${p.id}" aria-label="Quick view ${escapeHtml(p.name)}">${productArt(p)}</button>
          <div class="card-body">
            <p class="muted small">${p.category}</p>
            <h3>${escapeHtml(p.name)}</h3>
            <p class="rating" title="${p.rating} out of 5"><span>${stars(p.rating)}</span> <span class="muted small">(${p.reviews})</span></p>
            <div class="shades" role="radiogroup" aria-label="Shade">
              ${p.shades
                .map(
                  (s, i) =>
                    `<button class="shade${i === 0 ? ' active' : ''}" role="radio" aria-checked="${i === 0}" title="${escapeHtml(s.name)}" aria-label="${escapeHtml(s.name)}" data-shade="${escapeHtml(s.name)}" data-hex="${s.hex}" style="background:${s.hex}"></button>`
                )
                .join('')}
            </div>
            <div class="card-foot">
              <strong class="price">${money(p.price)}</strong>
              <button class="btn btn-small" data-add="${p.id}">Add to bag</button>
            </div>
          </div>
        </article>`
      )
      .join('');
  }

  function openQuickView(id) {
    const p = products.find((x) => x.id === id);
    let shade = p.shades[0];
    let qty = 1;
    const draw = () => {
      dialog.innerHTML = `<button class="icon-btn qv-close" aria-label="Close">×</button>
        <div class="qv-grid">
          <div class="qv-art">${productArt(p, shade.hex)}</div>
          <div>
            <p class="muted small">${p.category}</p>
            <h2>${escapeHtml(p.name)}</h2>
            <p class="rating"><span>${stars(p.rating)}</span> <span class="muted small">${p.rating} · ${p.reviews} reviews</span></p>
            <p class="price big">${money(p.price)}</p>
            <p>${escapeHtml(p.description)}</p>
            <p class="small"><strong>Shade:</strong> ${escapeHtml(shade.name)}</p>
            <div class="shades">${p.shades
              .map(
                (s) =>
                  `<button class="shade${s.name === shade.name ? ' active' : ''}" data-qv-shade="${escapeHtml(s.name)}" aria-label="${escapeHtml(s.name)}" style="background:${s.hex}"></button>`
              )
              .join('')}</div>
            <div class="qv-actions">
              <div class="qty"><button data-qv-qty="-1" aria-label="Decrease">−</button><span>${qty}</span><button data-qv-qty="1" aria-label="Increase">+</button></div>
              <button class="btn btn-primary" data-qv-add>Add to bag · ${money(p.price * qty)}</button>
            </div>
          </div>
        </div>`;
    };
    draw();
    dialog.onclick = (e) => {
      if (e.target === dialog || e.target.closest('.qv-close')) return dialog.close();
      const s = e.target.closest('[data-qv-shade]');
      const q = e.target.closest('[data-qv-qty]');
      if (s) shade = p.shades.find((x) => x.name === s.dataset.qvShade);
      if (q) qty = Math.max(1, Math.min(20, qty + Number(q.dataset.qvQty)));
      if (e.target.closest('[data-qv-add]')) {
        Cart.add(p.id, shade.name, qty);
        dialog.close();
        openDrawer();
        return;
      }
      if (s || q) draw();
    };
    dialog.showModal();
  }

  filtersEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    state.category = b.dataset.cat;
    filtersEl.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === b));
    render();
  });
  search.addEventListener('input', () => {
    state.query = search.value.trim().toLowerCase();
    render();
  });
  sort.addEventListener('change', () => {
    state.sort = sort.value;
    render();
  });

  grid.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const shadeBtn = e.target.closest('.shade');
    if (shadeBtn) {
      card.querySelectorAll('.shade').forEach((s) => {
        s.classList.toggle('active', s === shadeBtn);
        s.setAttribute('aria-checked', s === shadeBtn);
      });
      const p = products.find((x) => x.id === card.dataset.id);
      card.querySelector('.card-art').innerHTML = productArt(p, shadeBtn.dataset.hex);
      return;
    }
    const add = e.target.closest('[data-add]');
    if (add) {
      const shade = card.querySelector('.shade.active').dataset.shade;
      Cart.add(add.dataset.add, shade, 1);
      toast('Added to your bag');
      return;
    }
    const view = e.target.closest('[data-view]');
    if (view) openQuickView(view.dataset.view);
  });

  render();
})();
