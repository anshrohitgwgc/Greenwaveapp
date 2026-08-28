/* ==========================================================================
   Greenwave Ops
   ========================================================================== */
(function () {
  'use strict';

  var S = window.Store;

  /* Sales tax follows the province goods ship FROM, so it belongs to the
     warehouse. Every invoice keeps its own copy of the label and rate, so a
     rate change tomorrow never rewrites an invoice raised today — and you
     can type over either one when a job needs it. */
  var TAX = {
    AB: { label: 'GST @ 5%',  rate: 0.05 }, BC: { label: 'GST @ 5%',  rate: 0.05 },
    SK: { label: 'GST @ 5%',  rate: 0.05 }, MB: { label: 'GST @ 5%',  rate: 0.05 },
    QC: { label: 'GST @ 5%',  rate: 0.05 }, ON: { label: 'HST @ 13%', rate: 0.13 },
    NS: { label: 'HST @ 15%', rate: 0.15 }, NB: { label: 'HST @ 15%', rate: 0.15 },
    NL: { label: 'HST @ 15%', rate: 0.15 }, PE: { label: 'HST @ 15%', rate: 0.15 }
  };
  var PROVINCES = Object.keys(TAX);

  var ROLES = {
    admin:   { label: 'Administrator', sees: ['inventory','intake','photos','timeclock','invoices','editor','customers','products','staff','history','settings'] },
    manager: { label: 'Manager',       sees: ['inventory','intake','photos','timeclock','invoices','editor','customers','products','history'] },
    staff:   { label: 'Staff',         sees: ['inventory','intake','photos','timeclock'] }
  };

  // ------------------------------------------------------------- helpers
  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function money(c) {
    var n = c < 0, v = Math.abs(c) / 100;
    return (n ? '-$' : '$') + v.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function parseMoney(s) { var n = parseFloat(String(s).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? Math.round(n * 100) : 0; }
  function parseQty(s)   { var n = parseFloat(String(s).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; }
  function num(n, dp) {
    return Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: dp || 0, maximumFractionDigits: dp === undefined ? 3 : dp });
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  function addDays(iso, d) { var x = new Date(iso + 'T00:00:00'); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); }
  function initials(name) {
    var p = String(name || '?').trim().split(/\s+/);
    return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  }
  function when(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString('en-CA') + ' ' + d.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' });
  }
  function hm(ms) {
    var m = Math.max(0, Math.floor(ms / 60000)), h = Math.floor(m / 60);
    return h + 'h ' + String(m % 60).padStart(2, '0') + 'm';
  }
  function bytes(n) {
    if (n > 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n > 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  }

  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  function emptyState(icon, title, body, cta, action) {
    return '<div class="card"><div class="empty">' +
      '<span class="eico"><svg><use href="#i-' + icon + '"></use></svg></span>' +
      '<h3>' + esc(title) + '</h3><p>' + body + '</p>' +
      (cta ? '<button type="button" class="btn" data-action="' + action + '"><svg><use href="#i-plus"></use></svg>' + esc(cta) + '</button>' : '') +
      '</div></div>';
  }

  function field(name, label, o) {
    o = o || {};
    var v = o.value == null ? '' : o.value, input;
    if (o.type === 'select') {
      input = '<select name="' + name + '"' + (o.required ? ' required' : '') + '>' + o.options.map(function (x) {
        return '<option value="' + esc(x.value) + '"' + (String(x.value) === String(v) ? ' selected' : '') + '>' + esc(x.label) + '</option>';
      }).join('') + '</select>';
    } else if (o.type === 'textarea') {
      input = '<textarea name="' + name + '"' + (o.rows ? ' rows="' + o.rows + '"' : '') + '>' + esc(v) + '</textarea>';
    } else {
      input = '<input type="' + (o.type || 'text') + '" name="' + name + '" value="' + esc(v) + '"' +
        (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') +
        (o.step ? ' step="' + o.step + '"' : '') + (o.required ? ' required' : '') +
        (o.autocomplete ? ' autocomplete="' + o.autocomplete + '"' : '') + '>';
    }
    return '<div class="field"><label for="' + name + '">' + esc(label) + '</label>' + input +
      (o.help ? '<span class="help">' + o.help + '</span>' : '') + '</div>';
  }

  // ------------------------------------------------------------- state
  var db = S.get();
  var entity = db.lastEntity || 'recycling';
  var warehouseId = (db.warehouses[0] || {}).id;
  var view = 'inventory';
  var draft = null;
  var me = null;
  var photoCache = [];
  var objectUrls = [];
  var clockTimer = null;

  function warehouse() { return db.warehouses.filter(function (w) { return w.id === warehouseId; })[0] || db.warehouses[0]; }
  function taxFor(p) { return TAX[p] || TAX.BC; }
  function products() { return db.products.filter(function (p) { return p.entity === entity; }); }
  function isRecycling() { return entity === 'recycling'; }
  function can(v) { return me && ROLES[me.role] && ROLES[me.role].sees.indexOf(v) >= 0; }

  function releaseUrls() {
    objectUrls.forEach(function (u) { URL.revokeObjectURL(u); });
    objectUrls = [];
  }

  // ============================================================ SIGN IN
  function showGate() {
    $('#app').hidden = true;
    $('#gate').hidden = false;
    var body = $('#gateBody');

    if (!db.staff.length) {
      // First run: somebody has to be able to get in.
      body.innerHTML =
        '<h1>Set up the first administrator</h1>' +
        '<p class="lead">Nobody can use this until one account exists. Add yourself, then add the rest of the team from Staff.</p>' +
        '<form id="bootForm">' +
          field('name', 'Your name', { required: true, placeholder: 'Ansh Bapu' }) +
          field('email', 'Your work email', { type: 'email', required: true, placeholder: 'you@greenwaverecycling.ca', autocomplete: 'email' }) +
          '<button type="submit" class="btn">Create administrator</button>' +
        '</form>' +
        '<div class="gatefoot">This is the only account created automatically. Every other person has to be added by an administrator before they can sign in.</div>';

      $('#bootForm').addEventListener('submit', function (e) {
        e.preventDefault();
        var name = $('[name="name"]', body).value.trim();
        var email = $('[name="email"]', body).value.trim().toLowerCase();
        if (!name || !email) return;
        var u = { id: S.uid('stf'), email: email, name: name, role: 'admin', active: true, createdAt: new Date().toISOString() };
        db.staff.push(u);
        db.session = u.id;
        S.save();
        S.log('signin', 'First administrator created');
        boot();
      });
      return;
    }

    body.innerHTML =
      '<h1>Sign in</h1>' +
      '<p class="lead">Enter the work email an administrator registered for you.</p>' +
      '<form id="signForm">' +
        field('email', 'Work email', { type: 'email', required: true, placeholder: 'you@greenwaverecycling.ca', autocomplete: 'email' }) +
        '<button type="submit" class="btn">Sign in</button>' +
      '</form>' +
      '<div id="gateMsg"></div>' +
      '<div class="gatefoot">Only addresses in the staff list can sign in. If yours is refused, ask an administrator to add it.</div>';

    $('#signForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var email = $('[name="email"]', body).value.trim().toLowerCase();
      var u = db.staff.filter(function (x) { return x.email.toLowerCase() === email; })[0];
      var msg = $('#gateMsg');

      if (!u) {
        msg.innerHTML = '<div class="gateerr"><svg><use href="#i-alert"></use></svg><div>' +
          '<b>That email isn\'t registered.</b><br>Ask an administrator to add it to the staff list.</div></div>';
        return;
      }
      if (!u.active) {
        msg.innerHTML = '<div class="gateerr"><svg><use href="#i-alert"></use></svg><div>' +
          '<b>That account is deactivated.</b><br>An administrator can turn it back on.</div></div>';
        return;
      }
      db.session = u.id;
      S.save();
      S.log('signin', u.name + ' signed in');
      boot();
    });
  }

  function signOut() {
    var open = openShift();
    if (open && !confirm('You are still clocked in. Sign out anyway?\n\nYour shift stays open and keeps counting.')) return;
    S.log('signout', me ? me.name + ' signed out' : '');
    db.session = null;
    S.save();
    me = null;
    releaseUrls();
    if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
    showGate();
  }

  // ============================================================ CHROME
  function syncChrome() {
    document.documentElement.setAttribute('data-entity', entity);
    $$('.entsw button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.entity === entity)); });
    /* An element can be gated by company AND by role. Evaluate both together —
       running them as two passes let the second silently overwrite the first,
       which showed Invoices to staff who should never see them. */
    $$('[data-only], [data-role]').forEach(function (el) {
      var okEntity = !el.dataset.only || el.dataset.only === entity;
      var okRole = !el.dataset.role || (me && el.dataset.role.split(',').indexOf(me.role) >= 0);
      el.hidden = !(okEntity && okRole);
    });

    $('#intakeNav').textContent   = isRecycling() ? 'Weigh-in' : 'Receive';
    $('#productsNav').textContent = isRecycling() ? 'Materials' : 'Products';

    $('#meInitials').textContent = me ? initials(me.name) : '';
    $('#meName').textContent = me ? me.name : '';
    $('#meRole').textContent = me ? (ROLES[me.role] || {}).label || me.role : '';

    var sel = $('#wh');
    sel.innerHTML = db.warehouses.map(function (w) {
      return '<option value="' + esc(w.id) + '">' + esc(w.name) + '</option>';
    }).join('');
    sel.value = warehouseId;

    var w = warehouse();
    $('#taxNote').textContent = w ? w.province + ' · ' + taxFor(w.province).label : '';

    renderTabbar();
    renderShiftChip();
  }

  function renderTabbar() {
    var items = [
      { v: 'inventory', i: 'box',   l: 'Stock' },
      { v: 'intake',    i: 'scale', l: isRecycling() ? 'Weigh' : 'Receive' },
      { v: 'invoices',  i: 'doc',   l: 'Invoices' },
      { v: 'photos',    i: 'cam',   l: 'Photos' },
      { v: 'timeclock', i: 'clock', l: 'Clock' }
    ].filter(function (x) {
      if (x.v === 'invoices') return can('invoices') && isRecycling();
      return can(x.v);
    });

    $('#tabbar').innerHTML = items.map(function (x) {
      var on = (view === x.v || (view === 'editor' && x.v === 'invoices'));
      return '<button type="button" data-view="' + x.v + '"' + (on ? ' aria-current="true"' : '') + '>' +
        '<svg><use href="#i-' + x.i + '"></use></svg>' + esc(x.l) + '</button>';
    }).join('');

    $$('#tabbar button').forEach(function (b) {
      b.addEventListener('click', function () { show(b.dataset.view); });
    });
  }

  function renderShiftChip() {
    var open = openShift();
    var chip = $('#shiftChip');
    chip.hidden = !open;
    if (open) {
      chip.innerHTML = '<span class="dot"></span>On shift · ' + hm(Date.now() - new Date(open.startAt).getTime());
    }
  }

  function show(next) {
    if (next === 'invoices' && !isRecycling()) next = 'inventory';
    if (!can(next) && next !== 'editor') next = 'inventory';
    if (next === 'editor' && !can('invoices')) next = 'inventory';

    releaseUrls();
    view = next;
    $$('.view').forEach(function (v) { v.classList.remove('on'); });
    var el = $('#v-' + view);
    if (el) el.classList.add('on');

    $$('.navitem').forEach(function (b) {
      var on = b.dataset.view === view || (view === 'editor' && b.dataset.view === 'invoices');
      if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
    $('#app').classList.remove('menu-open');
    $('#scroll').scrollTop = 0;
    renderTabbar();
    render();
  }

  // ============================================================ INVENTORY
  function balances() {
    var map = {};
    products().forEach(function (p) {
      map[p.id] = { product: p, bySize: {}, total: 0 };
      (p.sizes || []).forEach(function (z) { map[p.id].bySize[z] = 0; });
    });
    db.tickets.forEach(function (t) {
      if (t.entity !== entity || t.warehouseId !== warehouseId) return;
      var row = map[t.productId]; if (!row) return;
      var sign = t.direction === 'out' ? -1 : 1;
      if (t.qtyBySize) {
        Object.keys(t.qtyBySize).forEach(function (z) {
          var q = Number(t.qtyBySize[z]) || 0;
          if (row.bySize[z] === undefined) row.bySize[z] = 0;
          row.bySize[z] += sign * q; row.total += sign * q;
        });
      } else { row.total += sign * (Number(t.qty) || 0); }
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  function renderInventory() {
    var w = warehouse();
    $('#invenSub').textContent = w ? 'On hand at ' + w.name + ', derived from posted tickets.' : '';
    $('#invenCta').textContent = isRecycling() ? 'Record a load' : 'Receive stock';

    var list = products();
    if (!list.length) {
      $('#invenBody').innerHTML = emptyState('tag', isRecycling() ? 'No materials yet' : 'No products yet',
        'Inventory is what you received less what you shipped. Add what you handle first.',
        can('products') ? (isRecycling() ? 'Add material' : 'Add product') : null, 'goProducts');
      return;
    }

    var rows = balances(), sizes = [];
    rows.forEach(function (r) { (r.product.sizes || []).forEach(function (z) { if (sizes.indexOf(z) < 0) sizes.push(z); }); });

    var head = '<tr><th>' + (isRecycling() ? 'Material' : 'Product') + '</th><th>Category</th>' +
      sizes.map(function (z) { return '<th class="num">' + esc(z) + '</th>'; }).join('') +
      '<th class="num">On hand</th><th>Unit</th></tr>';

    var body = rows.map(function (r) {
      var cells = sizes.map(function (z) {
        return (r.product.sizes || []).indexOf(z) < 0
          ? '<td class="num" style="color:var(--muted)">–</td>'
          : '<td class="num">' + num(r.bySize[z] || 0) + '</td>';
      }).join('');
      return '<tr><td><strong>' + esc(r.product.name) + '</strong></td><td style="color:var(--muted)">' +
        esc(r.product.category || '—') + '</td>' + cells +
        '<td class="num"><strong>' + num(r.total) + '</strong></td><td style="color:var(--muted)">' + esc(r.product.unit) + '</td></tr>';
    }).join('');

    var colTotals = sizes.map(function (z) { return rows.reduce(function (a, r) { return a + (r.bySize[z] || 0); }, 0); });
    var grand = rows.reduce(function (a, r) { return a + r.total; }, 0);

    $('#invenBody').innerHTML =
      '<div class="card"><div class="cardhead"><h3>On hand — ' + esc(w ? w.name : '') + '</h3>' +
      '<span class="sub">' + db.tickets.filter(function (t) { return t.entity === entity && t.warehouseId === warehouseId; }).length +
      ' tickets here</span></div><div class="tablewrap"><table><thead>' + head + '</thead><tbody>' + body + '</tbody>' +
      '<tfoot><tr><td>Total</td><td></td>' + colTotals.map(function (c) { return '<td class="num">' + num(c) + '</td>'; }).join('') +
      '<td class="num">' + num(grand) + '</td><td style="font-weight:400;color:var(--muted)">summed from rows</td></tr></tfoot></table></div></div>';
  }

  // ============================================================ INTAKE
  function renderIntake() {
    var w = warehouse();
    $('#intakeTitle').textContent = isRecycling() ? 'Weigh-in' : 'Receive stock';
    $('#intakeSub').textContent = isRecycling()
      ? 'Gross less tare gives net. It posts to ' + (w ? w.name : 'the warehouse') + '.'
      : 'Count what arrived. It posts to ' + (w ? w.name : 'the warehouse') + '.';

    var list = products();
    if (!list.length) {
      $('#intakeBody').innerHTML = emptyState('tag', 'Nothing to record against',
        'Add what you handle first, then come back.',
        can('products') ? (isRecycling() ? 'Add material' : 'Add product') : null, 'goProducts');
      return;
    }

    $('#intakeBody').innerHTML =
      '<div class="card"><div class="cardhead"><h3>' + (isRecycling() ? 'Inbound ticket' : 'Receipt') + '</h3></div>' +
      '<div class="pad"><div class="grid g2">' +
        '<div class="field"><label>' + (isRecycling() ? 'Material' : 'Product') + '</label><select id="tkProduct">' +
          list.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + ' (' + esc(p.unit) + ')</option>'; }).join('') +
        '</select></div>' +
        '<div class="field"><label>Direction</label><select id="tkDir"><option value="in">In — arriving</option><option value="out">Out — shipping</option></select></div>' +
        '<div class="field"><label>Date</label><input type="date" id="tkDate" value="' + today() + '"></div>' +
        '<div class="field"><label>Reference</label><input type="text" id="tkRef" class="mono" placeholder="Container, truck or BOL"></div>' +
      '</div><div id="tkQty" style="margin-top:16px"></div>' +
      '<button type="button" class="btn" id="tkPost" style="margin-top:18px"><svg><use href="#i-check"></use></svg>Post ticket</button>' +
      '<p style="margin:12px 0 0;color:var(--muted);font-size:13px">Posting is final. A mistake is corrected with an opposite ticket, so both stay on the record.</p>' +
      '</div></div><div id="tkRecent"></div>';

    $('#tkProduct').addEventListener('change', renderQtyFields);
    $('#tkPost').addEventListener('click', postTicket);
    renderQtyFields();
    renderRecent();
  }

  function currentProduct() {
    var el = $('#tkProduct'); if (!el) return null;
    return products().filter(function (p) { return p.id === el.value; })[0];
  }

  function renderQtyFields() {
    var p = currentProduct(); if (!p) return;
    var host = $('#tkQty');
    if (p.sizes && p.sizes.length) {
      host.innerHTML = '<div class="grid g3">' + p.sizes.map(function (z) {
        return '<div class="field"><label>' + esc(z) + '</label><input type="number" step="any" min="0" data-size="' + esc(z) + '" placeholder="0"></div>';
      }).join('') + '</div><div class="trow" style="margin-top:14px"><span class="lb">Total this ticket</span><span class="vl" id="tkTotal">0 ' + esc(p.unit) + '</span></div>';
      $$('#tkQty input').forEach(function (i) {
        i.addEventListener('input', function () {
          var t = 0; $$('#tkQty input[data-size]').forEach(function (x) { t += parseQty(x.value); });
          $('#tkTotal').textContent = num(t) + ' ' + p.unit;
        });
      });
    } else if (p.capture === 'weighed') {
      host.innerHTML = '<div class="grid g3">' +
        '<div class="field"><label>Gross (' + esc(p.unit) + ')</label><input type="number" step="any" min="0" id="tkGross" placeholder="0"></div>' +
        '<div class="field"><label>Tare (' + esc(p.unit) + ')</label><input type="number" step="any" min="0" id="tkTare" placeholder="0"></div>' +
        '<div class="field"><label>Net</label><input type="text" id="tkNet" value="0" readonly style="background:var(--panel-2);font-weight:700"></div>' +
        '</div><div id="tkWarn"></div>';
      ['tkGross', 'tkTare'].forEach(function (id) {
        $('#' + id).addEventListener('input', function () {
          var g = parseQty($('#tkGross').value), t = parseQty($('#tkTare').value), net = g - t;
          $('#tkNet').value = num(net);
          $('#tkWarn').innerHTML = (g > 0 && net <= 0)
            ? '<div class="note" style="border-left-color:var(--crit)"><svg style="color:var(--crit)"><use href="#i-alert"></use></svg><div>Tare is higher than gross — check both weights before posting.</div></div>' : '';
        });
      });
    } else {
      host.innerHTML = '<div class="grid g3"><div class="field"><label>Quantity (' + esc(p.unit) + ')</label>' +
        '<input type="number" step="any" min="0" id="tkQtyOne" placeholder="0"></div></div>';
    }
  }

  function postTicket() {
    var p = currentProduct(); if (!p) return;
    var t = {
      id: S.uid('tk'), entity: entity, warehouseId: warehouseId, productId: p.id,
      direction: $('#tkDir').value, date: $('#tkDate').value || today(),
      ref: $('#tkRef').value.trim(), staffId: me.id, staffName: me.name,
      postedAt: new Date().toISOString()
    };

    if (p.sizes && p.sizes.length) {
      var by = {}, total = 0;
      $$('#tkQty input[data-size]').forEach(function (i) {
        var q = parseQty(i.value); if (q) { by[i.dataset.size] = q; total += q; }
      });
      if (!total) { toast('Enter a quantity for at least one size.'); return; }
      t.qtyBySize = by; t.qty = total;
    } else if (p.capture === 'weighed') {
      var g = parseQty($('#tkGross').value), ta = parseQty($('#tkTare').value), net = g - ta;
      if (net <= 0) { toast('Net must be more than zero.'); return; }
      t.gross = g; t.tare = ta; t.qty = net;
    } else {
      var q = parseQty($('#tkQtyOne').value);
      if (q <= 0) { toast('Enter a quantity.'); return; }
      t.qty = q;
    }

    db.tickets.push(t); S.save();
    S.log('ticket', (t.direction === 'out' ? 'Shipped ' : 'Received ') + num(t.qty) + ' ' + p.unit + ' ' + p.name + (t.ref ? ' · ' + t.ref : ''));
    toast('Ticket posted.');
    renderIntake();
  }

  function renderRecent() {
    var mine = db.tickets.filter(function (t) { return t.entity === entity && t.warehouseId === warehouseId; }).slice(-8).reverse();
    if (!mine.length) { $('#tkRecent').innerHTML = ''; return; }
    var byId = {}; db.products.forEach(function (p) { byId[p.id] = p; });

    $('#tkRecent').innerHTML = '<div class="card"><div class="cardhead"><h3>Recent tickets here</h3></div>' +
      '<div class="tablewrap"><table><thead><tr><th>Date</th><th>Item</th><th>Reference</th><th>By</th><th></th><th class="num">Qty</th></tr></thead><tbody>' +
      mine.map(function (t) {
        var p = byId[t.productId] || { name: '—', unit: '' };
        var q = t.qtyBySize ? Object.keys(t.qtyBySize).map(function (z) { return z + ' ' + num(t.qtyBySize[z]); }).join(' · ') : num(t.qty) + ' ' + p.unit;
        return '<tr><td class="mono" style="font-size:13px">' + esc(t.date) + '</td><td>' + esc(p.name) + '</td>' +
          '<td class="mono" style="font-size:12.5px;color:var(--muted)">' + esc(t.ref || '—') + '</td>' +
          '<td style="color:var(--ink-2)">' + esc(t.staffName || '—') + '</td>' +
          '<td><span class="pill ' + (t.direction === 'out' ? 'warn' : 'good') + '">' + (t.direction === 'out' ? 'Out' : 'In') + '</span></td>' +
          '<td class="num">' + esc(q) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  // ============================================================ PHOTOS
  function renderPhotos() {
    var isAdmin = me.role === 'admin' || me.role === 'manager';
    $('#photoSub').textContent = isAdmin
      ? 'Every photo anyone has taken, newest first.'
      : 'Photos you have taken. Administrators can see all of them.';

    Photos.all().then(function (all) {
      photoCache = isAdmin ? all : all.filter(function (p) { return p.staffId === me.id; });
      var used = photoCache.reduce(function (a, p) { return a + (p.size || 0); }, 0);

      if (!photoCache.length) {
        $('#photoBody').innerHTML = emptyState('cam', 'No photos yet',
          'Take a picture of a load, a contaminated bin, a seal or a damaged pallet. On a phone this opens the camera directly.',
          'Add photo', 'addPhoto');
        return;
      }

      releaseUrls();
      $('#photoBody').innerHTML = '<div class="card">' +
        '<div class="photobar"><span><b style="color:var(--ink)">' + photoCache.length + '</b> photos · ' + bytes(used) + '</span>' +
        '<span class="grow"></span><span id="quota"></span></div>' +
        '<div class="photogrid">' + photoCache.map(function (p, i) {
          var url = URL.createObjectURL(p.blob); objectUrls.push(url);
          return '<button type="button" class="photo" data-photo="' + i + '">' +
            '<img src="' + url + '" alt="' + esc(p.note || p.name) + '" loading="lazy">' +
            '<span class="cap"><b>' + esc(p.staffName || 'Unknown') + '</b>' + esc(when(p.at)) + '</span></button>';
        }).join('') + '</div></div>';

      Photos.usage().then(function (u) {
        if (u && u.quota) {
          $('#quota').textContent = bytes(u.used) + ' of about ' + bytes(u.quota) + ' used on this device';
        }
      });

      $$('[data-photo]').forEach(function (b) {
        b.addEventListener('click', function () { openLightbox(Number(b.dataset.photo)); });
      });
    });
  }

  function openLightbox(i) {
    var p = photoCache[i]; if (!p) return;
    var url = URL.createObjectURL(p.blob); objectUrls.push(url);
    $('#lbImg').src = url;
    $('#lbMeta').innerHTML = esc(p.staffName || 'Unknown') + ' · ' + esc(when(p.at)) +
      ' · ' + p.width + '×' + p.height + ' · ' + bytes(p.size) +
      (p.note ? '<br>' + esc(p.note) : '') +
      (me.role === 'admin' ? '<br><button type="button" class="btn danger" id="lbDel" style="margin-top:12px">Delete this photo</button>' : '');
    $('#lightbox').hidden = false;

    var del = $('#lbDel');
    if (del) del.addEventListener('click', function () {
      if (!confirm('Delete this photo permanently?')) return;
      Photos.remove(p.id).then(function () {
        S.log('photo-delete', 'Deleted a photo taken by ' + (p.staffName || 'unknown'));
        $('#lightbox').hidden = true;
        renderPhotos();
        toast('Photo deleted.');
      });
    });
  }

  function addPhotos(files) {
    if (!files || !files.length) return;
    var w = warehouse();
    var jobs = Array.prototype.slice.call(files).map(function (f) {
      return Photos.add(f, {
        staffId: me.id, staffName: me.name, entity: entity,
        warehouseId: warehouseId, note: w ? w.name : ''
      });
    });
    toast(files.length > 1 ? 'Saving ' + files.length + ' photos…' : 'Saving photo…');
    Promise.all(jobs).then(function (recs) {
      S.log('photo', 'Added ' + recs.length + ' photo' + (recs.length === 1 ? '' : 's'));
      toast(recs.length + ' photo' + (recs.length === 1 ? '' : 's') + ' saved.');
      renderPhotos();
    }).catch(function (e) {
      toast(e.message || 'Could not save that photo.');
    });
  }

  // ============================================================ TIME CLOCK
  function openShift() {
    if (!me) return null;
    return db.shifts.filter(function (s) { return s.staffId === me.id && !s.endAt; })[0] || null;
  }

  function renderTimeclock() {
    var open = openShift();
    $('#clockSub').textContent = open ? 'You are on shift.' : 'Clock in when you start, out when you finish.';

    var mine = db.shifts.filter(function (s) { return s.staffId === me.id; })
      .sort(function (a, b) { return b.startAt.localeCompare(a.startAt); });

    var weekAgo = Date.now() - 7 * 864e5;
    var weekMs = mine.reduce(function (a, s) {
      var st = new Date(s.startAt).getTime();
      if (st < weekAgo) return a;
      return a + ((s.endAt ? new Date(s.endAt).getTime() : Date.now()) - st);
    }, 0);

    $('#clockBody').innerHTML =
      '<div class="card"><div class="clockcard">' +
        '<div class="clockstate">' + (open ? 'On shift since ' + new Date(open.startAt).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' }) : 'Clocked out') + '</div>' +
        '<div class="clocktime ' + (open ? 'on' : 'off') + '" id="clockTime">' +
          (open ? hm(Date.now() - new Date(open.startAt).getTime()) : '—') + '</div>' +
        '<div class="clocksince">' + hm(weekMs) + ' in the last 7 days</div>' +
        '<button type="button" class="btn' + (open ? ' ghost' : '') + '" id="clockBtn">' +
          '<svg><use href="#i-' + (open ? 'stop' : 'play') + '"></use></svg>' + (open ? 'Clock out' : 'Clock in') + '</button>' +
      '</div></div>' +

      (mine.length ? '<div class="card"><div class="cardhead"><h3>Your shifts</h3><span class="sub">' + mine.length + ' recorded</span></div>' +
        '<div class="tablewrap"><table><thead><tr><th>Started</th><th>Ended</th><th class="num">Length</th></tr></thead><tbody>' +
        mine.slice(0, 30).map(function (s) {
          return '<tr><td class="mono" style="font-size:13px">' + esc(when(s.startAt)) + '</td>' +
            '<td class="mono" style="font-size:13px">' + (s.endAt ? esc(when(s.endAt)) : '<span class="pill good">open</span>') + '</td>' +
            '<td class="num">' + (s.endAt ? hm(new Date(s.endAt) - new Date(s.startAt)) : hm(Date.now() - new Date(s.startAt))) + '</td></tr>';
        }).join('') + '</tbody></table></div></div>' : '') +

      ((me.role === 'admin' || me.role === 'manager') ? renderTeamClock() : '');

    $('#clockBtn').addEventListener('click', toggleClock);

    if (clockTimer) clearInterval(clockTimer);
    if (open) {
      clockTimer = setInterval(function () {
        var el = $('#clockTime');
        if (!el) { clearInterval(clockTimer); clockTimer = null; return; }
        el.textContent = hm(Date.now() - new Date(open.startAt).getTime());
        renderShiftChip();
      }, 30000);
    }
  }

  function renderTeamClock() {
    var weekAgo = Date.now() - 7 * 864e5;
    var rows = db.staff.map(function (u) {
      var shifts = db.shifts.filter(function (s) { return s.staffId === u.id; });
      var ms = shifts.reduce(function (a, s) {
        var st = new Date(s.startAt).getTime();
        if (st < weekAgo) return a;
        return a + ((s.endAt ? new Date(s.endAt).getTime() : Date.now()) - st);
      }, 0);
      var on = shifts.some(function (s) { return !s.endAt; });
      return { u: u, ms: ms, on: on, n: shifts.length };
    }).filter(function (r) { return r.n > 0; }).sort(function (a, b) { return b.ms - a.ms; });

    if (!rows.length) return '';
    return '<div class="card"><div class="cardhead"><h3>The team, last 7 days</h3>' +
      '<span class="sub">' + rows.filter(function (r) { return r.on; }).length + ' on shift now</span></div>' +
      '<div class="tablewrap"><table><thead><tr><th>Name</th><th>Role</th><th></th><th class="num">Hours</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td><strong>' + esc(r.u.name) + '</strong></td>' +
          '<td style="color:var(--muted)">' + esc((ROLES[r.u.role] || {}).label || r.u.role) + '</td>' +
          '<td>' + (r.on ? '<span class="pill good">On shift</span>' : '') + '</td>' +
          '<td class="num">' + hm(r.ms) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  function toggleClock() {
    var open = openShift();
    if (open) {
      open.endAt = new Date().toISOString();
      S.save();
      S.log('clock-out', 'Clocked out after ' + hm(new Date(open.endAt) - new Date(open.startAt)));
      toast('Clocked out.');
    } else {
      db.shifts.push({ id: S.uid('sh'), staffId: me.id, startAt: new Date().toISOString(), endAt: null, note: '' });
      S.save();
      S.log('clock-in', 'Clocked in');
      toast('Clocked in.');
    }
    renderTimeclock();
    renderShiftChip();
  }

  // ============================================================ INVOICES
  function newDraft() {
    var w = warehouse(), co = db.company, t = taxFor(w ? w.province : 'BC');
    return {
      id: null, number: null,
      billTo: '', shipTo: '',
      warehouseId: w ? w.id : null, fromName: w ? w.name : '', province: w ? w.province : 'BC',
      shipVia: 'Greenwave Recycling Truck', shipDate: today(),
      date: today(), termsDays: 15,
      taxLabel: t.label, taxRate: t.rate,
      co: { name: co.name, line1: co.line1, line2: co.line2, email: co.email, phone: co.phone, bn: co.bn, gst: co.gst },
      lines: [blankLine()]
    };
  }
  function blankLine() {
    return { date: today(), service: 'supply', unit: '', description: '', qty: 0, rateCents: 0, rebate: false };
  }
  function lineAmount(l) {
    // Round each line, then sum the rounded lines. Summing raw products and
    // rounding once at the end leaves an invoice a cent off its own lines.
    var a = Math.round((Number(l.qty) || 0) * (Number(l.rateCents) || 0));
    return l.rebate ? -a : a;
  }
  function totals(inv) {
    var sub = inv.lines.reduce(function (a, l) { return a + lineAmount(l); }, 0);
    var tax = Math.round(sub * (Number(inv.taxRate) || 0));
    return { subtotal: sub, tax: tax, total: sub + tax };
  }

  function renderInvoiceList() {
    if (!db.invoices.length) {
      $('#invoiceList').innerHTML = emptyState('doc', 'No invoices yet',
        'Numbering continues from <b>1114</b>, so your next one is <b>1115</b>. Every field is free text.',
        'New invoice', 'newInvoice');
      return;
    }
    $('#invoiceList').innerHTML = '<div class="card"><div class="tablewrap"><table><thead><tr>' +
      '<th>No.</th><th>Bill to</th><th>Date</th><th>Due</th><th class="num">Total</th><th>Status</th></tr></thead><tbody>' +
      db.invoices.slice().sort(function (a, b) { return String(b.number).localeCompare(String(a.number), undefined, { numeric: true }); })
      .map(function (inv) {
        var t = totals(inv), due = addDays(inv.date, inv.termsDays), late = due < today();
        return '<tr class="click" data-invoice="' + esc(inv.id) + '">' +
          '<td class="mono"><strong>' + esc(inv.number) + '</strong></td>' +
          '<td>' + esc((inv.billTo || '').split('\n')[0] || '—') + '</td>' +
          '<td class="mono" style="font-size:13px">' + esc(inv.date) + '</td>' +
          '<td class="mono" style="font-size:13px">' + esc(due) + '</td>' +
          '<td class="num">' + money(t.total) + '</td>' +
          '<td><span class="pill ' + (late ? 'crit' : 'flat') + '">' + (late ? 'Overdue' : 'Open') + '</span></td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  /* Every field on the sheet is an input. Customers and warehouses only
     prefill it — nothing is locked, because real invoices always need a
     one-off change somewhere. */
  function renderEditor() {
    if (!draft) draft = newDraft();
    var inv = draft, t = totals(inv), due = addDays(inv.date, inv.termsDays);
    $('#edTitle').textContent = inv.number ? ('Invoice ' + inv.number) : 'New invoice';

    var lineRows = inv.lines.map(function (l, i) {
      return '<tr>' +
        '<td class="colno" data-lbl="#">' + (i + 1) + '.</td>' +
        '<td data-lbl="Service date"><input type="date" data-li="' + i + '" data-k="date" value="' + esc(l.date) + '"></td>' +
        '<td data-lbl="Product/service"><input type="text" data-li="' + i + '" data-k="service" value="' + esc(l.service) + '" placeholder="supply"></td>' +
        '<td data-lbl="Unit"><input type="text" data-li="' + i + '" data-k="unit" value="' + esc(l.unit) + '" placeholder="tonne"></td>' +
        '<td class="wide" data-lbl="Description"><input type="text" data-li="' + i + '" data-k="description" value="' + esc(l.description) + '" placeholder="What was supplied"></td>' +
        '<td class="colqty" data-lbl="Qty"><input type="number" step="0.001" data-li="' + i + '" data-k="qty" value="' + (l.qty || '') + '" placeholder="0.000"></td>' +
        '<td class="colrate" data-lbl="Rate"><input type="text" data-li="' + i + '" data-k="rate" value="' + (l.rateCents ? (l.rateCents / 100).toFixed(2) : '') + '" placeholder="0.00"></td>' +
        '<td class="colamt num" data-lbl="Amount">' + money(lineAmount(l)) + '</td>' +
        '<td data-lbl="Direction"><label class="pill ' + (l.rebate ? 'warn' : 'flat') + '" style="cursor:pointer">' +
          '<input type="checkbox" data-li="' + i + '" data-k="rebate"' + (l.rebate ? ' checked' : '') + ' style="width:auto;min-height:0;margin:0">Rebate</label></td>' +
        '<td class="coldel" data-lbl=""><button type="button" class="iconbtn" data-del="' + i + '" aria-label="Remove line ' + (i + 1) + '"><svg><use href="#i-trash"></use></svg></button></td></tr>';
    }).join('');

    var prefill = '<div class="card noprint"><div class="pad"><div class="grid gset">' +
      '<div class="field"><label>Prefill from customer</label><select id="edCust">' +
        '<option value="">— type it below instead —</option>' +
        db.customers.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'; }).join('') +
      '</select><span class="help">Optional. Fills Bill to and Ship to; you can still type over them.</span></div>' +
      '<div class="field"><label>Prefill tax from warehouse</label><select id="edWh">' +
        '<option value="">— keep what I typed —</option>' +
        db.warehouses.map(function (w) { return '<option value="' + esc(w.id) + '"' + (w.id === inv.warehouseId ? ' selected' : '') + '>' + esc(w.name) + ' (' + esc(w.province) + ')</option>'; }).join('') +
      '</select><span class="help">Sets ships-from and the tax line.</span></div>' +
      '<div class="field"><label>Terms (days)</label><input type="number" id="edTerms" value="' + esc(inv.termsDays) + '" min="0"><span class="help">Due ' + esc(due) + '</span></div>' +
    '</div></div></div>';

    $('#editorBody').innerHTML = prefill +
      '<div class="sheet" style="margin-top:16px">' +
        '<div class="shhead">' +
          '<div><div class="shword">INVOICE</div>' +
            '<input type="text" data-co="name" value="' + esc(inv.co.name) + '" style="font-weight:700;margin-bottom:5px" placeholder="Company name">' +
            '<input type="text" data-co="bn" value="' + esc(inv.co.bn) + '" style="margin-bottom:4px" placeholder="Business number">' +
            '<input type="text" data-co="gst" value="' + esc(inv.co.gst) + '" placeholder="GST/HST registration"></div>' +
          '<div><input type="text" data-co="line1" value="' + esc(inv.co.line1) + '" style="margin-bottom:4px" placeholder="Address line 1">' +
            '<input type="text" data-co="line2" value="' + esc(inv.co.line2) + '" style="margin-bottom:4px" placeholder="Address line 2">' +
            '<input type="text" data-co="email" value="' + esc(inv.co.email) + '" style="margin-bottom:4px" placeholder="Email">' +
            '<input type="text" data-co="phone" value="' + esc(inv.co.phone) + '" placeholder="Phone"></div>' +
          '<div class="shlogo"><img src="assets/logo.png" alt="Greenwave Recycling Inc." style="width:150px;height:auto"></div>' +
        '</div>' +

        '<div class="shband">' +
          '<div><span class="shk">Bill to</span><textarea data-f="billTo" rows="4" placeholder="Company name&#10;Street&#10;City, province, postcode">' + esc(inv.billTo) + '</textarea></div>' +
          '<div><span class="shk">Ship to</span><textarea data-f="shipTo" rows="4" placeholder="Same as bill to, or somewhere else">' + esc(inv.shipTo) + '</textarea></div>' +
        '</div>' +

        '<div class="shband split">' +
          '<div><span class="shk">Shipping info</span>' +
            '<div class="grid" style="gap:8px">' +
              '<div class="field"><label>Ship via</label><input type="text" data-f="shipVia" value="' + esc(inv.shipVia) + '"></div>' +
              '<div class="field"><label>Ship date</label><input type="date" data-f="shipDate" value="' + esc(inv.shipDate) + '"></div>' +
              '<div class="field"><label>From</label><input type="text" data-f="fromName" value="' + esc(inv.fromName) + '"></div>' +
            '</div></div>' +
          '<div><span class="shk">Invoice details</span>' +
            '<div class="grid" style="gap:8px">' +
              '<div class="field"><label>Invoice no.</label><input type="text" data-f="number" value="' + esc(inv.number || '') + '" placeholder="assigned on save"></div>' +
              '<div class="field"><label>Invoice date</label><input type="date" data-f="date" value="' + esc(inv.date) + '"></div>' +
              '<div class="field"><label>Due date</label><input type="text" value="' + esc(due) + '" readonly style="background:var(--panel-2)"></div>' +
            '</div></div>' +
        '</div>' +

        '<div class="lines"><div class="tablewrap"><table><thead><tr>' +
          '<th>#</th><th>Service date</th><th>Product/service</th><th>Unit</th><th>Description</th>' +
          '<th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th><th></th><th class="coldel"></th>' +
        '</tr></thead><tbody>' + lineRows + '</tbody></table></div>' +
        '<button type="button" class="btn ghost sm addline noprint" id="edAddLine"><svg><use href="#i-plus"></use></svg>Add line</button></div>' +

        '<div class="shfoot">' +
          '<div><span class="shk">Ways to pay</span><textarea data-f="payNote" rows="3" placeholder="How you want to be paid">' + esc(inv.payNote || (inv.co.email + '\n' + inv.co.phone)) + '</textarea></div>' +
          '<div class="totals">' +
            '<div class="trow"><span class="lb">Subtotal</span><span class="vl" id="tSub">' + money(t.subtotal) + '</span></div>' +
            '<div class="trow" style="gap:8px"><input type="text" data-f="taxLabel" value="' + esc(inv.taxLabel) + '" style="flex:1" placeholder="GST @ 5%">' +
              '<input type="number" step="0.001" data-f="taxRate" value="' + esc(inv.taxRate) + '" style="width:82px" title="Rate as a decimal, e.g. 0.05">' +
              '<span class="vl" id="tTax" style="min-width:86px;text-align:right">' + money(t.tax) + '</span></div>' +
            '<div class="tgrand"><span class="lb" id="tLbl">' + (t.total < 0 ? 'Payable to customer' : 'Total') + '</span>' +
              '<span class="vl' + (t.total < 0 ? ' neg' : '') + '" id="tTot">' + money(Math.abs(t.total)) + '</span></div>' +
          '</div>' +
        '</div>' +
      '</div>';

    wireEditor();
  }

  function wireEditor() {
    $('#edCust').addEventListener('change', function (e) {
      var c = db.customers.filter(function (x) { return x.id === e.target.value; })[0];
      if (!c) return;
      var block = [c.name, c.line1, c.line2].filter(Boolean).join('\n');
      draft.billTo = block;
      if (!draft.shipTo) draft.shipTo = block;
      renderEditor();
    });

    $('#edWh').addEventListener('change', function (e) {
      var w = db.warehouses.filter(function (x) { return x.id === e.target.value; })[0];
      if (!w) return;
      var t = taxFor(w.province);
      draft.warehouseId = w.id; draft.fromName = w.name; draft.province = w.province;
      draft.taxLabel = t.label; draft.taxRate = t.rate;
      renderEditor();
    });

    $('#edTerms').addEventListener('change', function (e) {
      draft.termsDays = parseInt(e.target.value, 10) || 0; renderEditor();
    });
    $('#edAddLine').addEventListener('click', function () { draft.lines.push(blankLine()); renderEditor(); });

    $$('#editorBody [data-co]').forEach(function (el) {
      el.addEventListener('input', function () { draft.co[el.dataset.co] = el.value; });
    });

    $$('#editorBody [data-f]').forEach(function (el) {
      var evt = el.type === 'date' ? 'change' : 'input';
      el.addEventListener(evt, function () {
        var k = el.dataset.f;
        if (k === 'taxRate') { draft.taxRate = parseFloat(el.value) || 0; updateTotals(); }
        else if (k === 'date') { draft.date = el.value; renderEditor(); }
        else draft[k] = el.value;
      });
    });

    $$('#editorBody [data-li]').forEach(function (el) {
      var evt = (el.type === 'checkbox' || el.type === 'date') ? 'change' : 'input';
      el.addEventListener(evt, function () {
        var l = draft.lines[Number(el.dataset.li)], k = el.dataset.k;
        if (k === 'rebate') { l.rebate = el.checked; renderEditor(); return; }
        if (k === 'qty') l.qty = parseQty(el.value);
        else if (k === 'rate') l.rateCents = parseMoney(el.value);
        else l[k] = el.value;
        var row = el.closest('tr');
        if (row) row.querySelector('.colamt').textContent = money(lineAmount(l));
        updateTotals();
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

  function updateTotals() {
    var t = totals(draft);
    $('#tSub').textContent = money(t.subtotal);
    $('#tTax').textContent = money(t.tax);
    $('#tLbl').textContent = t.total < 0 ? 'Payable to customer' : 'Total';
    var v = $('#tTot');
    v.textContent = money(Math.abs(t.total));
    v.classList.toggle('neg', t.total < 0);
  }

  function saveInvoice() {
    if (!draft.billTo.trim()) { toast('Type who this is billed to.'); return; }
    if (!draft.lines.some(function (l) { return l.description || l.qty || l.rateCents; })) {
      toast('Add at least one line.'); return;
    }
    var fresh = !draft.id;
    if (fresh) {
      draft.id = S.uid('inv');
      if (!draft.number) draft.number = String(S.nextInvoiceNumber());
      draft.createdBy = me.name;
      db.invoices.push(draft);
    } else {
      var i = db.invoices.findIndex(function (x) { return x.id === draft.id; });
      if (i >= 0) db.invoices[i] = draft;
    }
    S.save();
    S.log('invoice', (fresh ? 'Created' : 'Updated') + ' invoice ' + draft.number + ' — ' + money(totals(draft).total));
    toast('Invoice ' + draft.number + ' saved.');
    renderEditor();
  }

  // ============================================================ LISTS
  function renderCustomers() {
    if (!db.customers.length) {
      $('#customerBody').innerHTML = emptyState('users', 'No saved customers',
        'Saving a customer just prefills the invoice. You can always type the details straight onto the invoice instead.',
        'Add customer', 'newCustomer');
      return;
    }
    $('#customerBody').innerHTML = '<div class="card"><div class="tablewrap"><table><thead><tr>' +
      '<th>Name</th><th>Address</th><th>Email</th><th>Phone</th><th class="coldel"></th></tr></thead><tbody>' +
      db.customers.map(function (c) {
        return '<tr><td><strong>' + esc(c.name) + '</strong></td><td style="color:var(--ink-2)">' +
          esc([c.line1, c.line2].filter(Boolean).join(', ') || '—') + '</td><td style="color:var(--ink-2)">' +
          esc(c.email || '—') + '</td><td class="mono" style="font-size:13px">' + esc(c.phone || '—') + '</td>' +
          '<td><button type="button" class="iconbtn" data-delcust="' + esc(c.id) + '" aria-label="Remove"><svg><use href="#i-trash"></use></svg></button></td></tr>';
      }).join('') + '</tbody></table></div></div>';

    $$('[data-delcust]').forEach(function (b) {
      b.addEventListener('click', function () {
        db.customers = db.customers.filter(function (c) { return c.id !== b.dataset.delcust; });
        S.save(); S.log('customer', 'Removed a customer'); render(); toast('Customer removed.');
      });
    });
  }

  function customerModal() {
    openModal('Add customer',
      field('name', 'Company name', { required: true }) + field('line1', 'Address line 1') +
      field('line2', 'Address line 2') + field('email', 'Email', { type: 'email' }) + field('phone', 'Phone'),
      function (d) {
        if (!d.name) return;
        db.customers.push({ id: S.uid('cus'), name: d.name, line1: d.line1, line2: d.line2, email: d.email, phone: d.phone });
        S.save(); S.log('customer', 'Added ' + d.name); closeModal(); render(); toast('Customer added.');
      });
  }

  function renderProducts() {
    var rec = isRecycling();
    $('#prodTitle').textContent = rec ? 'Materials' : 'Products';
    $('#prodCta').textContent = rec ? 'Add material' : 'Add product';
    $('#prodSub').textContent = rec ? 'What you collect and sell, with the unit you weigh it in.' : 'What you import and distribute, with sizes if they have them.';

    var list = products();
    if (!list.length) {
      $('#productBody').innerHTML = emptyState('tag', rec ? 'No materials yet' : 'No products yet',
        rec ? 'Add what you handle — cardboard, copper, aluminium. Each carries its own unit and default rate.'
            : 'Add what you distribute. List the sizes and inventory breaks out by size like your spreadsheet.',
        rec ? 'Add material' : 'Add product', 'newProduct');
      return;
    }
    $('#productBody').innerHTML = '<div class="card"><div class="tablewrap"><table><thead><tr>' +
      '<th>Name</th><th>Category</th><th>Unit</th><th>Captured by</th><th>Sizes</th><th class="num">Default rate</th><th class="coldel"></th>' +
      '</tr></thead><tbody>' + list.map(function (p) {
        return '<tr><td><strong>' + esc(p.name) + '</strong></td><td style="color:var(--muted)">' + esc(p.category || '—') + '</td>' +
          '<td>' + esc(p.unit) + '</td><td><span class="pill flat">' + (p.capture === 'weighed' ? 'Scale' : 'Count') + '</span></td>' +
          '<td style="color:var(--ink-2)">' + esc((p.sizes || []).join(' · ') || '—') + '</td>' +
          '<td class="num">' + (p.rateCents ? money(p.rateCents) : '—') + '</td>' +
          '<td><button type="button" class="iconbtn" data-delprod="' + esc(p.id) + '" aria-label="Remove"><svg><use href="#i-trash"></use></svg></button></td></tr>';
      }).join('') + '</tbody></table></div></div>';

    $$('[data-delprod]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (db.tickets.some(function (t) { return t.productId === b.dataset.delprod; })) { toast('That has tickets against it.'); return; }
        db.products = db.products.filter(function (p) { return p.id !== b.dataset.delprod; });
        S.save(); S.log('product', 'Removed an item'); render(); toast('Removed.');
      });
    });
  }

  function productModal() {
    var rec = isRecycling();
    openModal(rec ? 'Add material' : 'Add product',
      field('name', 'Name', { required: true, placeholder: rec ? 'OCC Cardboard' : 'Synguard 100' }) +
      field('category', 'Category', { placeholder: rec ? 'Paper' : 'Gloves' }) +
      field('unit', 'Unit', { value: rec ? 'kg' : 'cases', help: 'kg, tonne, cases, each.' }) +
      field('capture', 'Captured by', { type: 'select', value: rec ? 'weighed' : 'counted',
        options: [{ value: 'weighed', label: 'Scale — gross and tare' }, { value: 'counted', label: 'Count — a quantity' }] }) +
      field('sizes', 'Sizes', { placeholder: 'XL, L, M, S', help: 'Leave empty if it has none.' }) +
      field('rate', 'Default rate', { placeholder: '140.00', help: 'Per unit.' }),
      function (d) {
        if (!d.name) return;
        db.products.push({ id: S.uid('prd'), entity: entity, name: d.name, category: d.category,
          unit: d.unit || (rec ? 'kg' : 'cases'), capture: d.capture,
          sizes: d.sizes ? d.sizes.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [],
          rateCents: parseMoney(d.rate) });
        S.save(); S.log('product', 'Added ' + d.name); closeModal(); render(); toast('Added.');
      });
  }

  // ============================================================ STAFF
  function renderStaff() {
    $('#staffBody').innerHTML = '<div class="card"><div class="tablewrap"><table><thead><tr>' +
      '<th>Name</th><th>Email</th><th>Role</th><th>Status</th><th class="coldel"></th></tr></thead><tbody>' +
      db.staff.map(function (u) {
        var isMe = u.id === me.id;
        return '<tr><td><strong>' + esc(u.name) + '</strong>' + (isMe ? ' <span class="pill flat">you</span>' : '') + '</td>' +
          '<td class="mono" style="font-size:13px">' + esc(u.email) + '</td>' +
          '<td>' + esc((ROLES[u.role] || {}).label || u.role) + '</td>' +
          '<td>' + (u.active ? '<span class="pill good">Active</span>' : '<span class="pill crit">Deactivated</span>') + '</td>' +
          '<td>' + (isMe ? '' : '<button type="button" class="btn ghost sm" data-togglestaff="' + esc(u.id) + '">' +
            (u.active ? 'Deactivate' : 'Reactivate') + '</button>') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="pad" style="padding-top:0"><div class="note" style="margin-top:14px"><svg><use href="#i-alert"></use></svg><div>' +
      '<b>This is a front door, not a lock.</b> With no server there is no password to check — the app trusts the email typed in. ' +
      'It keeps the wrong people out of the interface and records who did what, but anyone who can open this browser could sign in as anybody. ' +
      'Real authentication arrives with the server.</div></div></div></div>';

    $$('[data-togglestaff]').forEach(function (b) {
      b.addEventListener('click', function () {
        var u = db.staff.filter(function (x) { return x.id === b.dataset.togglestaff; })[0];
        if (!u) return;
        u.active = !u.active; S.save();
        S.log('staff', (u.active ? 'Reactivated ' : 'Deactivated ') + u.name);
        render(); toast(u.active ? 'Reactivated.' : 'Deactivated.');
      });
    });
  }

  function staffModal() {
    openModal('Add staff',
      field('name', 'Full name', { required: true }) +
      field('email', 'Work email', { type: 'email', required: true, help: 'This is the only address that will let them in.' }) +
      field('role', 'Role', { type: 'select', value: 'staff', options: [
        { value: 'staff', label: 'Staff — stock, photos, own hours' },
        { value: 'manager', label: 'Manager — everything except staff and settings' },
        { value: 'admin', label: 'Administrator — full access' }] }),
      function (d) {
        if (!d.name || !d.email) return;
        var email = d.email.trim().toLowerCase();
        if (db.staff.some(function (x) { return x.email.toLowerCase() === email; })) { toast('That email is already registered.'); return; }
        db.staff.push({ id: S.uid('stf'), email: email, name: d.name, role: d.role, active: true, createdAt: new Date().toISOString() });
        S.save(); S.log('staff', 'Added ' + d.name + ' (' + d.role + ')'); closeModal(); render(); toast(d.name + ' can now sign in.');
      });
  }

  // ============================================================ HISTORY
  function renderHistory() {
    var byId = {}; db.staff.forEach(function (u) { byId[u.id] = u; });
    var acts = db.activity.slice().reverse();
    if (!acts.length) { $('#historyBody').innerHTML = emptyState('history', 'Nothing recorded yet', 'Every action anyone takes shows up here.'); return; }

    $('#historyBody').innerHTML = '<div class="card">' + acts.slice(0, 400).map(function (a) {
      var u = byId[a.staffId];
      return '<div class="histrow"><span class="histwhen">' + esc(when(a.at)) + '</span>' +
        '<span class="histwho">' + esc(u ? u.name : 'Unknown') + '</span>' +
        '<span class="histwhat">' + esc(a.detail || a.action) + '</span></div>';
    }).join('') + '</div>' +
    (acts.length > 400 ? '<p style="color:var(--muted);font-size:13px;margin-top:12px">Showing the 400 most recent of ' + acts.length + '.</p>' : '');
  }

  // ============================================================ SETTINGS
  function renderSettings() {
    var co = db.company;
    $('#settingsBody').innerHTML =
      '<div class="card"><div class="cardhead"><h3>Company</h3><span class="sub">Prefills every new invoice</span></div>' +
      '<div class="pad"><div class="grid g2" id="coFields">' +
        field('name', 'Legal name', { value: co.name }) + field('line1', 'Address line 1', { value: co.line1 }) +
        field('line2', 'Address line 2', { value: co.line2 }) + field('email', 'Email', { value: co.email }) +
        field('phone', 'Phone', { value: co.phone }) + field('bn', 'Business number', { value: co.bn }) +
        field('gst', 'GST/HST registration', { value: co.gst }) +
      '</div><button type="button" class="btn" id="saveCo" style="margin-top:16px">Save company details</button></div></div>' +

      '<div class="card"><div class="cardhead"><h3>Warehouses</h3>' +
        '<button type="button" class="btn ghost sm" id="addWh"><svg><use href="#i-plus"></use></svg>Add</button></div>' +
      '<div class="tablewrap"><table><thead><tr><th>Name</th><th>Province</th><th>Sales tax</th><th class="coldel"></th></tr></thead><tbody>' +
      db.warehouses.map(function (w) {
        return '<tr><td><strong>' + esc(w.name) + '</strong></td><td>' + esc(w.province) + '</td>' +
          '<td style="color:var(--ink-2)">' + esc(taxFor(w.province).label) + '</td>' +
          '<td><button type="button" class="iconbtn" data-delwh="' + esc(w.id) + '" aria-label="Remove"><svg><use href="#i-trash"></use></svg></button></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="pad" style="padding-top:0"><div class="note" style="margin-top:14px"><svg><use href="#i-alert"></use></svg><div>' +
      '<b>BC PST is not applied.</b> Only GST and HST. Whether PST applies to recyclable material sold for reprocessing is a question for your accountant — ' +
      'and every invoice lets you type the tax label and rate directly if a job needs something different.</div></div></div></div>' +

      '<div class="card"><div class="cardhead"><h3>Your data</h3><span class="sub">This browser only</span></div>' +
      '<div class="pad"><p style="margin:0 0 14px;color:var(--ink-2);font-size:14px;max-width:64ch">' +
      'No server. Everything — staff, invoices, tickets and photos — lives in this browser on this device. ' +
      'It is private and works offline, and it is <b>gone if you clear site data</b>. Export regularly.</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<button type="button" class="btn ghost" id="exportData">Export backup (.json)</button>' +
      '<button type="button" class="btn ghost" id="importData">Import backup</button>' +
      '<button type="button" class="btn danger" id="wipeData">Erase everything</button></div>' +
      '<p style="margin:14px 0 0;color:var(--muted);font-size:13px">Photos are large and are <b>not</b> in the JSON backup — they stay on the device.</p>' +
      '<input type="file" id="importFile" accept="application/json" hidden></div></div>';

    $('#saveCo').addEventListener('click', function () {
      $$('#coFields [name]').forEach(function (el) { db.company[el.name] = el.value.trim(); });
      S.save(); S.log('settings', 'Updated company details'); render(); toast('Saved.');
    });

    $('#addWh').addEventListener('click', function () {
      openModal('Add warehouse', field('name', 'Name', { required: true, placeholder: 'Mississauga, ON' }) +
        field('province', 'Province', { type: 'select', value: 'ON',
          options: PROVINCES.map(function (p) { return { value: p, label: p + ' — ' + TAX[p].label }; }) }),
        function (d) {
          if (!d.name) return;
          db.warehouses.push({ id: S.uid('wh'), name: d.name, province: d.province });
          S.save(); S.log('settings', 'Added warehouse ' + d.name); closeModal(); syncChrome(); render(); toast('Added.');
        });
    });

    $$('[data-delwh]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (db.warehouses.length === 1) { toast('You need at least one warehouse.'); return; }
        if (db.tickets.some(function (t) { return t.warehouseId === b.dataset.delwh; })) { toast('That warehouse has tickets.'); return; }
        db.warehouses = db.warehouses.filter(function (w) { return w.id !== b.dataset.delwh; });
        if (warehouseId === b.dataset.delwh) warehouseId = db.warehouses[0].id;
        S.save(); S.log('settings', 'Removed a warehouse'); syncChrome(); render(); toast('Removed.');
      });
    });

    $('#exportData').addEventListener('click', function () {
      var blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'greenwave-backup-' + today() + '.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      S.log('export', 'Downloaded a backup'); toast('Backup downloaded.');
    });

    $('#importData').addEventListener('click', function () { $('#importFile').click(); });
    $('#importFile').addEventListener('change', function (e) {
      var f = e.target.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          var next = JSON.parse(r.result);
          if (!next || !next.company || !Array.isArray(next.warehouses)) throw new Error('bad');
          db = S.replace(next); warehouseId = db.warehouses[0].id;
          me = S.me();
          if (!me) { showGate(); return; }
          syncChrome(); render(); toast('Backup restored.');
        } catch (err) { toast("That file isn't a Greenwave backup."); }
      };
      r.readAsText(f); e.target.value = '';
    });

    $('#wipeData').addEventListener('click', function () {
      if (!confirm('Erase all staff, customers, materials, tickets, invoices and photos on this device?\n\nThis cannot be undone.')) return;
      Photos.clear().then(function () {
        db = S.reset(); warehouseId = db.warehouses[0].id; me = null; draft = null;
        showGate(); toast('Everything erased.');
      });
    });
  }

  // ============================================================ MODAL
  var modalSubmit = null;
  function openModal(title, html, onSubmit, ok) {
    $('#modalTitle').textContent = title;
    $('#modalForm').innerHTML = html;
    $('#modalOk').textContent = ok || 'Save';
    $('#modalWrap').hidden = false;
    modalSubmit = onSubmit;
    var f = $('#modalForm input, #modalForm select, #modalForm textarea');
    if (f) f.focus();
  }
  function closeModal() { $('#modalWrap').hidden = true; $('#modalForm').innerHTML = ''; modalSubmit = null; }

  // ============================================================ RENDER
  function render() {
    if (view === 'inventory') renderInventory();
    else if (view === 'intake') renderIntake();
    else if (view === 'photos') renderPhotos();
    else if (view === 'timeclock') renderTimeclock();
    else if (view === 'invoices') renderInvoiceList();
    else if (view === 'editor') renderEditor();
    else if (view === 'customers') renderCustomers();
    else if (view === 'products') renderProducts();
    else if (view === 'staff') renderStaff();
    else if (view === 'history') renderHistory();
    else if (view === 'settings') renderSettings();
  }

  // ============================================================ WIRING
  $$('.entsw button').forEach(function (b) {
    b.addEventListener('click', function () {
      entity = b.dataset.entity; db.lastEntity = entity; S.save();
      draft = null; syncChrome();
      show((view === 'invoices' || view === 'editor') && !isRecycling() ? 'inventory' : view);
    });
  });
  $$('.navitem').forEach(function (b) {
    b.addEventListener('click', function () { if (b.dataset.view === 'invoices') draft = null; show(b.dataset.view); });
  });
  $('#wh').addEventListener('change', function (e) { warehouseId = e.target.value; syncChrome(); render(); });
  $('#menuBtn').addEventListener('click', function () { $('#app').classList.toggle('menu-open'); });
  $('#signOut').addEventListener('click', signOut);
  $('#newInvoice').addEventListener('click', function () { draft = newDraft(); show('editor'); });
  $('#newCustomer').addEventListener('click', customerModal);
  $('#newProduct').addEventListener('click', productModal);
  $('#newStaff').addEventListener('click', staffModal);
  $('#edSave').addEventListener('click', saveInvoice);
  $('#edPrint').addEventListener('click', function () { window.print(); });
  $('#addPhoto').addEventListener('click', function () { $('#photoFile').click(); });
  $('#photoFile').addEventListener('change', function (e) { addPhotos(e.target.files); e.target.value = ''; });
  $('#modalClose').addEventListener('click', closeModal);
  $('#modalCancel').addEventListener('click', closeModal);
  $('#modalWrap').addEventListener('mousedown', function (e) { if (e.target === $('#modalWrap')) closeModal(); });
  $('#modalForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var d = {};
    $$('#modalForm [name]').forEach(function (el) { d[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim(); });
    if (modalSubmit) modalSubmit(d);
  });
  $('#lbClose').addEventListener('click', function () { $('#lightbox').hidden = true; });
  $('#lightbox').addEventListener('click', function (e) { if (e.target === $('#lightbox')) $('#lightbox').hidden = true; });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!$('#modalWrap').hidden) closeModal();
    else if (!$('#lightbox').hidden) $('#lightbox').hidden = true;
  });

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
    if (a === 'newInvoice') { draft = newDraft(); show('editor'); }
    else if (a === 'newCustomer') customerModal();
    else if (a === 'newProduct') productModal();
    else if (a === 'newStaff') staffModal();
    else if (a === 'goProducts') show('products');
    else if (a === 'addPhoto') $('#photoFile').click();
  });

  // ============================================================ BOOT
  function boot() {
    db = S.get();
    me = S.me();
    if (!me || !me.active) { db.session = null; S.save(); showGate(); return; }
    $('#gate').hidden = true;
    $('#app').hidden = false;
    warehouseId = (db.warehouses[0] || {}).id;
    syncChrome();
    show(can('invoices') && isRecycling() ? 'invoices' : 'inventory');
  }

  boot();

  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* offline caching is a bonus, not a requirement */ });
  }
})();
