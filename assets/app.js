/* ==========================================================================
   Greenwave Ops

   Frontend for the real GreenWave API (see assets/api.js). Every business
   record — customers, materials, staff, invoices, inventory, photos, time
   clock, history — is fetched from and written to the server on every view;
   the browser is a client, not the source of truth. Local storage
   (assets/store.js) is now limited to the session pointer, UI preferences
   and the invoice letterhead defaults, none of which the API models.
   ========================================================================== */
(function () {
  'use strict';

  var S = window.Store;
  var Api = window.GreenwaveApi;

  /* Sales tax follows the province goods ship FROM, so it belongs to the
     warehouse. Every invoice keeps its own copy of the label and rate, so a
     rate change tomorrow never rewrites an invoice raised today — and you
     can type over either one when a job needs it. The API stores the rate
     as a percentage (5 means 5%), not a fraction — TAX below is decimal for
     display convenience and converted at the api.js boundary. */
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
  function moneyDollars(d) { return money(Math.round((Number(d) || 0) * 100)); }
  function parseMoney(s) { var n = parseFloat(String(s).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? Math.round(n * 100) : 0; }
  function parseDollars(s) { var n = parseFloat(String(s).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? Math.round(n * 100) / 100 : 0; }
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

  function loadingState(sel) {
    $(sel).innerHTML = '<div class="card"><div class="pad" style="text-align:center;color:var(--muted)">Loading…</div></div>';
  }

  /* A failed fetch (API down, network offline, no permission) must render an
     actionable message in place, never leave the section blank or throw an
     unhandled rejection that could blank the whole screen — see the
     white-screen regression notes in docs/V2_IMPLEMENTATION.md. */
  function apiErrorState(sel, err) {
    var msg = (err && err.status === 0) ? (err.message || "Can't reach the GreenWave server.")
      : (err && err.status === 403) ? "You don't have permission to see this."
      : (err && err.message) || 'Something went wrong loading this.';
    $(sel).innerHTML = '<div class="card"><div class="empty">' +
      '<span class="eico"><svg><use href="#i-alert"></use></svg></span>' +
      '<h3>Could not load this</h3><p>' + esc(msg) + '</p>' +
      '<button type="button" class="btn ghost" data-action="retry">Try again</button>' +
      '</div></div>';
    var b = $(sel + ' [data-action="retry"]');
    if (b) b.addEventListener('click', render);
  }

  function field(name, label, o) {
    o = o || {};
    var v = o.value == null ? '' : o.value, input;
    if (o.type === 'select') {
      input = '<select name="' + name + '"' + (o.required ? ' required' : '') + (o.disabled ? ' disabled' : '') + '>' + o.options.map(function (x) {
        return '<option value="' + esc(x.value) + '"' + (String(x.value) === String(v) ? ' selected' : '') + '>' + esc(x.label) + '</option>';
      }).join('') + '</select>';
    } else if (o.type === 'textarea') {
      input = '<textarea name="' + name + '"' + (o.rows ? ' rows="' + o.rows + '"' : '') + (o.disabled ? ' disabled' : '') + '>' + esc(v) + '</textarea>';
    } else {
      input = '<input type="' + (o.type || 'text') + '" name="' + name + '" value="' + esc(v) + '"' +
        (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') +
        (o.step ? ' step="' + o.step + '"' : '') + (o.required ? ' required' : '') +
        (o.disabled ? ' disabled' : '') +
        (o.autocomplete ? ' autocomplete="' + o.autocomplete + '"' : '') + '>';
    }
    return '<div class="field"><label for="' + name + '">' + esc(label) + '</label>' + input +
      (o.help ? '<span class="help">' + o.help + '</span>' : '') + '</div>';
  }

  // ------------------------------------------------------------- state
  var db = S.get();
  var entity = db.lastEntity || 'recycling';
  var warehouses = [];
  var warehouseId = null;
  var view = 'inventory';
  var draft = null;
  var me = null;
  var usersCache = null;          // admin/manager only — used to resolve names for history/photos/team clock
  var customersCache = [];
  var invoiceListCache = [];
  var currentShiftCache = null;
  var clockTimer = null;

  function warehouse() { return warehouses.filter(function (w) { return w.id === warehouseId; })[0] || warehouses[0]; }
  function warehouseById(id) { return warehouses.filter(function (w) { return w.id === id; })[0]; }
  function warehouseName(id) { var w = warehouseById(id); return w ? w.name : '—'; }
  function taxFor(p) { return TAX[p] || TAX.BC; }
  function isRecycling() { return entity === 'recycling'; }
  function can(v) { return me && ROLES[me.role] && ROLES[me.role].sees.indexOf(v) >= 0; }
  function isAdminOrManager() { return me && (me.role === 'admin' || me.role === 'manager'); }

  function loadUsersCache() {
    if (usersCache) return Promise.resolve(usersCache);
    if (!isAdminOrManager()) return Promise.resolve(null);
    return Api.listUsers().then(function (list) { usersCache = list; return usersCache; }).catch(function () { return null; });
  }
  function userName(id) {
    if (me && id === me.id) return me.name;
    if (usersCache) { var u = usersCache.filter(function (x) { return x.id === id; })[0]; if (u) return u.fullName; }
    return 'User #' + id;
  }

  // Client-only tag on a material: which company it's shown under, and how
  // Intake captures its quantity. The backend material record has no such
  // column — see assets/store.js. Untagged materials (created elsewhere, or
  // before tagging) show under both companies as a plain count.
  function materialMeta(m) { return S.materialMeta(m.id) || {}; }
  function materialEntity(m) { var t = materialMeta(m).entity; return t || null; }
  function materialCapture(m) { return materialMeta(m).capture || 'counted'; }
  function visibleMaterials(list) {
    return list.filter(function (m) { var e = materialEntity(m); return e === null || e === entity; });
  }

  // ============================================================ SIGN IN
  //
  // Real server authentication (email + password against POST /auth/login).
  // The browser is not the authority any more — it never decides who is
  // allowed in; it just asks the server and shows what comes back. See
  // docs/V2_ARCHITECTURE.md #3.
  function gateError(msg, text) {
    msg.innerHTML = '<div class="gateerr"><svg><use href="#i-alert"></use></svg><div>' + text + '</div></div>';
  }

  function renderSignInForm(body) {
    body.innerHTML =
      '<h1>Sign in</h1>' +
      '<p class="lead">Enter your work email and password.</p>' +
      '<form id="signForm">' +
        field('email', 'Work email', { type: 'email', required: true, placeholder: 'you@greenwaverecycling.ca', autocomplete: 'email' }) +
        field('password', 'Password', { type: 'password', required: true, autocomplete: 'current-password' }) +
        '<button type="submit" class="btn" id="signSubmit">Sign in</button>' +
      '</form>' +
      '<div id="gateMsg"></div>' +
      '<div class="gatefoot">Only accounts an administrator has created can sign in. ' +
        '<a href="#" id="gotoBootstrap">First time setting this up?</a></div>';

    $('#signForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var email = $('[name="email"]', body).value.trim();
      var password = $('[name="password"]', body).value;
      var msg = $('#gateMsg');
      var btn = $('#signSubmit');
      msg.innerHTML = '';
      btn.disabled = true;
      btn.textContent = 'Signing in…';

      Api.login(email, password).then(function (user) {
        S.setServerSession(user);
        db = S.get();
        boot();
      }).catch(function (err) {
        btn.disabled = false;
        btn.textContent = 'Sign in';
        if (err.status === 401) {
          gateError(msg, '<b>Email or password is incorrect.</b><br>Check both and try again.');
        } else if (err.status === 429) {
          gateError(msg, '<b>Too many attempts.</b><br>Wait a minute and try again.');
        } else if (err.status === 0) {
          gateError(msg, '<b>Can’t reach the GreenWave server.</b><br>Check your connection and try again.');
        } else {
          gateError(msg, '<b>Sign-in failed.</b><br>' + esc(err.message || 'Please try again.'));
        }
      });
    });

    $('#gotoBootstrap').addEventListener('click', function (e) {
      e.preventDefault();
      renderBootstrapForm(body);
    });
  }

  function renderBootstrapForm(body) {
    body.innerHTML =
      '<h1>Set up the first administrator</h1>' +
      '<p class="lead">This only works once — before any account exists on the server. ' +
        'Every other person is then added by an administrator, from Staff.</p>' +
      '<form id="bootForm">' +
        field('name', 'Your name', { required: true, placeholder: 'Ansh Bapu' }) +
        field('email', 'Your work email', { type: 'email', required: true, placeholder: 'you@greenwaverecycling.ca', autocomplete: 'email' }) +
        field('password', 'Password', { type: 'password', required: true, autocomplete: 'new-password', help: 'At least 8 characters, with upper, lower and a number.' }) +
        '<button type="submit" class="btn" id="bootSubmit">Create administrator</button>' +
      '</form>' +
      '<div id="gateMsg"></div>' +
      '<div class="gatefoot"><a href="#" id="gotoSignIn">Already set up? Sign in instead</a></div>';

    $('#bootForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var name = $('[name="name"]', body).value.trim();
      var email = $('[name="email"]', body).value.trim();
      var password = $('[name="password"]', body).value;
      var msg = $('#gateMsg');
      var btn = $('#bootSubmit');
      if (!name || !email || !password) return;
      msg.innerHTML = '';
      btn.disabled = true;
      btn.textContent = 'Creating…';

      Api.registerFirstAdmin(name, email, password).then(function (user) {
        S.setServerSession(user);
        db = S.get();
        boot();
      }).catch(function (err) {
        btn.disabled = false;
        btn.textContent = 'Create administrator';
        if (err.status === 409) {
          gateError(msg, '<b>An administrator already exists.</b><br>Sign in instead.');
          setTimeout(function () { renderSignInForm(body); }, 1400);
        } else if (err.status === 400) {
          gateError(msg, '<b>' + esc(err.message || 'Check the form and try again.') + '</b>');
        } else if (err.status === 0) {
          gateError(msg, '<b>Can’t reach the GreenWave server.</b><br>Check your connection and try again.');
        } else {
          gateError(msg, '<b>Could not create the account.</b><br>' + esc(err.message || 'Please try again.'));
        }
      });
    });

    $('#gotoSignIn').addEventListener('click', function (e) {
      e.preventDefault();
      renderSignInForm(body);
    });
  }

  function showGate() {
    $('#app').hidden = true;
    $('#gate').hidden = false;
    renderSignInForm($('#gateBody'));
  }

  function signOut() {
    if (currentShiftCache && !confirm('You are still clocked in. Sign out anyway?\n\nYour shift stays open and keeps counting.')) return;
    S.clearSession();
    Api.clearSession();
    me = null;
    usersCache = null;
    currentShiftCache = null;
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
    sel.innerHTML = warehouses.map(function (w) {
      return '<option value="' + esc(w.id) + '">' + esc(w.name) + '</option>';
    }).join('');
    sel.value = warehouseId;

    var w = warehouse();
    var prov = (w && w.province) || 'BC';
    $('#taxNote').textContent = w ? prov + ' · ' + taxFor(prov).label : '';

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
    var chip = $('#shiftChip');
    var open = currentShiftCache;
    chip.hidden = !open;
    if (open) {
      chip.innerHTML = '<span class="dot"></span>On shift · ' + hm(Date.now() - new Date(open.clockIn).getTime());
    }
  }

  function refreshShiftChip() {
    return Api.currentShift().then(function (open) {
      currentShiftCache = open;
      renderShiftChip();
      return open;
    }).catch(function () { return null; });
  }

  function show(next) {
    if (next === 'invoices' && !isRecycling()) next = 'inventory';
    if (!can(next) && next !== 'editor') next = 'inventory';
    if (next === 'editor' && !can('invoices')) next = 'inventory';

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
  var SIZE_KEYS = ['xl', 'l', 'm', 's'];
  var SIZE_LABELS = { xl: 'XL', l: 'L', m: 'M', s: 'S' };

  function renderInventory() {
    var w = warehouse();
    $('#invenSub').textContent = w ? 'On hand at ' + w.name + ', derived from the server transaction ledger.' : '';
    $('#invenCta').textContent = isRecycling() ? 'Record a load' : 'Receive stock';
    if (!w) { $('#invenBody').innerHTML = ''; return; }

    loadingState('#invenBody');
    Promise.all([
      Api.listMaterials(),
      Api.listInventoryTransactions({ warehouseId: w.id })
    ]).then(function (r) {
      var list = visibleMaterials(r[0]);
      var txs = r[1];

      if (!list.length) {
        $('#invenBody').innerHTML = emptyState('tag', isRecycling() ? 'No materials yet' : 'No products yet',
          'Inventory is what you received less what you shipped. Add what you handle first.',
          can('products') ? (isRecycling() ? 'Add material' : 'Add product') : null, 'goProducts');
        return;
      }

      var showSizes = list.some(function (m) { return materialCapture(m) === 'sized'; });

      var map = {};
      list.forEach(function (m) { map[m.id] = { material: m, xl: 0, l: 0, m: 0, s: 0, total: 0 }; });
      txs.forEach(function (t) {
        var row = map[t.materialId]; if (!row) return;
        var sign = t.type === 'outbound' ? -1 : 1;
        SIZE_KEYS.forEach(function (k) { row[k] += sign * (Number(t[k]) || 0); });
        row.total += sign * (Number(t.total) || 0);
      });
      var rows = Object.keys(map).map(function (k) { return map[k]; });

      var head = '<tr><th>' + (isRecycling() ? 'Material' : 'Product') + '</th><th>Category</th>' +
        (showSizes ? SIZE_KEYS.map(function (k) { return '<th class="num">' + SIZE_LABELS[k] + '</th>'; }).join('') : '') +
        '<th class="num">On hand</th><th>Unit</th></tr>';

      var body = rows.map(function (r) {
        var sized = materialCapture(r.material) === 'sized';
        var cells = showSizes ? SIZE_KEYS.map(function (k) {
          return sized ? '<td class="num">' + num(r[k]) + '</td>' : '<td class="num" style="color:var(--muted)">–</td>';
        }).join('') : '';
        return '<tr><td><strong>' + esc(r.material.name) + '</strong></td><td style="color:var(--muted)">' +
          esc(r.material.category || '—') + '</td>' + cells +
          '<td class="num"><strong>' + num(r.total) + '</strong></td><td style="color:var(--muted)">' + esc(r.material.unit) + '</td></tr>';
      }).join('');

      var colTotals = showSizes ? SIZE_KEYS.map(function (k) { return rows.reduce(function (a, r) { return a + r[k]; }, 0); }) : [];
      var grand = rows.reduce(function (a, r) { return a + r.total; }, 0);

      $('#invenBody').innerHTML =
        '<div class="card"><div class="cardhead"><h3>On hand — ' + esc(w.name) + '</h3>' +
        '<span class="sub">' + txs.length + ' ledger entries here</span></div><div class="tablewrap"><table><thead>' + head + '</thead><tbody>' + body + '</tbody>' +
        '<tfoot><tr><td>Total</td><td></td>' + (showSizes ? colTotals.map(function (c) { return '<td class="num">' + num(c) + '</td>'; }).join('') : '') +
        '<td class="num">' + num(grand) + '</td><td style="font-weight:400;color:var(--muted)">from the server ledger</td></tr></tfoot></table></div></div>';
    }).catch(function (err) { apiErrorState('#invenBody', err); });
  }

  // ============================================================ INTAKE
  var intakeMaterials = [];

  function renderIntake() {
    var w = warehouse();
    $('#intakeTitle').textContent = isRecycling() ? 'Weigh-in' : 'Receive stock';
    $('#intakeSub').textContent = isRecycling()
      ? 'Gross less tare gives net. It posts to ' + (w ? w.name : 'the warehouse') + '.'
      : 'Count what arrived. It posts to ' + (w ? w.name : 'the warehouse') + '.';
    if (!w) { $('#intakeBody').innerHTML = ''; return; }

    loadingState('#intakeBody');
    Api.listMaterials().then(function (all) {
      var list = visibleMaterials(all);
      intakeMaterials = list;
      if (!list.length) {
        $('#intakeBody').innerHTML = emptyState('tag', 'Nothing to record against',
          'Add what you handle first, then come back.',
          can('products') ? (isRecycling() ? 'Add material' : 'Add product') : null, 'goProducts');
        return;
      }

      var dirOptions = '<option value="in">In — arriving</option><option value="out">Out — shipping</option>' +
        (isAdminOrManager() ? '<option value="adj">Adjustment — correct a count</option>' : '');

      $('#intakeBody').innerHTML =
        '<div class="card"><div class="cardhead"><h3>' + (isRecycling() ? 'Inbound ticket' : 'Receipt') + '</h3></div>' +
        '<div class="pad"><div class="grid g2">' +
          '<div class="field"><label>' + (isRecycling() ? 'Material' : 'Product') + '</label><select id="tkMaterial">' +
            list.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + ' (' + esc(m.unit) + ')</option>'; }).join('') +
          '</select></div>' +
          '<div class="field"><label>Direction</label><select id="tkDir">' + dirOptions + '</select></div>' +
          '<div class="field"><label>Date</label><input type="date" id="tkDate" value="' + today() + '"></div>' +
          '<div class="field"><label>Reference</label><input type="text" id="tkRef" class="mono" placeholder="Container, truck or BOL"></div>' +
        '</div><div id="tkReasonWrap" hidden style="margin-top:16px">' + field('reason', 'Reason for adjustment', { required: true }) + '</div>' +
        '<div id="tkQty" style="margin-top:16px"></div>' +
        '<div id="tkContainer" style="margin-top:16px"></div>' +
        '<button type="button" class="btn" id="tkPost" style="margin-top:18px"><svg><use href="#i-check"></use></svg>Post ticket</button>' +
        '<p style="margin:12px 0 0;color:var(--muted);font-size:13px">Posting is final. A mistake is corrected with an opposite ticket, so both stay on the record.</p>' +
        '</div></div><div id="tkRecent"></div>';

      $('#tkMaterial').addEventListener('change', renderQtyFields);
      $('#tkDir').addEventListener('change', function () {
        $('#tkReasonWrap').hidden = $('#tkDir').value !== 'adj';
        renderContainerFields();
      });
      $('#tkPost').addEventListener('click', postTicket);
      renderQtyFields();
      renderContainerFields();
      renderRecent(w);
    }).catch(function (err) { apiErrorState('#intakeBody', err); });
  }

  function currentMaterial() {
    var el = $('#tkMaterial'); if (!el) return null;
    return intakeMaterials.filter(function (m) { return m.id === el.value; })[0];
  }

  function renderQtyFields() {
    var m = currentMaterial(); if (!m) return;
    var host = $('#tkQty');
    var capture = materialCapture(m);
    if (capture === 'sized') {
      host.innerHTML = '<div class="grid g3">' + SIZE_KEYS.map(function (k) {
        return '<div class="field"><label>' + SIZE_LABELS[k] + '</label><input type="number" step="any" min="0" data-size="' + k + '" placeholder="0"></div>';
      }).join('') + '</div><div class="trow" style="margin-top:14px"><span class="lb">Total this ticket</span><span class="vl" id="tkTotal">0 ' + esc(m.unit) + '</span></div>';
      $$('#tkQty input').forEach(function (i) {
        i.addEventListener('input', function () {
          var t = 0; $$('#tkQty input[data-size]').forEach(function (x) { t += parseQty(x.value); });
          $('#tkTotal').textContent = num(t) + ' ' + m.unit;
        });
      });
    } else if (capture === 'weighed') {
      host.innerHTML = '<div class="grid g3">' +
        '<div class="field"><label>Gross (' + esc(m.unit) + ')</label><input type="number" step="any" min="0" id="tkGross" placeholder="0"></div>' +
        '<div class="field"><label>Tare (' + esc(m.unit) + ')</label><input type="number" step="any" min="0" id="tkTare" placeholder="0"></div>' +
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
      host.innerHTML = '<div class="grid g3"><div class="field"><label>Quantity (' + esc(m.unit) + ')</label>' +
        '<input type="number" step="any" min="0" id="tkQtyOne" placeholder="0"></div></div>';
    }
  }

  function renderContainerFields() {
    var host = $('#tkContainer'); if (!host) return;
    if ($('#tkDir').value !== 'in') { host.innerHTML = ''; return; }
    host.innerHTML = '<details><summary style="cursor:pointer;color:var(--ink-2);font-size:13.5px">Container / shipping details (optional)</summary>' +
      '<div class="grid g3" style="margin-top:12px">' +
        field('ctOrder', 'Order number') + field('ctBl', 'BL number') + field('ctLine', 'Shipping line') +
        field('ctNum', 'Container number') + field('ctSeal', 'Seal number') + field('ctEta', 'ETA', { type: 'date' }) +
      '</div></details>';
  }

  function maybeCreateContainer(w) {
    if ($('#tkDir').value !== 'in') return Promise.resolve(null);
    var host = $('#tkContainer');
    // field() only sets `name`, not `id` (an id here could collide with a
    // same-named field in a modal opened over this view) — so look these up
    // by name, scoped to the container section.
    var val = function (name) { var el = host && host.querySelector('[name="' + name + '"]'); return el ? el.value.trim() : ''; };
    var fields = { orderNumber: val('ctOrder'), blNumber: val('ctBl'), shippingLine: val('ctLine'), containerNumber: val('ctNum'), sealNumber: val('ctSeal'), eta: val('ctEta') };
    var has = Object.keys(fields).some(function (k) { return fields[k]; });
    if (!has) return Promise.resolve(null);
    var payload = { warehouseId: w.id };
    Object.keys(fields).forEach(function (k) { if (fields[k]) payload[k] = fields[k]; });
    return Api.createContainer(payload).then(function (c) { return c.id; });
  }

  function postTicket() {
    var m = currentMaterial(); if (!m) return;
    var w = warehouse(); if (!w) return;
    var dir = $('#tkDir').value;
    var type = dir === 'out' ? 'outbound' : dir === 'adj' ? 'adjustment' : 'inbound';
    var capture = materialCapture(m);
    var ref = $('#tkRef').value.trim();
    var payload = { warehouseId: w.id, materialId: m.id, type: type };

    if (capture === 'sized') {
      var vals = {}, total = 0;
      SIZE_KEYS.forEach(function (k) {
        var el = $('#tkQty input[data-size="' + k + '"]');
        var q = el ? parseQty(el.value) : 0;
        vals[k] = q; total += q;
      });
      if (!total) { toast('Enter a quantity for at least one size.'); return; }
      SIZE_KEYS.forEach(function (k) { if (vals[k]) payload[k] = vals[k]; });
      payload.reference = ref || undefined;
    } else if (capture === 'weighed') {
      var g = parseQty($('#tkGross').value), ta = parseQty($('#tkTare').value), net = g - ta;
      if (net <= 0) { toast('Net must be more than zero.'); return; }
      payload.s = net;
      payload.reference = (ref ? ref + ' · ' : '') + 'Gross ' + num(g) + ' / Tare ' + num(ta);
    } else {
      var q = parseQty($('#tkQtyOne').value);
      if (q <= 0) { toast('Enter a quantity.'); return; }
      payload.s = q;
      payload.reference = ref || undefined;
    }

    if (type === 'adjustment') {
      var reason = ($('[name="reason"]') || {}).value;
      reason = reason ? reason.trim() : '';
      if (!reason) { toast('Adjustments need a reason.'); return; }
      payload.reason = reason;
    }

    var btn = $('#tkPost'); btn.disabled = true;
    maybeCreateContainer(w).then(function (containerId) {
      if (containerId) payload.containerId = containerId;
      return Api.createInventoryTransaction(payload);
    }).then(function () {
      toast('Ticket posted.');
      renderIntake();
    }).catch(function (err) {
      btn.disabled = false;
      toast(err.message || 'Could not post that ticket.');
    });
  }

  function renderRecent(w) {
    Api.listInventoryTransactions({ warehouseId: w.id }).then(function (txs) {
      var host = $('#tkRecent'); if (!host) return;
      var mine = txs.slice(0, 8);
      if (!mine.length) { host.innerHTML = ''; return; }
      var byId = {}; intakeMaterials.forEach(function (m) { byId[m.id] = m; });

      host.innerHTML = '<div class="card"><div class="cardhead"><h3>Recent tickets here</h3></div>' +
        '<div class="tablewrap"><table><thead><tr><th>Date</th><th>Item</th><th>Reference</th><th>By</th><th></th><th class="num">Qty</th></tr></thead><tbody>' +
        mine.map(function (t) {
          var m = byId[t.materialId] || { name: '—', unit: '' };
          var q = num(t.total) + ' ' + m.unit;
          var by = (me && t.createdBy === me.id) ? me.name : (usersCache ? userName(t.createdBy) : ('Staff #' + t.createdBy));
          var kind = t.type === 'outbound' ? 'Out' : t.type === 'adjustment' ? 'Adj' : 'In';
          var pillClass = t.type === 'outbound' ? 'warn' : t.type === 'adjustment' ? 'flat' : 'good';
          return '<tr><td class="mono" style="font-size:13px">' + esc(when(t.createdAt).split(' ')[0]) + '</td><td>' + esc(m.name) + '</td>' +
            '<td class="mono" style="font-size:12.5px;color:var(--muted)">' + esc(t.reference || t.reason || '—') + '</td>' +
            '<td style="color:var(--ink-2)">' + esc(by) + '</td>' +
            '<td><span class="pill ' + pillClass + '">' + kind + '</span></td>' +
            '<td class="num">' + esc(q) + '</td></tr>';
        }).join('') + '</tbody></table></div></div>';
    }).catch(function () { var host = $('#tkRecent'); if (host) host.innerHTML = ''; });
  }

  // ============================================================ PHOTOS
  var photoCache = [];

  function renderPhotos() {
    var isAdmin = isAdminOrManager();
    $('#photoSub').textContent = isAdmin
      ? 'Every photo anyone has taken, newest first.'
      : 'Photos you have taken. Administrators can see all of them.';

    loadingState('#photoBody');
    loadUsersCache();
    var w = warehouse();
    Api.listPhotos({ warehouseId: w ? w.id : undefined }).then(function (all) {
      photoCache = all; // the server already scopes staff/driver to their own photos — no client filtering needed
      var used = photoCache.reduce(function (a, p) { return a + (p.sizeBytes || 0); }, 0);

      if (!photoCache.length) {
        $('#photoBody').innerHTML = emptyState('cam', 'No photos yet',
          'Take a picture of a load, a contaminated bin, a seal or a damaged pallet. On a phone this opens the camera directly.',
          'Add photo', 'addPhoto');
        return;
      }

      $('#photoBody').innerHTML = '<div class="card">' +
        '<div class="photobar"><span><b style="color:var(--ink)">' + photoCache.length + '</b> photos · ' + bytes(used) + '</span>' +
        '<span class="grow"></span></div>' +
        '<div class="photogrid">' + photoCache.map(function (p, i) {
          return '<button type="button" class="photo" data-photo="' + i + '">' +
            '<img src="' + esc(p.url) + '" alt="' + esc(p.jobReference || p.originalFilename || 'photo') + '" loading="lazy">' +
            '<span class="cap"><b>' + esc(userName(p.takenBy)) + '</b>' + esc(when(p.takenAt)) + '</span></button>';
        }).join('') + '</div></div>';

      $$('[data-photo]').forEach(function (b) {
        b.addEventListener('click', function () { openLightbox(Number(b.dataset.photo)); });
      });
    }).catch(function (err) { apiErrorState('#photoBody', err); });
  }

  function openLightbox(i) {
    var p = photoCache[i]; if (!p) return;
    $('#lbImg').src = p.url;
    $('#lbMeta').innerHTML = esc(userName(p.takenBy)) + ' · ' + esc(when(p.takenAt)) +
      ' · ' + bytes(p.sizeBytes) +
      (p.jobReference ? '<br>' + esc(p.jobReference) : '') +
      (me.role === 'admin' ? '<br><button type="button" class="btn danger" id="lbDel" style="margin-top:12px">Delete this photo</button>' : '');
    $('#lightbox').hidden = false;

    var del = $('#lbDel');
    if (del) del.addEventListener('click', function () {
      if (!confirm('Delete this photo permanently?')) return;
      Api.deletePhoto(p.id).then(function () {
        $('#lightbox').hidden = true;
        renderPhotos();
        toast('Photo deleted.');
      }).catch(function (err) { toast(err.message || 'Could not delete that photo.'); });
    });
  }

  function addPhotos(files) {
    if (!files || !files.length) return;
    var w = warehouse();
    var jobs = Array.prototype.slice.call(files).map(function (f) {
      return Photos.prepare(f).then(function (r) {
        return Api.uploadPhoto(r.file, { warehouseId: w ? w.id : undefined });
      });
    });
    toast(files.length > 1 ? 'Uploading ' + files.length + ' photos…' : 'Uploading photo…');

    var settle = Promise.allSettled ? Promise.allSettled(jobs) : Promise.all(jobs.map(function (p) {
      return p.then(function (v) { return { status: 'fulfilled', value: v }; }, function (e) { return { status: 'rejected', reason: e }; });
    }));

    settle.then(function (results) {
      var ok = results.filter(function (r) { return r.status === 'fulfilled'; }).length;
      var fail = results.length - ok;
      if (ok && !fail) toast(ok + ' photo' + (ok === 1 ? '' : 's') + ' uploaded.');
      else if (ok) toast(ok + ' uploaded, ' + fail + ' failed.');
      else toast('Could not upload ' + (fail === 1 ? 'that photo.' : 'those photos.'));
      renderPhotos();
    });
  }

  // ============================================================ TIME CLOCK
  function renderTimeclock() {
    loadingState('#clockBody');
    loadUsersCache();
    Promise.all([Api.currentShift(), Api.shiftHistory()]).then(function (r) {
      var open = r[0], mine = r[1];
      currentShiftCache = open;
      renderShiftChip();

      var weekAgo = Date.now() - 7 * 864e5;
      var weekMs = mine.reduce(function (a, s) {
        var st = new Date(s.clockIn).getTime();
        if (st < weekAgo) return a;
        return a + ((s.clockOut ? new Date(s.clockOut).getTime() : Date.now()) - st);
      }, 0);

      $('#clockBody').innerHTML =
        '<div class="card"><div class="clockcard">' +
          '<div class="clockstate">' + (open ? 'On shift since ' + new Date(open.clockIn).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' }) : 'Clocked out') + '</div>' +
          '<div class="clocktime ' + (open ? 'on' : 'off') + '" id="clockTime">' +
            (open ? hm(Date.now() - new Date(open.clockIn).getTime()) : '—') + '</div>' +
          '<div class="clocksince">' + hm(weekMs) + ' in the last 7 days</div>' +
          '<button type="button" class="btn' + (open ? ' ghost' : '') + '" id="clockBtn">' +
            '<svg><use href="#i-' + (open ? 'stop' : 'play') + '"></use></svg>' + (open ? 'Clock out' : 'Clock in') + '</button>' +
        '</div></div>' +

        (mine.length ? '<div class="card"><div class="cardhead"><h3>Your shifts</h3><span class="sub">' + mine.length + ' recorded</span></div>' +
          '<div class="tablewrap"><table><thead><tr><th>Started</th><th>Ended</th><th class="num">Length</th></tr></thead><tbody>' +
          mine.slice(0, 30).map(function (s) {
            return '<tr><td class="mono" style="font-size:13px">' + esc(when(s.clockIn)) + '</td>' +
              '<td class="mono" style="font-size:13px">' + (s.clockOut ? esc(when(s.clockOut)) : '<span class="pill good">open</span>') + '</td>' +
              '<td class="num">' + (s.clockOut ? hm(new Date(s.clockOut) - new Date(s.clockIn)) : hm(Date.now() - new Date(s.clockIn))) + '</td></tr>';
          }).join('') + '</tbody></table></div></div>' : '') +
        '<div id="teamClockCard"></div>';

      $('#clockBtn').addEventListener('click', toggleClock);

      if (isAdminOrManager()) {
        Api.teamShifts().then(function (rows) {
          var host = $('#teamClockCard'); if (!host) return;
          if (!rows.length) { host.innerHTML = ''; return; }
          host.innerHTML = '<div class="card"><div class="cardhead"><h3>On shift right now</h3>' +
            '<span class="sub">' + rows.length + ' clocked in</span></div>' +
            '<div class="tablewrap"><table><thead><tr><th>Name</th><th>Warehouse</th><th class="num">Since</th></tr></thead><tbody>' +
            rows.map(function (s) {
              return '<tr><td><strong>' + esc(userName(s.userId)) + '</strong></td>' +
                '<td style="color:var(--muted)">' + esc(warehouseName(s.warehouseId)) + '</td>' +
                '<td class="num">' + esc(when(s.clockIn)) + '</td></tr>';
            }).join('') + '</tbody></table></div>' +
            '<p style="margin:0;padding:0 16px 16px;color:var(--muted);font-size:13px">Shows who is on shift right now. Historical hours for other staff aren\'t available from the server yet — each person can only see their own past shifts.</p></div>';
        }).catch(function () { var host = $('#teamClockCard'); if (host) host.innerHTML = ''; });
      }

      if (clockTimer) clearInterval(clockTimer);
      if (open) {
        clockTimer = setInterval(function () {
          var el = $('#clockTime');
          if (!el) { clearInterval(clockTimer); clockTimer = null; return; }
          el.textContent = hm(Date.now() - new Date(open.clockIn).getTime());
          renderShiftChip();
        }, 30000);
      }
    }).catch(function (err) { apiErrorState('#clockBody', err); });
  }

  function toggleClock() {
    var btn = $('#clockBtn'); if (btn) btn.disabled = true;
    var open = currentShiftCache;
    var call = open ? Api.clockOut() : Api.clockIn(warehouseId);
    call.then(function () {
      toast(open ? 'Clocked out.' : 'Clocked in.');
      renderTimeclock();
    }).catch(function (err) {
      if (btn) btn.disabled = false;
      toast(err.status === 409 ? 'You are already clocked in.' : (err.message || 'Could not update your shift.'));
    });
  }

  // ============================================================ INVOICES
  function newDraft() {
    var w = warehouse(), co = db.company, t = taxFor(w ? w.province : 'BC');
    return {
      id: null, invoiceNumber: null,
      customerId: '', billTo: '', shipTo: '',
      warehouseId: w ? w.id : null, province: w ? w.province : 'BC',
      poReference: '', termsDays: 15,
      invoiceDate: today(),
      taxLabel: t.label, taxRatePct: t.rate * 100,
      companyInfo: { name: co.name, line1: co.line1, line2: co.line2, email: co.email, phone: co.phone, bn: co.bn, gst: co.gst },
      notes: '', status: 'draft',
      items: [blankLine()]
    };
  }
  function blankLine() { return { description: '', unit: '', quantity: 0, unitPrice: 0, discount: 0, isRebate: false }; }

  function invoiceToDraft(inv) {
    var termsDays = 15;
    if (inv.dueDate && inv.invoiceDate) {
      termsDays = Math.round((new Date(inv.dueDate) - new Date(inv.invoiceDate)) / 864e5);
    }
    var items = (inv.items || []).map(function (it) {
      return { description: it.description, unit: it.unit || '', quantity: Number(it.quantity), unitPrice: Number(it.unitPrice), discount: Number(it.discount) || 0, isRebate: !!it.isRebate };
    });
    if (!items.length) items = [blankLine()];
    var wh = warehouseById(inv.warehouseId);
    return {
      id: inv.id, invoiceNumber: inv.invoiceNumber,
      customerId: inv.customerId || '', billTo: inv.billTo || '', shipTo: inv.shipTo || '',
      warehouseId: inv.warehouseId || null, province: wh ? wh.province : 'BC',
      poReference: inv.poReference || '', termsDays: termsDays,
      invoiceDate: inv.invoiceDate,
      taxLabel: inv.taxLabel || '', taxRatePct: Number(inv.taxRate) || 0,
      companyInfo: inv.companyInfo || {}, notes: inv.notes || '',
      status: inv.status || 'draft',
      items: items
    };
  }

  function lineAmountDollars(l) {
    var gross = Math.round(((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0) - (Number(l.discount) || 0)) * 100) / 100;
    return l.isRebate ? -gross : gross;
  }
  function totalsLocal(inv) {
    var sub = 0;
    inv.items.forEach(function (l) { sub = Math.round((sub + lineAmountDollars(l)) * 100) / 100; });
    var tax = Math.round(sub * ((Number(inv.taxRatePct) || 0) / 100) * 100) / 100;
    return { subtotal: sub, tax: tax, total: Math.round((sub + tax) * 100) / 100 };
  }

  function renderInvoiceList() {
    loadingState('#invoiceList');
    Api.listInvoices({ warehouseId: warehouseId }).then(function (list) {
      invoiceListCache = list;
      if (!list.length) {
        $('#invoiceList').innerHTML = emptyState('doc', 'No invoices yet',
          'Numbering is assigned by the server when you save. Every field is free text.',
          'New invoice', 'newInvoice');
        return;
      }
      $('#invoiceList').innerHTML = '<div class="card"><div class="tablewrap"><table><thead><tr>' +
        '<th>No.</th><th>Bill to</th><th>Date</th><th>Due</th><th class="num">Total</th><th>Status</th><th class="coldel"></th></tr></thead><tbody>' +
        list.slice().sort(function (a, b) { return String(b.invoiceNumber).localeCompare(String(a.invoiceNumber), undefined, { numeric: true }); })
        .map(function (inv) {
          var due = inv.dueDate || '', late = due && due < today();
          return '<tr class="click" data-invoice="' + esc(inv.id) + '">' +
            '<td class="mono"><strong>' + esc(inv.invoiceNumber) + '</strong></td>' +
            '<td>' + esc((inv.billTo || '').split('\n')[0] || '—') + '</td>' +
            '<td class="mono" style="font-size:13px">' + esc(inv.invoiceDate) + '</td>' +
            '<td class="mono" style="font-size:13px">' + esc(due || '—') + '</td>' +
            '<td class="num">' + moneyDollars(inv.total) + '</td>' +
            '<td><span class="pill ' + (late ? 'crit' : 'flat') + '">' + (late ? 'Overdue' : (inv.status === 'draft' ? 'Draft' : 'Open')) + '</span></td>' +
            '<td><button type="button" class="iconbtn" data-dupe="' + esc(inv.id) + '" aria-label="Duplicate"><svg><use href="#i-doc"></use></svg></button></td></tr>';
        }).join('') + '</tbody></table></div></div>';

      $$('[data-dupe]').forEach(function (b) {
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          Api.duplicateInvoice(b.dataset.dupe).then(function (saved) {
            draft = invoiceToDraft(saved);
            toast('Duplicated as invoice ' + saved.invoiceNumber + '.');
            show('editor');
          }).catch(function (err) { toast(err.message || 'Could not duplicate that invoice.'); });
        });
      });
    }).catch(function (err) { apiErrorState('#invoiceList', err); });
  }

  /* Every field on the sheet is an input. Customers and warehouses only
     prefill it — nothing is locked, because real invoices always need a
     one-off change somewhere. */
  function renderEditor() {
    if (!draft) draft = newDraft();
    var inv = draft, t = totalsLocal(inv), due = addDays(inv.invoiceDate, inv.termsDays);
    $('#edTitle').textContent = inv.invoiceNumber ? ('Invoice ' + inv.invoiceNumber) : 'New invoice';

    var lineRows = inv.items.map(function (l, i) {
      return '<tr>' +
        '<td class="colno" data-lbl="#">' + (i + 1) + '.</td>' +
        '<td class="wide" data-lbl="Description"><input type="text" data-li="' + i + '" data-k="description" value="' + esc(l.description) + '" placeholder="What was supplied"></td>' +
        '<td data-lbl="Unit"><input type="text" data-li="' + i + '" data-k="unit" value="' + esc(l.unit) + '" placeholder="tonne"></td>' +
        '<td class="colqty" data-lbl="Qty"><input type="number" step="0.001" data-li="' + i + '" data-k="quantity" value="' + (l.quantity || '') + '" placeholder="0.000"></td>' +
        '<td class="colrate" data-lbl="Rate"><input type="text" data-li="' + i + '" data-k="unitPrice" value="' + (l.unitPrice ? Number(l.unitPrice).toFixed(2) : '') + '" placeholder="0.00"></td>' +
        '<td class="colrate" data-lbl="Discount"><input type="text" data-li="' + i + '" data-k="discount" value="' + (l.discount ? Number(l.discount).toFixed(2) : '') + '" placeholder="0.00"></td>' +
        '<td class="colamt num" data-lbl="Amount">' + moneyDollars(lineAmountDollars(l)) + '</td>' +
        '<td data-lbl="Direction"><label class="pill ' + (l.isRebate ? 'warn' : 'flat') + '" style="cursor:pointer">' +
          '<input type="checkbox" data-li="' + i + '" data-k="isRebate"' + (l.isRebate ? ' checked' : '') + ' style="width:auto;min-height:0;margin:0">Rebate</label></td>' +
        '<td class="coldel" data-lbl=""><button type="button" class="iconbtn" data-del="' + i + '" aria-label="Remove line ' + (i + 1) + '"><svg><use href="#i-trash"></use></svg></button></td></tr>';
    }).join('');

    var prefill = '<div class="card noprint"><div class="pad"><div class="grid gset">' +
      '<div class="field"><label>Prefill from customer</label><select id="edCust">' +
        '<option value="">— type it below instead —</option>' +
        customersCache.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === inv.customerId ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') +
      '</select><span class="help">Optional. Fills Bill to and Ship to; you can still type over them.</span></div>' +
      '<div class="field"><label>Prefill tax from warehouse</label><select id="edWh">' +
        '<option value="">— keep what I typed —</option>' +
        warehouses.map(function (w) { return '<option value="' + esc(w.id) + '"' + (w.id === inv.warehouseId ? ' selected' : '') + '>' + esc(w.name) + ' (' + esc(w.province || '') + ')</option>'; }).join('') +
      '</select><span class="help">Sets ships-from and the tax line.</span></div>' +
      '<div class="field"><label>Terms (days)</label><input type="number" id="edTerms" value="' + esc(inv.termsDays) + '" min="0"><span class="help">Due ' + esc(due) + '</span></div>' +
    '</div></div></div>';

    $('#editorBody').innerHTML = prefill +
      '<div class="sheet" style="margin-top:16px">' +
        '<div class="shhead">' +
          '<div><div class="shword">INVOICE</div>' +
            '<input type="text" data-co="name" value="' + esc(inv.companyInfo.name || '') + '" style="font-weight:700;margin-bottom:5px" placeholder="Company name">' +
            '<input type="text" data-co="bn" value="' + esc(inv.companyInfo.bn || '') + '" style="margin-bottom:4px" placeholder="Business number">' +
            '<input type="text" data-co="gst" value="' + esc(inv.companyInfo.gst || '') + '" placeholder="GST/HST registration"></div>' +
          '<div><input type="text" data-co="line1" value="' + esc(inv.companyInfo.line1 || '') + '" style="margin-bottom:4px" placeholder="Address line 1">' +
            '<input type="text" data-co="line2" value="' + esc(inv.companyInfo.line2 || '') + '" style="margin-bottom:4px" placeholder="Address line 2">' +
            '<input type="text" data-co="email" value="' + esc(inv.companyInfo.email || '') + '" style="margin-bottom:4px" placeholder="Email">' +
            '<input type="text" data-co="phone" value="' + esc(inv.companyInfo.phone || '') + '" placeholder="Phone"></div>' +
          '<div class="shlogo"><img src="assets/logo.png" alt="Greenwave Recycling Inc." style="width:150px;height:auto"></div>' +
        '</div>' +

        '<div class="shband">' +
          '<div><span class="shk">Bill to</span><textarea data-f="billTo" rows="4" placeholder="Company name&#10;Street&#10;City, province, postcode">' + esc(inv.billTo) + '</textarea></div>' +
          '<div><span class="shk">Ship to</span><textarea data-f="shipTo" rows="4" placeholder="Same as bill to, or somewhere else">' + esc(inv.shipTo) + '</textarea></div>' +
        '</div>' +

        '<div class="shband split">' +
          '<div><span class="shk">Reference</span>' +
            '<div class="grid" style="gap:8px">' +
              '<div class="field"><label>PO reference</label><input type="text" data-f="poReference" value="' + esc(inv.poReference) + '"></div>' +
              '<div class="field"><label>From</label><input type="text" value="' + esc(warehouseName(inv.warehouseId)) + '" readonly style="background:var(--panel-2)"></div>' +
            '</div></div>' +
          '<div><span class="shk">Invoice details</span>' +
            '<div class="grid" style="gap:8px">' +
              '<div class="field"><label>Invoice no.</label><input type="text" value="' + esc(inv.invoiceNumber || 'assigned on save') + '" readonly style="background:var(--panel-2)"></div>' +
              '<div class="field"><label>Invoice date</label><input type="date" data-f="invoiceDate" value="' + esc(inv.invoiceDate) + '"></div>' +
              '<div class="field"><label>Due date</label><input type="text" value="' + esc(due) + '" readonly style="background:var(--panel-2)"></div>' +
            '</div></div>' +
        '</div>' +

        '<div class="lines"><div class="tablewrap"><table><thead><tr>' +
          '<th>#</th><th>Description</th><th>Unit</th>' +
          '<th class="num">Qty</th><th class="num">Rate</th><th class="num">Discount</th><th class="num">Amount</th><th></th><th class="coldel"></th>' +
        '</tr></thead><tbody>' + lineRows + '</tbody></table></div>' +
        '<button type="button" class="btn ghost sm addline noprint" id="edAddLine"><svg><use href="#i-plus"></use></svg>Add line</button></div>' +

        '<div class="shfoot">' +
          '<div><span class="shk">Ways to pay</span><textarea data-f="notes" rows="3" placeholder="How you want to be paid">' + esc(inv.notes || ((inv.companyInfo.email || '') + '\n' + (inv.companyInfo.phone || ''))) + '</textarea></div>' +
          '<div class="totals">' +
            '<div class="trow"><span class="lb">Subtotal</span><span class="vl" id="tSub">' + moneyDollars(t.subtotal) + '</span></div>' +
            '<div class="trow" style="gap:8px"><input type="text" data-f="taxLabel" value="' + esc(inv.taxLabel) + '" style="flex:1" placeholder="GST @ 5%">' +
              '<input type="number" step="0.01" data-f="taxRatePct" value="' + esc(inv.taxRatePct) + '" style="width:82px" title="Rate as a percentage, e.g. 5 for 5%">' +
              '<span class="vl" id="tTax" style="min-width:86px;text-align:right">' + moneyDollars(t.tax) + '</span></div>' +
            '<div class="tgrand"><span class="lb" id="tLbl">' + (t.total < 0 ? 'Payable to customer' : 'Total') + '</span>' +
              '<span class="vl' + (t.total < 0 ? ' neg' : '') + '" id="tTot">' + moneyDollars(Math.abs(t.total)) + '</span></div>' +
          '</div>' +
        '</div>' +
      '</div>';

    wireEditor();
  }

  function wireEditor() {
    $('#edCust').addEventListener('change', function (e) {
      var c = customersCache.filter(function (x) { return x.id === e.target.value; })[0];
      if (!c) return;
      draft.customerId = c.id;
      draft.billTo = c.billTo || c.name;
      if (!draft.shipTo) draft.shipTo = c.shipTo || draft.billTo;
      renderEditor();
    });

    $('#edWh').addEventListener('change', function (e) {
      var w = warehouseById(e.target.value);
      if (!w) return;
      var t = taxFor(w.province);
      draft.warehouseId = w.id; draft.province = w.province;
      draft.taxLabel = t.label; draft.taxRatePct = t.rate * 100;
      renderEditor();
    });

    $('#edTerms').addEventListener('change', function (e) {
      draft.termsDays = parseInt(e.target.value, 10) || 0; renderEditor();
    });
    $('#edAddLine').addEventListener('click', function () { draft.items.push(blankLine()); renderEditor(); });

    $$('#editorBody [data-co]').forEach(function (el) {
      el.addEventListener('input', function () { draft.companyInfo[el.dataset.co] = el.value; });
    });

    $$('#editorBody [data-f]').forEach(function (el) {
      var evt = el.type === 'date' ? 'change' : 'input';
      el.addEventListener(evt, function () {
        var k = el.dataset.f;
        if (k === 'taxRatePct') { draft.taxRatePct = parseFloat(el.value) || 0; updateTotals(); }
        else if (k === 'invoiceDate') { draft.invoiceDate = el.value; renderEditor(); }
        else draft[k] = el.value;
      });
    });

    $$('#editorBody [data-li]').forEach(function (el) {
      var evt = (el.type === 'checkbox' || el.type === 'date') ? 'change' : 'input';
      el.addEventListener(evt, function () {
        var l = draft.items[Number(el.dataset.li)], k = el.dataset.k;
        if (k === 'isRebate') { l.isRebate = el.checked; renderEditor(); return; }
        if (k === 'quantity') l.quantity = parseQty(el.value);
        else if (k === 'unitPrice') l.unitPrice = parseDollars(el.value);
        else if (k === 'discount') l.discount = parseDollars(el.value);
        else l[k] = el.value;
        var row = el.closest('tr');
        if (row) row.querySelector('.colamt').textContent = moneyDollars(lineAmountDollars(l));
        updateTotals();
      });
    });

    $$('#editorBody [data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (draft.items.length === 1) { toast('An invoice needs at least one line.'); return; }
        draft.items.splice(Number(b.dataset.del), 1);
        renderEditor();
      });
    });
  }

  function updateTotals() {
    var t = totalsLocal(draft);
    $('#tSub').textContent = moneyDollars(t.subtotal);
    $('#tTax').textContent = moneyDollars(t.tax);
    $('#tLbl').textContent = t.total < 0 ? 'Payable to customer' : 'Total';
    var v = $('#tTot');
    v.textContent = moneyDollars(Math.abs(t.total));
    v.classList.toggle('neg', t.total < 0);
  }

  function saveInvoice() {
    if (!draft.billTo.trim()) { toast('Type who this is billed to.'); return; }
    var items = draft.items.filter(function (l) { return l.description || l.quantity || l.unitPrice; });
    if (!items.length) { toast('Add at least one line.'); return; }

    var payload = {
      invoiceDate: draft.invoiceDate,
      dueDate: addDays(draft.invoiceDate, draft.termsDays),
      customerId: draft.customerId || undefined,
      companyInfo: draft.companyInfo,
      billTo: draft.billTo, shipTo: draft.shipTo || undefined,
      poReference: draft.poReference || undefined,
      paymentTerms: 'Net ' + (draft.termsDays || 0) + ' days',
      taxLabel: draft.taxLabel || undefined,
      taxRate: Number(draft.taxRatePct) || 0,
      notes: draft.notes || undefined,
      warehouseId: draft.warehouseId || undefined,
      status: draft.status || 'draft',
      items: items.map(function (l) {
        return { description: l.description || '(no description)', quantity: Number(l.quantity) || 0, unit: l.unit || undefined,
          unitPrice: Number(l.unitPrice) || 0, discount: Number(l.discount) || 0, isRebate: !!l.isRebate };
      })
    };

    var btn = $('#edSave'); btn.disabled = true;
    var call = draft.id ? Api.updateInvoice(draft.id, payload) : Api.createInvoice(payload);
    call.then(function (saved) {
      draft = invoiceToDraft(saved);
      btn.disabled = false;
      toast('Invoice ' + saved.invoiceNumber + ' saved.');
      renderEditor();
    }).catch(function (err) {
      btn.disabled = false;
      toast(err.message || 'Could not save this invoice.');
    });
  }

  // ============================================================ CUSTOMERS
  function renderCustomers() {
    loadingState('#customerBody');
    Api.listCustomers().then(function (list) {
      customersCache = list;
      if (!list.length) {
        $('#customerBody').innerHTML = emptyState('users', 'No saved customers',
          'Saving a customer just prefills the invoice. You can always type the details straight onto the invoice instead.',
          'Add customer', 'newCustomer');
        return;
      }
      $('#customerBody').innerHTML = '<div class="card"><div class="tablewrap"><table><thead><tr>' +
        '<th>Name</th><th>Bill to</th><th>Email</th><th>Phone</th><th class="coldel"></th></tr></thead><tbody>' +
        list.map(function (c) {
          return '<tr><td><strong>' + esc(c.name) + '</strong></td><td style="color:var(--ink-2)">' +
            esc((c.billTo || '').split('\n')[0] || '—') + '</td><td style="color:var(--ink-2)">' +
            esc(c.email || '—') + '</td><td class="mono" style="font-size:13px">' + esc(c.phone || '—') + '</td>' +
            '<td><button type="button" class="btn ghost sm" data-editcust="' + esc(c.id) + '">Edit</button></td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<p style="margin:0;padding:14px 16px;color:var(--muted);font-size:13px">Customers can be edited but not deleted from here — ask an administrator if one needs to be removed.</p></div>';

      $$('[data-editcust]').forEach(function (b) {
        b.addEventListener('click', function () {
          var c = customersCache.filter(function (x) { return x.id === b.dataset.editcust; })[0];
          if (c) customerModal(c);
        });
      });
    }).catch(function (err) { apiErrorState('#customerBody', err); });
  }

  function customerModal(existing) {
    openModal(existing ? 'Edit customer' : 'Add customer',
      field('name', 'Company name', { required: true, value: existing ? existing.name : '' }) +
      field('billTo', 'Bill to (address)', { type: 'textarea', rows: 3, value: existing ? existing.billTo : '' }) +
      field('shipTo', 'Ship to (if different)', { type: 'textarea', rows: 3, value: existing ? existing.shipTo : '' }) +
      field('email', 'Email', { type: 'email', value: existing ? existing.email : '' }) +
      field('phone', 'Phone', { value: existing ? existing.phone : '' }),
      function (d) {
        if (!d.name) return;
        var payload = { name: d.name, billTo: d.billTo || undefined, shipTo: d.shipTo || undefined, email: d.email || undefined, phone: d.phone || undefined };
        if (!existing) payload.warehouseId = warehouseId || undefined;
        var call = existing ? Api.updateCustomer(existing.id, payload) : Api.createCustomer(payload);
        call.then(function () {
          closeModal(); render(); toast(existing ? 'Customer updated.' : 'Customer added.');
        }).catch(function (err) { toast(err.message || 'Could not save that customer.'); });
      });
  }

  // ============================================================ MATERIALS
  function renderProducts() {
    var rec = isRecycling();
    $('#prodTitle').textContent = rec ? 'Materials' : 'Products';
    $('#prodCta').textContent = rec ? 'Add material' : 'Add product';
    $('#prodSub').textContent = rec ? 'What you collect and sell, with the unit you weigh it in.' : 'What you import and distribute, with sizes if they have them.';

    loadingState('#productBody');
    Api.listMaterials(true).then(function (all) {
      var list = visibleMaterials(all);
      if (!list.length) {
        $('#productBody').innerHTML = emptyState('tag', rec ? 'No materials yet' : 'No products yet',
          rec ? 'Add what you handle — cardboard, copper, aluminium. Each carries its own unit and default rate.'
              : 'Add what you distribute. Sizes break inventory out into XL/L/M/S like your spreadsheet.',
          rec ? 'Add material' : 'Add product', 'newProduct');
        return;
      }
      $('#productBody').innerHTML = '<div class="card"><div class="tablewrap"><table><thead><tr>' +
        '<th>Name</th><th>Category</th><th>Unit</th><th>Captured by</th><th class="num">Default rate</th><th>Status</th><th class="coldel"></th>' +
        '</tr></thead><tbody>' + list.map(function (m) {
        var cap = materialCapture(m);
        var capLabel = cap === 'sized' ? 'XL/L/M/S' : cap === 'weighed' ? 'Scale' : 'Count';
        return '<tr><td><strong>' + esc(m.name) + '</strong></td><td style="color:var(--muted)">' + esc(m.category || '—') + '</td>' +
          '<td>' + esc(m.unit) + '</td><td><span class="pill flat">' + capLabel + '</span></td>' +
          '<td class="num">' + (m.defaultPrice != null ? moneyDollars(m.defaultPrice) : '—') + '</td>' +
          '<td>' + (m.active ? '<span class="pill good">Active</span>' : '<span class="pill crit">Archived</span>') + '</td>' +
          '<td style="display:flex;gap:6px"><button type="button" class="btn ghost sm" data-editprod="' + esc(m.id) + '">Edit</button>' +
          '<button type="button" class="btn ghost sm" data-archiveprod="' + esc(m.id) + '">' + (m.active ? 'Archive' : 'Reactivate') + '</button></td></tr>';
      }).join('') + '</tbody></table></div></div>';

      $$('[data-editprod]').forEach(function (b) {
        b.addEventListener('click', function () {
          var m = list.filter(function (x) { return x.id === b.dataset.editprod; })[0];
          if (m) productModal(m);
        });
      });
      $$('[data-archiveprod]').forEach(function (b) {
        b.addEventListener('click', function () {
          var m = list.filter(function (x) { return x.id === b.dataset.archiveprod; })[0];
          if (!m) return;
          Api.updateMaterial(m.id, { active: !m.active }).then(function () { render(); toast(m.active ? 'Archived.' : 'Reactivated.'); })
            .catch(function (err) { toast(err.message || 'Could not update that.'); });
        });
      });
    }).catch(function (err) { apiErrorState('#productBody', err); });
  }

  function productModal(existing) {
    var rec = isRecycling();
    var meta = existing ? materialMeta(existing) : {};
    openModal(existing ? (rec ? 'Edit material' : 'Edit product') : (rec ? 'Add material' : 'Add product'),
      field('name', 'Name', { required: true, value: existing ? existing.name : '', placeholder: rec ? 'OCC Cardboard' : 'Synguard 100' }) +
      field('category', 'Category', { value: existing ? existing.category : '', placeholder: rec ? 'Paper' : 'Gloves' }) +
      field('unit', 'Unit', { value: existing ? existing.unit : (rec ? 'kg' : 'cases'), help: 'kg, tonne, cases, each.' }) +
      field('capture', 'Captured by', { type: 'select', value: meta.capture || (rec ? 'weighed' : 'sized'),
        options: [{ value: 'weighed', label: 'Scale — gross and tare' }, { value: 'sized', label: 'Sizes — XL / L / M / S' }, { value: 'counted', label: 'Count — a single quantity' }] }) +
      field('rate', 'Default rate', { value: existing && existing.defaultPrice != null ? Number(existing.defaultPrice) : '', placeholder: '140.00', help: 'Per unit, in dollars.' }),
      function (d) {
        if (!d.name) return;
        var payload = { name: d.name, category: d.category || undefined, unit: d.unit || undefined, defaultPrice: d.rate ? parseDollars(d.rate) : undefined };
        var call = existing ? Api.updateMaterial(existing.id, payload) : Api.createMaterial(payload);
        call.then(function (saved) {
          S.setMaterialMeta(saved.id, { entity: entity, capture: d.capture });
          closeModal(); render(); toast(existing ? 'Updated.' : 'Added.');
        }).catch(function (err) { toast(err.message || 'Could not save that.'); });
      });
  }

  // ============================================================ STAFF
  function renderStaff() {
    loadingState('#staffBody');
    Api.listUsers().then(function (list) {
      usersCache = list;
      $('#staffBody').innerHTML = '<div class="card"><div class="tablewrap"><table><thead><tr>' +
        '<th>Name</th><th>Email</th><th>Role</th><th class="coldel"></th></tr></thead><tbody>' +
        list.map(function (u) {
          var isMe = me && u.id === me.id;
          return '<tr><td><strong>' + esc(u.fullName) + '</strong>' + (isMe ? ' <span class="pill flat">you</span>' : '') + '</td>' +
            '<td class="mono" style="font-size:13px">' + esc(u.email) + '</td>' +
            '<td>' + esc((ROLES[u.role] || {}).label || u.role) + '</td>' +
            '<td><button type="button" class="btn ghost sm" data-editstaff="' + esc(u.id) + '">Edit</button></td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<p style="margin:0;padding:14px 16px;color:var(--muted);font-size:13px">Accounts are created and edited here directly against the server — passwords are never shown or stored in the browser. Deactivating an account isn\'t available from the server yet.</p></div>';

      $$('[data-editstaff]').forEach(function (b) {
        b.addEventListener('click', function () {
          var u = list.filter(function (x) { return x.id === Number(b.dataset.editstaff); })[0];
          if (u) staffModal(u);
        });
      });
    }).catch(function (err) { apiErrorState('#staffBody', err); });
  }

  function staffModal(existing) {
    var isSelf = !!(existing && me && existing.id === me.id);
    openModal(existing ? 'Edit staff' : 'Add staff',
      field('name', 'Full name', { required: true, value: existing ? existing.fullName : '' }) +
      field('email', 'Work email', { type: 'email', required: true, value: existing ? existing.email : '' }) +
      (existing ? '' : field('password', 'Temporary password', { type: 'password', required: true, help: 'At least 8 characters, with upper, lower and a number.' })) +
      field('role', 'Role', { type: 'select', value: existing ? existing.role : 'staff', disabled: isSelf, options: [
        { value: 'staff', label: 'Staff — stock, photos, own hours' },
        { value: 'manager', label: 'Manager — everything except staff and settings' },
        { value: 'admin', label: 'Administrator — full access' }] }) +
      (isSelf ? '<p class="help" style="margin-top:-8px">You can\'t change your own role.</p>' : ''),
      function (d) {
        if (!d.name || !d.email) return;
        if (existing) {
          var patch = { fullName: d.name, email: d.email };
          if (!isSelf) patch.role = d.role;
          Api.updateUser(existing.id, patch).then(function () { closeModal(); render(); toast('Updated.'); })
            .catch(function (err) { toast(err.message || 'Could not update that account.'); });
        } else {
          if (!d.password) { toast('Set a temporary password.'); return; }
          Api.createUser({ fullName: d.name, email: d.email, password: d.password, role: d.role }).then(function () {
            closeModal(); render(); toast(d.name + ' can now sign in.');
          }).catch(function (err) { toast(err.message || 'Could not create that account.'); });
        }
      });
  }

  // ============================================================ HISTORY
  function renderHistory() {
    loadingState('#historyBody');
    loadUsersCache().then(function () {
      return Api.listAudit({ limit: 200 });
    }).then(function (res) {
      var items = (res && res.items) || [];
      if (!items.length) { $('#historyBody').innerHTML = emptyState('history', 'Nothing recorded yet', 'Every action anyone takes shows up here.'); return; }

      $('#historyBody').innerHTML = '<div class="card">' + items.map(function (a) {
        var who = a.actorUserId != null ? userName(a.actorUserId) : 'System';
        return '<div class="histrow"><span class="histwhen">' + esc(when(a.occurredAt)) + '</span>' +
          '<span class="histwho">' + esc(who) + '</span>' +
          '<span class="histwhat">' + esc(a.summary || a.action) + '</span></div>';
      }).join('') + '</div>' +
      (res.total > items.length ? '<p style="color:var(--muted);font-size:13px;margin-top:12px">Showing the ' + items.length + ' most recent of ' + res.total + '.</p>' : '');
    }).catch(function (err) { apiErrorState('#historyBody', err); });
  }

  // ============================================================ SETTINGS
  function renderSettings() {
    var co = db.company;
    $('#settingsBody').innerHTML =
      '<div class="card"><div class="cardhead"><h3>Company</h3><span class="sub">Prefills every new invoice (local to this device)</span></div>' +
      '<div class="pad"><div class="grid g2" id="coFields">' +
        field('name', 'Legal name', { value: co.name }) + field('line1', 'Address line 1', { value: co.line1 }) +
        field('line2', 'Address line 2', { value: co.line2 }) + field('email', 'Email', { value: co.email }) +
        field('phone', 'Phone', { value: co.phone }) + field('bn', 'Business number', { value: co.bn }) +
        field('gst', 'GST/HST registration', { value: co.gst }) +
      '</div><button type="button" class="btn" id="saveCo" style="margin-top:16px">Save company details</button></div></div>' +

      '<div class="card"><div class="cardhead"><h3>Warehouses</h3>' +
        '<button type="button" class="btn ghost sm" id="addWh"><svg><use href="#i-plus"></use></svg>Add</button></div>' +
      '<div id="whBody"><div class="pad" style="text-align:center;color:var(--muted)">Loading…</div></div>' +
      '<div class="pad" style="padding-top:0"><div class="note" style="margin-top:14px"><svg><use href="#i-alert"></use></svg><div>' +
      '<b>BC PST is not applied.</b> Only GST and HST. Whether PST applies to recyclable material sold for reprocessing is a question for your accountant — ' +
      'and every invoice lets you type the tax label and rate directly if a job needs something different.</div></div></div></div>' +

      '<div class="card"><div class="cardhead"><h3>Local preferences</h3><span class="sub">This browser only</span></div>' +
      '<div class="pad"><p style="margin:0 0 14px;color:var(--ink-2);font-size:14px;max-width:64ch">' +
      'Invoices, inventory, customers, materials, staff, photos and history all live on the GreenWave server now — clearing this browser\'s data does not lose any of them. ' +
      'This backup only covers your company letterhead defaults and which company/warehouse you last had open.</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<button type="button" class="btn ghost" id="exportData">Export backup (.json)</button>' +
      '<button type="button" class="btn ghost" id="importData">Import backup</button>' +
      '<button type="button" class="btn danger" id="wipeData">Reset local preferences</button></div>' +
      '<input type="file" id="importFile" accept="application/json" hidden></div></div>';

    $('#saveCo').addEventListener('click', function () {
      $$('#coFields [name]').forEach(function (el) { db.company[el.name] = el.value.trim(); });
      S.save(); toast('Saved.');
    });

    renderWarehousesTable();

    $('#addWh').addEventListener('click', function () { warehouseModal(); });

    $('#exportData').addEventListener('click', function () {
      var blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'greenwave-local-prefs-' + today() + '.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      toast('Backup downloaded.');
    });

    $('#importData').addEventListener('click', function () { $('#importFile').click(); });
    $('#importFile').addEventListener('change', function (e) {
      var f = e.target.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          var next = JSON.parse(r.result);
          if (!next || !next.company) throw new Error('bad');
          db = S.replace ? S.replace(next) : next;
          render(); toast('Backup restored.');
        } catch (err) { toast("That file isn't a Greenwave preferences backup."); }
      };
      r.readAsText(f); e.target.value = '';
    });

    $('#wipeData').addEventListener('click', function () {
      if (!confirm('Reset company letterhead defaults and local preferences on this device?\n\nThis does not touch anything on the server.')) return;
      var session = { session: db.session, serverUser: db.serverUser };
      db = S.reset();
      db.session = session.session; db.serverUser = session.serverUser; S.save();
      render(); toast('Local preferences reset.');
    });
  }

  function renderWarehousesTable() {
    var host = $('#whBody'); if (!host) return;
    Api.listWarehouses(true).then(function (list) {
      warehouses = warehouses.length ? warehouses : list; // keep the app usable even if this call races boot's
      host.innerHTML = '<div class="tablewrap"><table><thead><tr><th>Name</th><th>Code</th><th>Province</th><th>Sales tax</th><th>Status</th><th class="coldel"></th></tr></thead><tbody>' +
        list.map(function (w) {
          return '<tr><td><strong>' + esc(w.name) + '</strong></td><td class="mono">' + esc(w.code) + '</td><td>' + esc(w.province || '—') + '</td>' +
            '<td style="color:var(--ink-2)">' + esc(taxFor(w.province).label) + '</td>' +
            '<td>' + (w.active ? '<span class="pill good">Active</span>' : '<span class="pill crit">Archived</span>') + '</td>' +
            '<td style="display:flex;gap:6px"><button type="button" class="btn ghost sm" data-editwh="' + esc(w.id) + '">Edit</button>' +
            '<button type="button" class="btn ghost sm" data-archivewh="' + esc(w.id) + '">' + (w.active ? 'Archive' : 'Reactivate') + '</button></td></tr>';
        }).join('') + '</tbody></table></div>';

      $$('[data-editwh]').forEach(function (b) {
        b.addEventListener('click', function () {
          var w = list.filter(function (x) { return x.id === b.dataset.editwh; })[0];
          if (w) warehouseModal(w);
        });
      });
      $$('[data-archivewh]').forEach(function (b) {
        b.addEventListener('click', function () {
          var w = list.filter(function (x) { return x.id === b.dataset.archivewh; })[0];
          if (!w) return;
          Api.updateWarehouse(w.id, { active: !w.active }).then(function () {
            return Api.listWarehouses().then(function (active) { warehouses = active; syncChrome(); });
          }).then(function () { renderWarehousesTable(); toast(w.active ? 'Archived.' : 'Reactivated.'); })
            .catch(function (err) { toast(err.message || 'Could not update that warehouse.'); });
        });
      });
    }).catch(function (err) { apiErrorState('#whBody', err); });
  }

  function warehouseModal(existing) {
    openModal(existing ? 'Edit warehouse' : 'Add warehouse',
      field('name', 'Name', { required: true, value: existing ? existing.name : '', placeholder: 'Mississauga, ON' }) +
      field('code', 'Short code', { required: true, value: existing ? existing.code : '', placeholder: 'MISS', help: 'Unique, used internally.' }) +
      field('province', 'Province', { type: 'select', value: existing ? existing.province : 'ON',
        options: PROVINCES.map(function (p) { return { value: p, label: p + ' — ' + TAX[p].label }; }) }) +
      field('address', 'Address', { value: existing ? existing.address : '' }),
      function (d) {
        if (!d.name || !d.code) return;
        var payload = { name: d.name, code: d.code, province: d.province, address: d.address || undefined };
        var call = existing ? Api.updateWarehouse(existing.id, payload) : Api.createWarehouse(payload);
        call.then(function () {
          return Api.listWarehouses().then(function (active) { warehouses = active; syncChrome(); });
        }).then(function () { closeModal(); renderWarehousesTable(); toast(existing ? 'Updated.' : 'Added.'); })
          .catch(function (err) { toast(err.message || 'Could not save that warehouse.'); });
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
    var f = $('#modalForm input:not([disabled]), #modalForm select:not([disabled]), #modalForm textarea:not([disabled])');
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
  $('#wh').addEventListener('change', function (e) {
    warehouseId = e.target.value; db.lastWarehouseId = warehouseId; S.save();
    syncChrome(); refreshShiftChip(); render();
  });
  $('#menuBtn').addEventListener('click', function () { $('#app').classList.toggle('menu-open'); });
  $('#signOut').addEventListener('click', signOut);
  $('#newInvoice').addEventListener('click', function () {
    draft = newDraft();
    (customersCache.length ? Promise.resolve(customersCache) : Api.listCustomers().then(function (l) { customersCache = l; return l; }).catch(function () { return []; }))
      .then(function () { show('editor'); });
  });
  $('#newCustomer').addEventListener('click', function () { customerModal(); });
  $('#newProduct').addEventListener('click', function () { productModal(); });
  $('#newStaff').addEventListener('click', function () { staffModal(); });
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
      var inv = invoiceListCache.filter(function (i) { return i.id === el.dataset.invoice; })[0] || null;
      if (inv) {
        draft = invoiceToDraft(inv);
        (customersCache.length ? Promise.resolve() : Api.listCustomers().then(function (l) { customersCache = l; }).catch(function () {}))
          .then(function () { show('editor'); });
      }
      return;
    }
    e.preventDefault();
    var a = el.dataset.action;
    if (a === 'newInvoice') { $('#newInvoice').click(); }
    else if (a === 'newCustomer') customerModal();
    else if (a === 'newProduct') productModal();
    else if (a === 'newStaff') staffModal();
    else if (a === 'goProducts') show('products');
    else if (a === 'addPhoto') $('#photoFile').click();
  });

  // ============================================================ BOOT
  function showBootError(err) {
    var msg = (err && err.status === 0) ? "Can't reach the GreenWave server. Check your connection and try again."
      : (err && err.message) || 'Something went wrong starting the app.';
    $('#scroll').innerHTML = '<div class="card" style="margin:24px"><div class="empty">' +
      '<span class="eico"><svg><use href="#i-alert"></use></svg></span>' +
      '<h3>Could not start Greenwave Ops</h3><p>' + esc(msg) + '</p>' +
      '<button type="button" class="btn" id="bootRetry">Try again</button></div></div>';
    var b = $('#bootRetry'); if (b) b.addEventListener('click', boot);
  }

  function boot() {
    try {
      db = S.get();
      me = S.me();
      // The JWT lives in sessionStorage and is gone once the tab closes,
      // even though db.session (localStorage) would still say 'server' —
      // don't show the app as signed in with no working session behind it.
      if (!me || !me.active || !Api.isAuthenticated()) {
        S.clearSession();
        showGate();
        return;
      }
      $('#gate').hidden = true;
      $('#app').hidden = false;
      usersCache = null;
      loadUsersCache();

      Api.listWarehouses().then(function (list) {
        warehouses = list;
        if (!warehouses.length) throw { message: 'No warehouses are set up on the server yet. Ask an administrator to add one.' };
        warehouseId = (db.lastWarehouseId && warehouses.some(function (w) { return w.id === db.lastWarehouseId; }))
          ? db.lastWarehouseId : warehouses[0].id;
        syncChrome();
        return refreshShiftChip();
      }).then(function () {
        show(can('invoices') && isRecycling() ? 'invoices' : 'inventory');
      }).catch(function (err) {
        showBootError(err);
      });
    } catch (err) {
      console.error('GreenWave boot initialization error:', err);
      showGate();
    }
  }

  boot();

  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* offline caching is a bonus, not a requirement */ });
  }
})();
