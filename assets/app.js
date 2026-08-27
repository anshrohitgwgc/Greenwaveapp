/* ==========================================================================
   Greenwave Ops — application
   ========================================================================== */
(function () {
  'use strict';

  var S = window.Store;

  /* Sales tax follows the province the goods ship FROM, so it belongs to the
     warehouse, not to the company. BC PST is deliberately absent: whether it
     applies to recyclable material sold for reprocessing is a question for
     your accountant, not a default this app should guess at. */
  var TAX = {
    AB: { label: 'GST @ 5%',  rate: 0.05, code: 'GST' },
    BC: { label: 'GST @ 5%',  rate: 0.05, code: 'GST' },
    ON: { label: 'HST @ 13%', rate: 0.13, code: 'HST' },
    SK: { label: 'GST @ 5%',  rate: 0.05, code: 'GST' },
    MB: { label: 'GST @ 5%',  rate: 0.05, code: 'GST' },
    QC: { label: 'GST @ 5%',  rate: 0.05, code: 'GST' },
    NS: { label: 'HST @ 15%', rate: 0.15, code: 'HST' },
    NB: { label: 'HST @ 15%', rate: 0.15, code: 'HST' },
    NL: { label: 'HST @ 15%', rate: 0.15, code: 'HST' },
    PE: { label: 'HST @ 15%', rate: 0.15, code: 'HST' }
  };
  var PROVINCES = Object.keys(TAX);

  // ------------------------------------------------------------- helpers
  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function money(cents) {
    var neg = cents < 0;
    var v = Math.abs(cents) / 100;
    return (neg ? '-$' : '$') + v.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function parseMoney(str) {
    var n = parseFloat(String(str).replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? Math.round(n * 100) : 0;
  }
  function parseQty(str) {
    var n = parseFloat(String(str).replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : 0;
  }
  function num(n, dp) {
    return Number(n || 0).toLocaleString('en-CA', {
      minimumFractionDigits: dp || 0, maximumFractionDigits: dp === undefined ? 3 : dp
    });
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  function addDays(iso, days) {
    var d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, 2400);
  }

  function emptyState(icon, title, body, ctaLabel, ctaAction) {
    return '<div class="card"><div class="empty">' +
      '<span class="eico"><svg><use href="#i-' + icon + '"></use></svg></span>' +
      '<h3>' + esc(title) + '</h3><p>' + body + '</p>' +
      (ctaLabel ? '<button type="button" class="btn" data-action="' + ctaAction + '">' +
        '<svg><use href="#i-plus"></use></svg>' + esc(ctaLabel) + '</button>' : '') +
      '</div></div>';
  }

  // ------------------------------------------------------------- state
  var db = S.get();
  var entity = db.lastEntity || 'recycling';
  var warehouseId = (db.warehouses[0] || {}).id;
  var view = 'invoices';
  var draft = null;   // invoice being edited

  function warehouse() {
    return db.warehouses.filter(function (w) { return w.id === warehouseId; })[0] || db.warehouses[0];
  }
  function taxFor(prov) { return TAX[prov] || TAX.BC; }
  function products() {
    return db.products.filter(function (p) { return p.entity === entity; });
  }
  function isRecycling() { return entity === 'recycling'; }

  // ------------------------------------------------------------- modal
  var modalSubmit = null;

  function openModal(title, fieldsHtml, onSubmit, okLabel) {
    $('#modalTitle').textContent = title;
    $('#modalForm').innerHTML = fieldsHtml;
    $('#modalOk').textContent = okLabel || 'Save';
    $('#modalWrap').hidden = false;
    modalSubmit = onSubmit;
    var first = $('#modalForm input, #modalForm select, #modalForm textarea');
    if (first) first.focus();
  }
  function closeModal() {
    $('#modalWrap').hidden = true;
    $('#modalForm').innerHTML = '';
    modalSubmit = null;
  }
  $('#modalClose').addEventListener('click', closeModal);
  $('#modalCancel').addEventListener('click', closeModal);
  $('#modalWrap').addEventListener('mousedown', function (e) {
    if (e.target === $('#modalWrap')) closeModal();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('#modalWrap').hidden) closeModal();
  });
  $('#modalForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var data = {};
    $$('#modalForm [name]').forEach(function (el) {
      data[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim();
    });
    if (modalSubmit) modalSubmit(data);
  });

  function field(name, label, opts) {
    opts = opts || {};
    var v = opts.value == null ? '' : opts.value;
    var input;
    if (opts.type === 'select') {
      input = '<select name="' + name + '"' + (opts.required ? ' required' : '') + '>' +
        opts.options.map(function (o) {
          return '<option value="' + esc(o.value) + '"' + (String(o.value) === String(v) ? ' selected' : '') + '>' + esc(o.label) + '</option>';
        }).join('') + '</select>';
    } else if (opts.type === 'textarea') {
      input = '<textarea name="' + name + '">' + esc(v) + '</textarea>';
    } else {
      input = '<input type="' + (opts.type || 'text') + '" name="' + name + '" value="' + esc(v) + '"' +
        (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '') +
        (opts.step ? ' step="' + opts.step + '"' : '') +
        (opts.required ? ' required' : '') + '>';
    }
    return '<div class="field"><label for="' + name + '">' + esc(label) + '</label>' + input +
      (opts.help ? '<span class="help">' + opts.help + '</span>' : '') + '</div>';
  }

  // ------------------------------------------------------------- chrome
  function syncChrome() {
    document.documentElement.setAttribute('data-entity', entity);
    $('#brandEntity').textContent = isRecycling() ? 'Recycling' : 'Healthcare';

    $$('.entsw button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.entity === entity));
    });
    $$('[data-only]').forEach(function (el) {
      el.hidden = el.dataset.only !== entity;
    });

    $('#intakeNav').textContent   = isRecycling() ? 'Weigh-in' : 'Receive';
    $('#productsNav').textContent = isRecycling() ? 'Materials' : 'Products';

    var sel = $('#wh');
    sel.innerHTML = db.warehouses.map(function (w) {
      return '<option value="' + esc(w.id) + '">' + esc(w.name) + '</option>';
    }).join('');
    sel.value = warehouseId;

    var w = warehouse();
    $('#taxNote').textContent = w ? w.province + ' · ' + taxFor(w.province).label : '';
  }

  function show(next) {
    // Invoicing is Recycling-only: Healthcare doesn't raise these invoices.
    if (next === 'invoices' && !isRecycling()) next = 'inventory';
    if (next === 'editor' && !isRecycling()) next = 'inventory';
    view = next;

    $$('.view').forEach(function (v) { v.classList.remove('on'); });
    var el = $('#v-' + view);
    if (el) el.classList.add('on');

    $$('.navitem').forEach(function (b) {
      var active = b.dataset.view === view || (view === 'editor' && b.dataset.view === 'invoices');
      if (active) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
    $('#scroll').scrollTop = 0;
    render();
  }

  // ------------------------------------------------------------- inventory
  function balances() {
    // Derived from tickets every time — never a stored counter that can drift
    // away from the tickets underneath it.
    var map = {};
    products().forEach(function (p) {
      map[p.id] = { product: p, bySize: {}, total: 0 };
      (p.sizes || []).forEach(function (z) { map[p.id].bySize[z] = 0; });
    });
    db.tickets.forEach(function (t) {
      if (t.entity !== entity || t.warehouseId !== warehouseId) return;
      var row = map[t.productId];
      if (!row) return;
      var sign = t.direction === 'out' ? -1 : 1;
      if (t.qtyBySize) {
        Object.keys(t.qtyBySize).forEach(function (z) {
          var q = Number(t.qtyBySize[z]) || 0;
          if (row.bySize[z] === undefined) row.bySize[z] = 0;
          row.bySize[z] += sign * q;
          row.total += sign * q;
        });
      } else {
        row.total += sign * (Number(t.qty) || 0);
      }
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  function renderInventory() {
    var w = warehouse();
    $('#invenSub').textContent = w
      ? 'On hand at ' + w.name + '. Every number is derived from posted tickets.'
      : 'Add a warehouse in Settings first.';
    $('#invenCta').textContent = isRecycling() ? 'Record a load' : 'Receive stock';

    var list = products();
    if (!list.length) {
      $('#invenBody').innerHTML = emptyState('tag',
        (isRecycling() ? 'No materials yet' : 'No products yet'),
        'Inventory is a running total of what you have received less what you have shipped. Add what you handle first, then record a load.',
        (isRecycling() ? 'Add material' : 'Add product'), 'goProducts');
      return;
    }

    var rows = balances();
    var sizes = [];
    rows.forEach(function (r) {
      (r.product.sizes || []).forEach(function (z) { if (sizes.indexOf(z) < 0) sizes.push(z); });
    });

    var head = '<tr><th>' + (isRecycling() ? 'Material' : 'Product') + '</th><th>Category</th>' +
      sizes.map(function (z) { return '<th class="num">' + esc(z) + '</th>'; }).join('') +
      '<th class="num">On hand</th><th>Unit</th></tr>';

    var body = rows.map(function (r) {
      var cells = sizes.map(function (z) {
        var has = (r.product.sizes || []).indexOf(z) >= 0;
        if (!has) return '<td class="num" style="color:var(--muted)">–</td>';
        return '<td class="num">' + num(r.bySize[z] || 0) + '</td>';
      }).join('');
      return '<tr><td><strong>' + esc(r.product.name) + '</strong></td>' +
        '<td style="color:var(--muted)">' + esc(r.product.category || '—') + '</td>' + cells +
        '<td class="num"><strong>' + num(r.total) + '</strong></td>' +
        '<td style="color:var(--muted)">' + esc(r.product.unit) + '</td></tr>';
    }).join('');

    var colTotals = sizes.map(function (z) {
      return rows.reduce(function (a, r) { return a + (r.bySize[z] || 0); }, 0);
    });
    var grand = rows.reduce(function (a, r) { return a + r.total; }, 0);

    var foot = '<tr><td>Total</td><td></td>' +
      colTotals.map(function (c) { return '<td class="num">' + num(c) + '</td>'; }).join('') +
      '<td class="num">' + num(grand) + '</td><td style="font-weight:400;color:var(--muted)">summed from rows</td></tr>';

    $('#invenBody').innerHTML =
      '<div class="card"><div class="cardhead"><h3>On hand — ' + esc(w ? w.name : '') + '</h3>' +
      '<span class="sub">' + db.tickets.filter(function (t) {
        return t.entity === entity && t.warehouseId === warehouseId;
      }).length + ' tickets posted here</span></div>' +
      '<div class="tablewrap"><table><thead>' + head + '</thead><tbody>' + body + '</tbody>' +
      '<tfoot>' + foot + '</tfoot></table></div></div>' +
      '<div class="note"><svg><use href="#i-check"></use></svg><div>' +
      '<b>Nothing here is typed in directly.</b> To change a number, record a ticket or an adjustment — ' +
      'so every figure can be traced back to the load that produced it.</div></div>';
  }

  // ------------------------------------------------------------- intake
  function renderIntake() {
    var w = warehouse();
    $('#intakeTitle').textContent = isRecycling() ? 'Weigh-in' : 'Receive stock';
    $('#intakeSub').textContent = isRecycling()
      ? 'Gross less tare gives net. Net posts to ' + (w ? w.name : 'the warehouse') + '.'
      : 'Count what arrived against the container. Accepted units post to ' + (w ? w.name : 'the warehouse') + '.';

    var list = products();
    if (!list.length) {
      $('#intakeBody').innerHTML = emptyState('tag',
        (isRecycling() ? 'No materials yet' : 'No products yet'),
        'You need something to weigh before you can weigh it. Add your first ' +
        (isRecycling() ? 'material' : 'product') + ' and its unit.',
        (isRecycling() ? 'Add material' : 'Add product'), 'goProducts');
      return;
    }

    var sel = list.map(function (p) {
      return '<option value="' + esc(p.id) + '">' + esc(p.name) + ' (' + esc(p.unit) + ')</option>';
    }).join('');

    $('#intakeBody').innerHTML =
      '<div class="card"><div class="cardhead"><h3>' + (isRecycling() ? 'Inbound ticket' : 'Receipt') + '</h3></div>' +
      '<div class="pad"><div class="grid g2">' +
        '<div class="field"><label>' + (isRecycling() ? 'Material' : 'Product') + '</label><select id="tkProduct">' + sel + '</select></div>' +
        '<div class="field"><label>Direction</label><select id="tkDir">' +
          '<option value="in">In — arriving</option><option value="out">Out — shipping</option></select></div>' +
        '<div class="field"><label>Date</label><input type="date" id="tkDate" value="' + today() + '"></div>' +
        '<div class="field"><label>Reference</label><input type="text" id="tkRef" class="mono" placeholder="Container, truck or BOL"></div>' +
      '</div><div id="tkQty" style="margin-top:16px"></div>' +
      '<div style="display:flex;gap:8px;margin-top:18px">' +
        '<button type="button" class="btn" id="tkPost"><svg><use href="#i-check"></use></svg>Post ticket</button>' +
      '</div>' +
      '<p class="help" style="margin:12px 0 0;color:var(--muted);font-size:13px">' +
        'Posting is final — a mistake is corrected with an opposite ticket, so both stay on the record.</p>' +
      '</div></div>' +
      '<div id="tkRecent"></div>';

    $('#tkProduct').addEventListener('change', renderQtyFields);
    $('#tkPost').addEventListener('click', postTicket);
    renderQtyFields();
    renderRecentTickets();
  }

  function currentProduct() {
    var id = $('#tkProduct') ? $('#tkProduct').value : null;
    return products().filter(function (p) { return p.id === id; })[0];
  }

  function renderQtyFields() {
    var p = currentProduct();
    if (!p) return;
    var host = $('#tkQty');

    if (p.sizes && p.sizes.length) {
      host.innerHTML = '<div class="grid g3">' + p.sizes.map(function (z) {
        return '<div class="field"><label>' + esc(z) + '</label>' +
          '<input type="number" step="any" min="0" data-size="' + esc(z) + '" placeholder="0"></div>';
      }).join('') + '</div>' +
      '<div class="trow" style="margin-top:14px"><span class="lb">Total this ticket</span>' +
      '<span class="vl" id="tkTotal">0 ' + esc(p.unit) + '</span></div>';
      $$('#tkQty input').forEach(function (i) { i.addEventListener('input', updateQtyTotal); });
    } else if (p.capture === 'weighed') {
      host.innerHTML = '<div class="grid g3">' +
        '<div class="field"><label>Gross (' + esc(p.unit) + ')</label><input type="number" step="any" min="0" id="tkGross" placeholder="0"></div>' +
        '<div class="field"><label>Tare (' + esc(p.unit) + ')</label><input type="number" step="any" min="0" id="tkTare" placeholder="0"></div>' +
        '<div class="field"><label>Net</label><input type="text" id="tkNet" value="0" readonly style="background:var(--panel-2);font-weight:600"></div>' +
        '</div><div id="tkWarn"></div>';
      $('#tkGross').addEventListener('input', updateNet);
      $('#tkTare').addEventListener('input', updateNet);
    } else {
      host.innerHTML = '<div class="grid g3">' +
        '<div class="field"><label>Quantity (' + esc(p.unit) + ')</label><input type="number" step="any" min="0" id="tkQtyOne" placeholder="0"></div>' +
        '</div>';
    }
  }

  function updateQtyTotal() {
    var p = currentProduct();
    var t = 0;
    $$('#tkQty input[data-size]').forEach(function (i) { t += parseQty(i.value); });
    $('#tkTotal').textContent = num(t) + ' ' + (p ? p.unit : '');
  }

  function updateNet() {
    var g = parseQty($('#tkGross').value);
    var t = parseQty($('#tkTare').value);
    var net = g - t;
    $('#tkNet').value = num(net);
    // A tare above gross is a data-entry error, not a negative load.
    $('#tkWarn').innerHTML = (g > 0 && net <= 0)
      ? '<div class="note" style="border-left-color:var(--crit)"><svg style="color:var(--crit)"><use href="#i-alert"></use></svg>' +
        '<div>Tare is higher than gross — check both weights before posting.</div></div>'
      : '';
  }

  function postTicket() {
    var p = currentProduct();
    if (!p) return;
    var t = {
      id: S.uid('tk'),
      entity: entity,
      warehouseId: warehouseId,
      productId: p.id,
      direction: $('#tkDir').value,
      date: $('#tkDate').value || today(),
      ref: $('#tkRef').value.trim(),
      postedAt: new Date().toISOString()
    };

    if (p.sizes && p.sizes.length) {
      var by = {}, total = 0;
      $$('#tkQty input[data-size]').forEach(function (i) {
        var q = parseQty(i.value);
        if (q) { by[i.dataset.size] = q; total += q; }
      });
      if (!total) { toast('Enter a quantity for at least one size.'); return; }
      t.qtyBySize = by;
    } else if (p.capture === 'weighed') {
      var g = parseQty($('#tkGross').value), ta = parseQty($('#tkTare').value);
      var net = g - ta;
      if (net <= 0) { toast('Net must be more than zero.'); return; }
      t.gross = g; t.tare = ta; t.qty = net;
    } else {
      var q = parseQty($('#tkQtyOne').value);
      if (q <= 0) { toast('Enter a quantity.'); return; }
      t.qty = q;
    }

    db.tickets.push(t);
    S.save();
    toast('Ticket posted.');
    renderIntake();
  }

  function renderRecentTickets() {
    var mine = db.tickets.filter(function (t) {
      return t.entity === entity && t.warehouseId === warehouseId;
    }).slice(-8).reverse();
    if (!mine.length) { $('#tkRecent').innerHTML = ''; return; }

    var byId = {};
    db.products.forEach(function (p) { byId[p.id] = p; });

    $('#tkRecent').innerHTML =
      '<div class="card"><div class="cardhead"><h3>Recent tickets here</h3></div>' +
      '<div class="tablewrap"><table><thead><tr><th>Date</th><th>' +
      (isRecycling() ? 'Material' : 'Product') + '</th><th>Reference</th><th></th><th class="num">Quantity</th></tr></thead><tbody>' +
      mine.map(function (t) {
        var p = byId[t.productId] || { name: '—', unit: '' };
        var q = t.qtyBySize
          ? Object.keys(t.qtyBySize).map(function (z) { return z + ' ' + num(t.qtyBySize[z]); }).join(' · ')
          : num(t.qty) + ' ' + p.unit;
        return '<tr><td class="mono" style="font-size:13px">' + esc(t.date) + '</td>' +
          '<td>' + esc(p.name) + '</td><td class="mono" style="font-size:12.5px;color:var(--muted)">' + esc(t.ref || '—') + '</td>' +
          '<td><span class="pill ' + (t.direction === 'out' ? 'warn' : 'good') + '">' +
          (t.direction === 'out' ? 'Out' : 'In') + '</span></td>' +
          '<td class="num">' + esc(q) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  // ------------------------------------------------------------- invoices
  function newDraft() {
    var w = warehouse();
    return {
      id: null,
      number: null,                 // assigned on first save
      customerId: null,
      shipToSame: true,
      warehouseId: w ? w.id : null,
      province: w ? w.province : 'BC',
      shipVia: 'Greenwave Recycling Truck',
      shipDate: today(),
      date: today(),
      termsDays: 15,
      notes: '',
      lines: [blankLine()]
    };
  }
  function blankLine() {
    return { date: today(), service: 'supply', unit: '', description: '', qty: 0, rateCents: 0, rebate: false };
  }

  function lineAmount(l) {
    // Round each line to the cent, then sum the rounded lines. Summing raw
    // products and rounding once at the end leaves an invoice a cent off its
    // own line items, which is exactly what an AP clerk rejects it over.
    var amt = Math.round((Number(l.qty) || 0) * (Number(l.rateCents) || 0));
    return l.rebate ? -amt : amt;
  }
  function invoiceTotals(inv) {
    var sub = inv.lines.reduce(function (a, l) { return a + lineAmount(l); }, 0);
    var t = taxFor(inv.province);
    var tax = Math.round(sub * t.rate);
    return { subtotal: sub, taxLabel: t.label, taxCode: t.code, tax: tax, total: sub + tax };
  }

  function renderInvoiceList() {
    if (!db.invoices.length) {
      $('#invoiceList').innerHTML = emptyState('doc', 'No invoices yet',
        'Create one and it saves here. Numbering continues from <b>1114</b>, so your next invoice is <b>1115</b>.',
        'New invoice', 'newInvoice');
      return;
    }
    var custById = {};
    db.customers.forEach(function (c) { custById[c.id] = c; });

    var rows = db.invoices.slice().sort(function (a, b) { return b.number - a.number; }).map(function (inv) {
      var t = invoiceTotals(inv);
      var c = custById[inv.customerId];
      var due = addDays(inv.date, inv.termsDays);
      var overdue = due < today();
      return '<tr class="click" data-invoice="' + esc(inv.id) + '">' +
        '<td class="mono"><strong>' + esc(inv.number) + '</strong></td>' +
        '<td>' + esc(c ? c.name : 'No customer') + '</td>' +
        '<td class="mono" style="font-size:13px">' + esc(inv.date) + '</td>' +
        '<td class="mono" style="font-size:13px">' + esc(due) + '</td>' +
        '<td>' + esc(inv.province) + '</td>' +
        '<td class="num">' + money(t.total) + '</td>' +
        '<td><span class="pill ' + (overdue ? 'crit' : 'flat') + '">' + (overdue ? 'Overdue' : 'Open') + '</span></td>' +
      '</tr>';
    }).join('');

    $('#invoiceList').innerHTML =
      '<div class="card"><div class="tablewrap"><table><thead><tr>' +
      '<th>No.</th><th>Customer</th><th>Date</th><th>Due</th><th>Tax</th><th class="num">Total</th><th>Status</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }

  function renderEditor() {
    if (!draft) draft = newDraft();
    var inv = draft;
    var co = db.company;
    var cust = db.customers.filter(function (c) { return c.id === inv.customerId; })[0];
    var t = invoiceTotals(inv);
    var due = addDays(inv.date, inv.termsDays);

    $('#edTitle').textContent = inv.number ? ('Invoice ' + inv.number) : 'New invoice';

    var custOptions = '<option value="">— choose a customer —</option>' +
      db.customers.map(function (c) {
        return '<option value="' + esc(c.id) + '"' + (c.id === inv.customerId ? ' selected' : '') + '>' + esc(c.name) + '</option>';
      }).join('');

    var whOptions = db.warehouses.map(function (w) {
      return '<option value="' + esc(w.id) + '"' + (w.id === inv.warehouseId ? ' selected' : '') + '>' +
        esc(w.name) + ' (' + esc(w.province) + ')</option>';
    }).join('');

    var lineRows = inv.lines.map(function (l, i) {
      return '<tr>' +
        '<td class="colno">' + (i + 1) + '.</td>' +
        '<td><input type="date" data-li="' + i + '" data-k="date" value="' + esc(l.date) + '"></td>' +
        '<td><input type="text" data-li="' + i + '" data-k="service" value="' + esc(l.service) + '" placeholder="supply"></td>' +
        '<td><input type="text" data-li="' + i + '" data-k="unit" value="' + esc(l.unit) + '" placeholder="tonne"></td>' +
        '<td><input type="text" data-li="' + i + '" data-k="description" value="' + esc(l.description) + '" placeholder="What was supplied"></td>' +
        '<td class="colqty"><input type="number" step="0.001" data-li="' + i + '" data-k="qty" value="' + (l.qty || '') + '" placeholder="0.000"></td>' +
        '<td class="colrate"><input type="text" data-li="' + i + '" data-k="rate" value="' + (l.rateCents ? (l.rateCents / 100).toFixed(2) : '') + '" placeholder="0.00"></td>' +
        '<td class="colamt num">' + money(lineAmount(l)) + '</td>' +
        '<td><label class="pill ' + (l.rebate ? 'warn' : 'flat') + '" style="cursor:pointer">' +
          '<input type="checkbox" data-li="' + i + '" data-k="rebate"' + (l.rebate ? ' checked' : '') +
          ' style="width:auto;margin:0">Rebate</label></td>' +
        '<td class="coldel"><button type="button" class="iconbtn" data-del="' + i + '" aria-label="Remove line ' + (i + 1) + '"><svg><use href="#i-trash"></use></svg></button></td>' +
      '</tr>';
    }).join('');

    $('#editorBody').innerHTML =
      '<div class="card noprint"><div class="pad"><div class="grid gset">' +
        '<div class="field"><label>Customer</label><select id="edCust">' + custOptions + '</select>' +
          (db.customers.length ? '' : '<span class="help">No customers yet — <a href="#" data-action="goCustomers">add one</a>.</span>') + '</div>' +
        '<div class="field"><label>Ships from</label><select id="edWh">' + whOptions + '</select>' +
          '<span class="help">Sets the tax rate: ' + esc(taxFor(inv.province).label) + '</span></div>' +
        '<div class="field"><label>Invoice date</label><input type="date" id="edDate" value="' + esc(inv.date) + '"></div>' +
        '<div class="field"><label>Terms (days)</label><input type="number" id="edTerms" value="' + esc(inv.termsDays) + '" min="0">' +
          '<span class="help">Due ' + esc(due) + '</span></div>' +
        '<div class="field"><label>Ship via</label><input type="text" id="edVia" value="' + esc(inv.shipVia) + '"></div>' +
        '<div class="field"><label>Ship date</label><input type="date" id="edShipDate" value="' + esc(inv.shipDate) + '"></div>' +
      '</div></div></div>' +

      '<div class="sheet" style="margin-top:16px">' +
        '<div class="shhead">' +
          '<div><div class="shword">INVOICE</div><div class="shco"><b>' + esc(co.name) + '</b><br>' +
            esc(co.bn) + '<br>' + esc(co.gst) + '</div></div>' +
          '<div class="shaddr">' + esc(co.line1) + '<br>' + esc(co.line2) + '<br>' +
            esc(co.email) + '<br>' + esc(co.phone) + '</div>' +
          '<div class="shlogo"><span class="lm"><svg><use href="#i-leaf"></use></svg></span>' +
            '<b>Greenwave<br>Recycling Inc.</b></div>' +
        '</div>' +

        '<div class="shband">' +
          '<div><span class="shk">Bill to</span>' + (cust
            ? '<div>' + esc(cust.name) + '<br>' + esc(cust.line1 || '') + '<br>' + esc(cust.line2 || '') + '</div>'
            : '<div style="color:var(--muted)">Choose a customer above</div>') + '</div>' +
          '<div><span class="shk">Ship to</span>' + (cust
            ? '<div>' + esc(cust.name) + '<br>' + esc(cust.line1 || '') + '<br>' + esc(cust.line2 || '') + '</div>'
            : '<div style="color:var(--muted)">—</div>') + '</div>' +
        '</div>' +

        '<div class="shband split">' +
          '<div><span class="shk">Shipping info</span>' +
            '<div class="shpair"><span>Ship via</span><b>' + esc(inv.shipVia) + '</b></div>' +
            '<div class="shpair"><span>Ship date</span><b>' + esc(inv.shipDate) + '</b></div>' +
            '<div class="shpair"><span>From</span><b>' + esc((db.warehouses.filter(function (w) { return w.id === inv.warehouseId; })[0] || {}).name || '—') + '</b></div>' +
          '</div>' +
          '<div><span class="shk">Invoice details</span>' +
            '<div class="shpair"><span>Invoice no.</span><b>' + esc(inv.number || 'on save') + '</b></div>' +
            '<div class="shpair"><span>Terms</span><b>Net ' + esc(inv.termsDays) + '</b></div>' +
            '<div class="shpair"><span>Invoice date</span><b>' + esc(inv.date) + '</b></div>' +
            '<div class="shpair"><span>Due date</span><b>' + esc(due) + '</b></div>' +
          '</div>' +
        '</div>' +

        '<div class="lines"><div class="tablewrap"><table><thead><tr>' +
          '<th>#</th><th>Service date</th><th>Product/service</th><th>Unit</th><th>Description</th>' +
          '<th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th><th></th><th class="coldel"></th>' +
        '</tr></thead><tbody>' + lineRows + '</tbody></table></div>' +
        '<button type="button" class="btn ghost sm addline noprint" id="edAddLine"><svg><use href="#i-plus"></use></svg>Add line</button></div>' +

        '<div class="shfoot">' +
          '<div><span class="shk">Ways to pay</span>' +
            '<div style="font-size:13px;color:var(--ink-2);line-height:1.7">' +
            esc(co.email) + '<br>' + esc(co.phone) + '</div></div>' +
          '<div class="totals">' +
            '<div class="trow"><span class="lb">Subtotal</span><span class="vl">' + money(t.subtotal) + '</span></div>' +
            '<div class="trow"><span class="lb">' + esc(t.taxLabel) + ' on ' + money(t.subtotal) + '</span><span class="vl">' + money(t.tax) + '</span></div>' +
            '<div class="tgrand"><span class="lb">' + (t.total < 0 ? 'Payable to customer' : 'Total') + '</span>' +
              '<span class="vl' + (t.total < 0 ? ' neg' : '') + '">' + money(Math.abs(t.total)) + '</span></div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      (inv.lines.some(function (l) { return l.rebate; })
        ? '<div class="note"><svg><use href="#i-check"></use></svg><div><b>This invoice has rebate lines.</b> ' +
          'Those are amounts you owe the customer for material you bought from them. They subtract from the total, ' +
          'so one document covers both directions instead of an invoice plus a separate payable.</div></div>'
        : '<div class="note"><svg><use href="#i-check"></use></svg><div>' +
          'Tick <b>Rebate</b> on a line when you are paying the customer for their material rather than charging them. ' +
          'It subtracts instead of adding.</div></div>');

    wireEditor();
  }

  function wireEditor() {
    $('#edCust').addEventListener('change', function (e) { draft.customerId = e.target.value || null; renderEditor(); });
    $('#edWh').addEventListener('change', function (e) {
      draft.warehouseId = e.target.value;
      var w = db.warehouses.filter(function (x) { return x.id === draft.warehouseId; })[0];
      draft.province = w ? w.province : 'BC';
      renderEditor();
    });
    $('#edDate').addEventListener('change', function (e) { draft.date = e.target.value; renderEditor(); });
    $('#edTerms').addEventListener('change', function (e) { draft.termsDays = parseInt(e.target.value, 10) || 0; renderEditor(); });
    $('#edVia').addEventListener('input', function (e) { draft.shipVia = e.target.value; });
    $('#edShipDate').addEventListener('change', function (e) { draft.shipDate = e.target.value; renderEditor(); });
    $('#edAddLine').addEventListener('click', function () { draft.lines.push(blankLine()); renderEditor(); });

    $$('#editorBody [data-li]').forEach(function (el) {
      var evt = el.type === 'checkbox' || el.type === 'date' ? 'change' : 'input';
      el.addEventListener(evt, function () {
        var l = draft.lines[Number(el.dataset.li)];
        var k = el.dataset.k;
        if (k === 'rebate') l.rebate = el.checked;
        else if (k === 'qty') l.qty = parseQty(el.value);
        else if (k === 'rate') l.rateCents = parseMoney(el.value);
        else l[k] = el.value;

        if (k === 'rebate') { renderEditor(); return; }
        // Update just the money, so typing isn't interrupted by a re-render.
        var row = el.closest('tr');
        if (row) row.querySelector('.colamt').textContent = money(lineAmount(l));
        updateTotalsOnly();
      });
    });

    $$('#editorBody [data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (draft.lines.length === 1) { toast('An invoice needs at least one line.'); return; }
        draft.lines.splice(Number(b.dataset.del), 1);
        renderEditor();
      });
    });
  }

  function updateTotalsOnly() {
    var t = invoiceTotals(draft);
    var rows = $$('#editorBody .totals .trow');
    if (rows[0]) rows[0].querySelector('.vl').textContent = money(t.subtotal);
    if (rows[1]) {
      rows[1].querySelector('.lb').textContent = t.taxLabel + ' on ' + money(t.subtotal);
      rows[1].querySelector('.vl').textContent = money(t.tax);
    }
    var g = $('#editorBody .tgrand');
    if (g) {
      g.querySelector('.lb').textContent = t.total < 0 ? 'Payable to customer' : 'Total';
      var v = g.querySelector('.vl');
      v.textContent = money(Math.abs(t.total));
      v.classList.toggle('neg', t.total < 0);
    }
  }

  function saveInvoice() {
    if (!draft.customerId) { toast('Choose a customer first.'); return; }
    var hasContent = draft.lines.some(function (l) { return l.description || l.qty || l.rateCents; });
    if (!hasContent) { toast('Add at least one line with a description.'); return; }

    if (!draft.id) {
      draft.id = S.uid('inv');
      draft.number = S.nextInvoiceNumber();
      db.invoices.push(draft);
    } else {
      var i = db.invoices.findIndex(function (x) { return x.id === draft.id; });
      if (i >= 0) db.invoices[i] = draft;
    }
    S.save();
    toast('Invoice ' + draft.number + ' saved.');
    renderEditor();
  }

  // ------------------------------------------------------------- customers
  function renderCustomers() {
    if (!db.customers.length) {
      $('#customerBody').innerHTML = emptyState('users', 'No customers yet',
        'Add the companies you invoice or buy material from. They will appear in the customer picker on every invoice.',
        'Add customer', 'newCustomer');
      return;
    }
    $('#customerBody').innerHTML =
      '<div class="card"><div class="tablewrap"><table><thead><tr>' +
      '<th>Name</th><th>Address</th><th>Email</th><th>Phone</th><th class="coldel"></th></tr></thead><tbody>' +
      db.customers.map(function (c) {
        return '<tr><td><strong>' + esc(c.name) + '</strong></td>' +
          '<td style="color:var(--ink-2)">' + esc([c.line1, c.line2].filter(Boolean).join(', ') || '—') + '</td>' +
          '<td style="color:var(--ink-2)">' + esc(c.email || '—') + '</td>' +
          '<td class="mono" style="font-size:13px">' + esc(c.phone || '—') + '</td>' +
          '<td><button type="button" class="iconbtn" data-delcust="' + esc(c.id) + '" aria-label="Remove ' + esc(c.name) + '"><svg><use href="#i-trash"></use></svg></button></td></tr>';
      }).join('') + '</tbody></table></div></div>';

    $$('[data-delcust]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.dataset.delcust;
        var used = db.invoices.some(function (i) { return i.customerId === id; });
        if (used) { toast('That customer is on an invoice and cannot be removed.'); return; }
        db.customers = db.customers.filter(function (c) { return c.id !== id; });
        S.save(); render(); toast('Customer removed.');
      });
    });
  }

  function customerModal() {
    openModal('Add customer',
      field('name', 'Company name', { required: true, placeholder: 'Fibertech Supply Chain Inc.' }) +
      field('line1', 'Address line 1', { placeholder: '7901 Progress Way' }) +
      field('line2', 'Address line 2', { placeholder: 'Delta BC V4G 1A3' }) +
      field('email', 'Email', { type: 'email' }) +
      field('phone', 'Phone', {}),
      function (d) {
        if (!d.name) return;
        db.customers.push({ id: S.uid('cus'), name: d.name, line1: d.line1, line2: d.line2, email: d.email, phone: d.phone });
        S.save(); closeModal(); render(); toast('Customer added.');
      });
  }

  // ------------------------------------------------------------- products
  function renderProducts() {
    $('#prodTitle').textContent = isRecycling() ? 'Materials' : 'Products';
    $('#prodCta').textContent   = isRecycling() ? 'Add material' : 'Add product';
    $('#prodSub').textContent   = isRecycling()
      ? 'Commodities you collect and sell, with the unit you weigh and bill them in.'
      : 'Products you import and distribute, with sizes if they have them.';

    var list = products();
    if (!list.length) {
      $('#productBody').innerHTML = emptyState('tag',
        isRecycling() ? 'No materials yet' : 'No products yet',
        isRecycling()
          ? 'Add what you handle — OCC cardboard, copper, aluminium. Each carries its own unit and default rate.'
          : 'Add what you distribute. If a product comes in sizes, list them and inventory will break out by size like your spreadsheet.',
        isRecycling() ? 'Add material' : 'Add product', 'newProduct');
      return;
    }

    $('#productBody').innerHTML =
      '<div class="card"><div class="tablewrap"><table><thead><tr>' +
      '<th>Name</th><th>Category</th><th>Unit</th><th>Captured by</th><th>Sizes</th><th class="num">Default rate</th><th class="coldel"></th>' +
      '</tr></thead><tbody>' +
      list.map(function (p) {
        return '<tr><td><strong>' + esc(p.name) + '</strong></td>' +
          '<td style="color:var(--muted)">' + esc(p.category || '—') + '</td>' +
          '<td>' + esc(p.unit) + '</td>' +
          '<td><span class="pill flat">' + (p.capture === 'weighed' ? 'Scale' : 'Count') + '</span></td>' +
          '<td style="color:var(--ink-2)">' + esc((p.sizes || []).join(' · ') || '—') + '</td>' +
          '<td class="num">' + (p.rateCents ? money(p.rateCents) : '—') + '</td>' +
          '<td><button type="button" class="iconbtn" data-delprod="' + esc(p.id) + '" aria-label="Remove ' + esc(p.name) + '"><svg><use href="#i-trash"></use></svg></button></td></tr>';
      }).join('') + '</tbody></table></div></div>';

    $$('[data-delprod]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.dataset.delprod;
        if (db.tickets.some(function (t) { return t.productId === id; })) {
          toast('That has tickets against it and cannot be removed.'); return;
        }
        db.products = db.products.filter(function (p) { return p.id !== id; });
        S.save(); render(); toast('Removed.');
      });
    });
  }

  function productModal() {
    var rec = isRecycling();
    openModal(rec ? 'Add material' : 'Add product',
      field('name', 'Name', { required: true, placeholder: rec ? 'OCC Cardboard' : 'Synguard 100' }) +
      field('category', 'Category', { placeholder: rec ? 'Paper' : 'Gloves' }) +
      field('unit', 'Unit', { value: rec ? 'kg' : 'cases', help: 'What you count or weigh it in — kg, tonne, cases, each.' }) +
      field('capture', 'Captured by', {
        type: 'select', value: rec ? 'weighed' : 'counted',
        options: [{ value: 'weighed', label: 'Scale — gross and tare' }, { value: 'counted', label: 'Count — a quantity' }]
      }) +
      field('sizes', 'Sizes', { placeholder: 'XL, L, M, S', help: 'Leave empty if it has no sizes. Inventory breaks out by size when it does.' }) +
      field('rate', 'Default rate', { placeholder: '140.00', help: 'Per unit. Used to prefill invoice lines; you can always override it.' }),
      function (d) {
        if (!d.name) return;
        db.products.push({
          id: S.uid('prd'), entity: entity, name: d.name, category: d.category,
          unit: d.unit || (rec ? 'kg' : 'cases'), capture: d.capture,
          sizes: d.sizes ? d.sizes.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [],
          rateCents: parseMoney(d.rate)
        });
        S.save(); closeModal(); render(); toast('Added.');
      });
  }

  // ------------------------------------------------------------- settings
  function renderSettings() {
    var co = db.company;
    $('#settingsBody').innerHTML =
      '<div class="card"><div class="cardhead"><h3>Company</h3><span class="sub">Appears on every invoice</span></div>' +
      '<div class="pad"><div class="grid g2" id="coFields">' +
        field('name', 'Legal name', { value: co.name }) +
        field('line1', 'Address line 1', { value: co.line1 }) +
        field('line2', 'Address line 2', { value: co.line2 }) +
        field('email', 'Email', { value: co.email }) +
        field('phone', 'Phone', { value: co.phone }) +
        field('bn', 'Business number', { value: co.bn }) +
        field('gst', 'GST/HST registration', { value: co.gst }) +
      '</div><button type="button" class="btn" id="saveCo" style="margin-top:16px">Save company details</button></div></div>' +

      '<div class="card"><div class="cardhead"><h3>Warehouses</h3>' +
        '<button type="button" class="btn ghost sm" id="addWh"><svg><use href="#i-plus"></use></svg>Add warehouse</button></div>' +
      '<div class="tablewrap"><table><thead><tr><th>Name</th><th>Province</th><th>Sales tax</th><th class="coldel"></th></tr></thead><tbody>' +
      db.warehouses.map(function (w) {
        return '<tr><td><strong>' + esc(w.name) + '</strong></td><td>' + esc(w.province) + '</td>' +
          '<td style="color:var(--ink-2)">' + esc(taxFor(w.province).label) + '</td>' +
          '<td><button type="button" class="iconbtn" data-delwh="' + esc(w.id) + '" aria-label="Remove ' + esc(w.name) + '"><svg><use href="#i-trash"></use></svg></button></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="pad" style="padding-top:0"><div class="note" style="margin-top:14px"><svg><use href="#i-alert"></use></svg><div>' +
      '<b>BC PST is not applied.</b> Only GST and HST are. Whether PST applies to recyclable material sold for ' +
      'reprocessing is a question for your accountant — this app would rather ask than quietly guess.</div></div></div></div>' +

      '<div class="card"><div class="cardhead"><h3>Your data</h3>' +
        '<span class="sub">Stored in this browser only</span></div>' +
      '<div class="pad"><p style="margin:0 0 14px;color:var(--ink-2);font-size:14px;max-width:64ch">' +
        'There is no server. Everything you enter lives in this browser on this machine — private, works offline, ' +
        'and <b>gone if you clear site data or switch computer</b>. Export regularly until this moves onto your own server.</p>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<button type="button" class="btn ghost" id="exportData">Export backup (.json)</button>' +
        '<button type="button" class="btn ghost" id="importData">Import backup</button>' +
        '<button type="button" class="btn danger" id="wipeData">Erase everything</button>' +
        '</div><input type="file" id="importFile" accept="application/json" hidden></div></div>';

    $('#saveCo').addEventListener('click', function () {
      $$('#coFields [name]').forEach(function (el) { db.company[el.name] = el.value.trim(); });
      S.save(); render(); toast('Company details saved.');
    });

    $('#addWh').addEventListener('click', function () {
      openModal('Add warehouse',
        field('name', 'Name', { required: true, placeholder: 'Mississauga, ON' }) +
        field('province', 'Province', {
          type: 'select', value: 'ON',
          options: PROVINCES.map(function (p) { return { value: p, label: p + ' — ' + TAX[p].label }; })
        }),
        function (d) {
          if (!d.name) return;
          db.warehouses.push({ id: S.uid('wh'), name: d.name, province: d.province });
          S.save(); closeModal(); render(); toast('Warehouse added.');
        });
    });

    $$('[data-delwh]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (db.warehouses.length === 1) { toast('You need at least one warehouse.'); return; }
        var id = b.dataset.delwh;
        if (db.tickets.some(function (t) { return t.warehouseId === id; })) {
          toast('That warehouse has tickets and cannot be removed.'); return;
        }
        db.warehouses = db.warehouses.filter(function (w) { return w.id !== id; });
        if (warehouseId === id) warehouseId = db.warehouses[0].id;
        S.save(); syncChrome(); render(); toast('Warehouse removed.');
      });
    });

    $('#exportData').addEventListener('click', function () {
      var blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'greenwave-backup-' + today() + '.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      toast('Backup downloaded.');
    });

    $('#importData').addEventListener('click', function () { $('#importFile').click(); });
    $('#importFile').addEventListener('change', function (e) {
      var f = e.target.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          var next = JSON.parse(r.result);
          if (!next || !next.company || !Array.isArray(next.warehouses)) throw new Error('bad file');
          db = S.replace(next);
          warehouseId = db.warehouses[0].id;
          syncChrome(); render(); toast('Backup restored.');
        } catch (err) { toast("That file isn't a Greenwave backup."); }
      };
      r.readAsText(f);
      e.target.value = '';
    });

    $('#wipeData').addEventListener('click', function () {
      if (!confirm('Erase every customer, material, ticket and invoice in this browser?\n\nThis cannot be undone. Export a backup first if you are unsure.')) return;
      db = S.reset();
      warehouseId = db.warehouses[0].id;
      draft = null;
      syncChrome(); render(); toast('Everything erased.');
    });
  }

  // ------------------------------------------------------------- render
  function render() {
    if (view === 'inventory') renderInventory();
    else if (view === 'intake') renderIntake();
    else if (view === 'invoices') renderInvoiceList();
    else if (view === 'editor') renderEditor();
    else if (view === 'customers') renderCustomers();
    else if (view === 'products') renderProducts();
    else if (view === 'settings') renderSettings();
  }

  // ------------------------------------------------------------- wiring
  $$('.entsw button').forEach(function (b) {
    b.addEventListener('click', function () {
      entity = b.dataset.entity;
      db.lastEntity = entity;
      S.save();
      draft = null;
      syncChrome();
      show(view === 'invoices' || view === 'editor' ? (isRecycling() ? 'invoices' : 'inventory') : view);
    });
  });

  $$('.navitem').forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.dataset.view === 'invoices') draft = null;
      show(b.dataset.view);
    });
  });

  $('#wh').addEventListener('change', function (e) {
    warehouseId = e.target.value;
    syncChrome();
    render();
  });

  $('#newInvoice').addEventListener('click', function () { draft = newDraft(); show('editor'); });
  $('#newCustomer').addEventListener('click', customerModal);
  $('#newProduct').addEventListener('click', productModal);
  $('#edSave').addEventListener('click', saveInvoice);
  $('#edPrint').addEventListener('click', function () { window.print(); });

  // Delegated actions from empty states and inline links
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action], [data-goto], [data-invoice]');
    if (!el) return;
    if (el.dataset.goto) { e.preventDefault(); show(el.dataset.goto); return; }
    if (el.dataset.invoice) {
      draft = db.invoices.filter(function (i) { return i.id === el.dataset.invoice; })[0] || null;
      if (draft) show('editor');
      return;
    }
    e.preventDefault();
    var a = el.dataset.action;
    if (a === 'newInvoice')      { draft = newDraft(); show('editor'); }
    else if (a === 'newCustomer'){ customerModal(); }
    else if (a === 'newProduct') { productModal(); }
    else if (a === 'goProducts') { show('products'); }
    else if (a === 'goCustomers'){ show('customers'); }
  });

  // ------------------------------------------------------------- boot
  syncChrome();
  show(isRecycling() ? 'invoices' : 'inventory');
})();
