/* ==========================================================================
   GreenWave Operations Platform - V2 Client Application

   Server-authoritative frontend for GreenWave Recycling & Healthcare.
   All business entities (inventory ledger, containers, chat, invoices,
   photos, timesheets, customers, materials, staff, audit) are backed by
   PostgreSQL, Redis, and MinIO.
   ========================================================================== */
(function (global) {
  'use strict';

  var S = window.Store;
  var Api = window.GreenwaveApi;

  // Sales tax by province goods ship from
  var TAX = {
    AB: { label: 'GST @ 5%',  rate: 0.05 },
    BC: { label: 'GST @ 5%',  rate: 0.05 },
    SK: { label: 'GST @ 5%',  rate: 0.05 },
    MB: { label: 'GST @ 5%',  rate: 0.05 },
    QC: { label: 'GST @ 5%',  rate: 0.05 },
    ON: { label: 'HST @ 13%', rate: 0.13 },
    NS: { label: 'HST @ 15%', rate: 0.15 },
    NB: { label: 'HST @ 15%', rate: 0.15 },
    NL: { label: 'HST @ 15%', rate: 0.15 },
    PE: { label: 'HST @ 15%', rate: 0.15 }
  };

  var ROLES = {
    admin:   { label: 'Administrator', sees: ['dashboard','inventory','photos','timeclock','chat','invoices','editor','customers','products','staff','history','settings'] },
    manager: { label: 'Manager',       sees: ['dashboard','inventory','photos','timeclock','chat','invoices','editor','customers','products','history'] },
    staff:   { label: 'Staff',         sees: ['dashboard','inventory','photos','timeclock','chat'] },
    driver:  { label: 'Driver',        sees: ['dashboard','inventory','photos','timeclock','chat'] }
  };

  var SIZE_KEYS = ['xl', 'l', 'm', 's'];
  var SIZE_LABELS = { xl: 'XL', l: 'L', m: 'M', s: 'S' };

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
  function parseQty(s) { var n = parseFloat(String(s).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; }
  function num(n, dp) {
    return Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: dp || 0, maximumFractionDigits: dp === undefined ? 3 : dp });
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  function ddmmyyyy(input) {
    if (!input) return '';
    var d = (input instanceof Date) ? input : new Date(input);
    if (isNaN(d.getTime())) return '';
    var dd = String(d.getDate()).padStart(2, '0');
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    return dd + '/' + mm + '/' + d.getFullYear();
  }
  function paymentStatusMeta(status) {
    var s = String(status || 'unpaid').toLowerCase();
    if (s === 'paid') return { label: 'PAID', cls: 'badge-paid' };
    if (s === 'pending') return { label: 'PAYMENT PENDING', cls: 'badge-pending' };
    if (s === 'failed') return { label: 'PAYMENT FAILED', cls: 'badge-failed' };
    if (s === 'refunded') return { label: 'REFUNDED', cls: 'badge-refunded' };
    return { label: 'PAYMENT DUE', cls: 'badge-unpaid' };
  }
  function initials(name) {
    var p = String(name || '?').trim().split(/\s+/);
    return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  }
  function when(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.toLocaleDateString('en-CA') + ' ' + d.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' });
  }
  function friendlyTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    var now = new Date();
    var diffMs = now.getTime() - d.getTime();
    var diffSec = Math.floor(diffMs / 1000);
    var diffMin = Math.floor(diffSec / 60);
    var diffHours = Math.floor(diffMin / 60);

    if (diffSec < 45) return 'Just now';
    if (diffMin < 60) return diffMin + 'm ago';
    if (diffHours < 24 && d.getDate() === now.getDate()) {
      return 'Today ' + d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', hour12: true });
    }
    var yesterday = new Date(now.getTime() - 864e5);
    if (d.getDate() === yesterday.getDate() && d.getMonth() === yesterday.getMonth() && d.getFullYear() === yesterday.getFullYear()) {
      return 'Yesterday ' + d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', hour12: true });
    }
    return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  }
  function hm(ms) {
    var m = Math.max(0, Math.floor(ms / 60000)), h = Math.floor(m / 60);
    return h + 'h ' + String(m % 60).padStart(2, '0') + 'm';
  }
  function hms(ms) {
    var s = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(s / 60), h = Math.floor(m / 60);
    return h + 'h ' + String(m % 60).padStart(2, '0') + 'm ' + String(s % 60).padStart(2, '0') + 's';
  }
  function bytes(n) {
    if (n > 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n > 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  }

  function deduplicateWarehouses(list) {
    if (!Array.isArray(list)) return [];
    var seen = {};
    var result = [];
    list.forEach(function (w) {
      if (!w || !w.id) return;
      var normName = (w.name || '').trim().toLowerCase();
      var key = normName || w.id;
      if (!seen[key]) {
        seen[key] = true;
        result.push(w);
      }
    });
    return result;
  }

  function toast(msg) {
    var t = $('#toast');
    if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, 2800);
  }

  function emptyState(icon, title, body, cta, action) {
    return '<div class="card"><div class="empty">' +
      '<span class="eico"><svg><use href="#i-' + icon + '"></use></svg></span>' +
      '<h3>' + esc(title) + '</h3><p>' + body + '</p>' +
      (cta ? '<button type="button" class="btn btn-primary" data-action="' + action + '"><svg><use href="#i-plus"></use></svg>' + esc(cta) + '</button>' : '') +
      '</div></div>';
  }

  function loadingState(sel) {
    var el = $(sel);
    if (el) el.innerHTML = '<div class="card"><div class="pad" style="text-align:center;color:var(--muted)">Loading…</div></div>';
  }

  function apiErrorState(sel, err) {
    var el = $(sel);
    if (!el) return;
    var msg = (err && err.status === 0) ? (err.message || 'Unable to connect to GreenWave services.')
      : (err && err.status === 403) ? "You do not have permission to access this resource."
      : (err && err.message) || 'Something went wrong loading this view.';
    el.innerHTML = '<div class="card"><div class="empty">' +
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
    var id = 'f-' + name;
    if (o.type === 'select') {
      input = '<select id="' + id + '" name="' + name + '"' + (o.required ? ' required' : '') + (o.disabled ? ' disabled' : '') + '>' + o.options.map(function (x) {
        return '<option value="' + esc(x.value) + '"' + (String(x.value) === String(v) ? ' selected' : '') + '>' + esc(x.label) + '</option>';
      }).join('') + '</select>';
    } else if (o.type === 'textarea') {
      input = '<textarea id="' + id + '" name="' + name + '" rows="' + (o.rows || 3) + '"' + (o.required ? ' required' : '') + ' placeholder="' + esc(o.placeholder || '') + '">' + esc(v) + '</textarea>';
    } else {
      input = '<input id="' + id + '" type="' + (o.type || 'text') + '" name="' + name + '" value="' + esc(v) + '"' +
        (o.required ? ' required' : '') + (o.step ? ' step="' + o.step + '"' : '') +
        (o.min != null ? ' min="' + o.min + '"' : '') + (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') +
        (o.autocomplete ? ' autocomplete="' + esc(o.autocomplete) + '"' : '') + (o.readonly ? ' readonly' : '') + '>';
    }
    return '<div class="field"><label for="' + id + '">' + esc(label) + (o.help ? ' <span style="font-weight:400;color:var(--muted)">(' + esc(o.help) + ')</span>' : '') + '</label>' + input + '</div>';
  }

  var db = S.get();
  var me = null;
  var view = 'dashboard';
  var entity = db.entity || 'recycling';
  var warehouseId = S.getWarehouse();
  var warehouses = [];
  var usersCache = null;
  var currentShiftCache = null;
  var clockTimer = null;
  var draft = null;
  var editorViewMode = false;
  var invoiceListCache = [];

  var chatMessages = [];
  var chatSseSource = null;
  var chatPollTimer = null;
  var chatOnlineTimer = null;

  var invenTab = 'balances';
  var invenSearchQuery = '';
  var invenProductFilter = '';
  var inventoryBalancesCache = [];
  var inventoryTransactionsCache = [];
  var inventoryContainersCache = [];

  var histTab = 'transactions';
  var histSearchQuery = '';
  var histFacilityFilter = '';
  var histDivisionFilter = '';
  var histTypeFilter = '';
  var histProductFilter = '';
  var histRecordedByFilter = '';
  var histStartDate = '';
  var histEndDate = '';

  function isRecycling() { return entity === 'recycling'; }
  function isHealthcare() { return entity === 'healthcare'; }
  function isAdmin() { return me && me.role === 'admin'; }
  function isAdminOrManager() { return me && (me.role === 'admin' || me.role === 'manager'); }
  function can(v) {
    if (!me) return false;
    var def = ROLES[me.role];
    return def ? def.sees.indexOf(v) >= 0 : false;
  }

  function warehouse() {
    return warehouses.filter(function (w) { return w.id === warehouseId; })[0] || warehouses[0] || null;
  }
  function warehouseById(id) {
    return warehouses.filter(function (w) { return w.id === id; })[0] || null;
  }
  function warehouseName(id) {
    var w = warehouseById(id);
    return w ? w.name : (id ? 'Warehouse ' + String(id).slice(0, 6) : '—');
  }
  function taxFor(prov) { return TAX[prov] || TAX.BC; }

  function materialCapture(m) {
    var u = (m && m.unit ? m.unit : '').toLowerCase();
    if (u === 'cases' || u === 'box' || u === 'pcs' || isHealthcare()) return 'sized';
    if (u === 'kg' || u === 'lbs' || u === 't' || u === 'ton' || u === 'tonne') return 'weighed';
    return 'counted';
  }

  function loadUsersCache() {
    if (usersCache) return Promise.resolve(usersCache);
    if (!isAdminOrManager()) return Promise.resolve([]);
    return Api.listUsers().then(function (users) {
      usersCache = users;
      return users;
    }).catch(function () { return []; });
  }
  function userName(id) {
    if (me && me.id === id) return me.name;
    if (usersCache) {
      var u = usersCache.filter(function (x) { return x.id === id; })[0];
      if (u) return u.name || u.fullName || u.email;
    }
    return id ? 'Staff #' + id : '—';
  }

  function gateError(msgEl, text) {
    if (!msgEl) return;
    msgEl.innerHTML = '<div class="gateerr" role="alert"><svg><use href="#i-alert"></use></svg><div>' + text + '</div></div>';
  }

  function setupSignIn() {
    var form = $('#signForm');
    if (!form) return;

    var toggleBtn = $('#togglePasswordBtn');
    var pwInput = $('#gatePassword');
    if (toggleBtn && pwInput) {
      toggleBtn.addEventListener('click', function () {
        if (pwInput.type === 'password') {
          pwInput.type = 'text';
          toggleBtn.textContent = 'Hide';
        } else {
          pwInput.type = 'password';
          toggleBtn.textContent = 'Show';
        }
      });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var emailEl = $('#gateEmail');
      var pwEl = $('#gatePassword');
      var email = emailEl ? emailEl.value.trim() : '';
      var password = pwEl ? pwEl.value : '';
      var msg = $('#gateMsg');
      var btn = $('#signSubmit');

      if (!email || !password) return;
      if (msg) msg.innerHTML = '';
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Signing In…';
      }

      Api.login(email, password).then(function (user) {
        S.setServerSession(user);
        db = S.get();
        boot();
      }).catch(function (err) {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Sign In';
        }
        if (err.status === 401) {
          gateError(msg, '<b>Email or password is incorrect.</b><br>Please check both and try again.');
        } else if (err.status === 429) {
          gateError(msg, '<b>Too many login attempts.</b><br>Please wait a moment and try again.');
        } else if (err.status === 0) {
          gateError(msg, '<b>Unable to connect to GreenWave services.</b><br>Please check your connection and try again.');
        } else {
          gateError(msg, '<b>Sign-in failed.</b><br>' + esc(err.message || 'Please try again.'));
        }
      });
    });
  }

  function showGate() {
    var app = $('#app');
    if (app) app.hidden = true;
    var gate = $('#gate');
    if (gate) gate.hidden = false;
    var pw = $('#gatePassword');
    if (pw) pw.value = '';
    var msg = $('#gateMsg');
    if (msg) msg.innerHTML = '';
    var btn = $('#signSubmit');
    if (btn) { btn.disabled = false; btn.textContent = 'Sign In'; }
  }

  function signOut() {
    if (currentShiftCache && !confirm('You are still clocked in. Sign out anyway?\n\nYour shift stays open on the server.')) return;
    if (chatSseSource) { chatSseSource.close(); chatSseSource = null; }
    if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; }
    if (chatOnlineTimer) { clearInterval(chatOnlineTimer); chatOnlineTimer = null; }
    Api.clearSession();
    S.clearSession();
    me = null;
    if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
    showGate();
  }

  function syncChrome() {
    document.documentElement.setAttribute('data-entity', entity);
    $$('.entsw button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.entity === entity)); });
    $$('.top-div-btn').forEach(function (b) {
      var isAct = (b.dataset.entity || b.dataset.div) === entity;
      b.classList.toggle('active', isAct);
      b.setAttribute('aria-pressed', String(isAct));
    });

    var scopeFac = $('#scopeFacilityName');
    if (scopeFac) scopeFac.textContent = (warehouse() || {}).name || '—';
    var scopeDiv = $('#scopeDivisionUnit');
    if (scopeDiv) scopeDiv.textContent = isRecycling() ? 'Recycling · Pallets' : 'Healthcare · Boxes';

    $$('[data-only], [data-role]').forEach(function (el) {
      var okEntity = !el.dataset.only || el.dataset.only === entity;
      var okRole = !el.dataset.role || (me && el.dataset.role.split(',').indexOf(me.role) >= 0);
      el.hidden = !(okEntity && okRole);
    });

    var prodEl = $('#productsNav');
    if (prodEl) prodEl.textContent = isRecycling() ? 'Materials Catalog' : 'Healthcare Products';

    var inBtn = $('#btnReceiveStock');
    if (inBtn) inBtn.innerHTML = '<svg><use href="#i-plus"></use></svg>Inbound';
    var outBtn = $('#btnShipStock');
    if (outBtn) outBtn.innerHTML = '<svg><use href="#i-truck"></use></svg>Outbound';
    var invSub = $('#invenSub');
    if (invSub) invSub.textContent = isRecycling() ? 'Recycling Division — Pallet inventory balances, container tracking, and transaction ledger.' : 'Healthcare Division — Box inventory balances, container tracking, and transaction ledger.';
    var prodTitle = $('#prodTitle');
    if (prodTitle) prodTitle.textContent = isRecycling() ? 'Materials Catalog' : 'Healthcare Products';

    var meInitialsEl = $('#meInitials');
    if (meInitialsEl) meInitialsEl.textContent = me ? initials(me.name) : '';
    var meNameEl = $('#meName');
    if (meNameEl) meNameEl.textContent = me ? me.name : '';
    var meRoleEl = $('#meRole');
    if (meRoleEl) meRoleEl.textContent = me ? ((ROLES[me.role] || {}).label || me.role) : '';

    var whWrap = $('.wh');
    if (whWrap) {
      var displayWarehouses = deduplicateWarehouses(warehouses);
      if (!displayWarehouses || displayWarehouses.length === 0) {
        whWrap.innerHTML = '<label>FACILITY</label><div class="wh-readonly-chip wh-unassigned" title="No assigned warehouse"><span class="wh-pin">⚠️</span> No warehouse assigned. Contact administrator.</div>';
      } else if (displayWarehouses.length === 1) {
        warehouseId = displayWarehouses[0].id;
        S.setWarehouse(warehouseId);
        whWrap.innerHTML = '<label>FACILITY (ASSIGNED)</label><div class="wh-readonly-chip" title="Assigned Facility"><span class="wh-pin">📍</span> ' + esc(displayWarehouses[0].name) + '</div>';
      } else {
        if (!displayWarehouses.some(function (w) { return w.id === warehouseId; })) {
          warehouseId = displayWarehouses[0].id;
          S.setWarehouse(warehouseId);
        }
        whWrap.innerHTML = '<label for="wh">FACILITY</label><div class="wh-select-wrap"><select id="wh" aria-label="Selected Warehouse">' +
          displayWarehouses.map(function (w) {
            return '<option value="' + esc(w.id) + '"' + (w.id === warehouseId ? ' selected' : '') + '>' + esc(w.name) + '</option>';
          }).join('') +
          '</select></div>';
        var sel = $('#wh');
        if (sel) {
          sel.value = warehouseId;
          sel.onchange = function (e) {
            warehouseId = e.target.value;
            S.setWarehouse(warehouseId);
            syncChrome();
            render();
          };
        }
      }
    }

    var taxNoteEl = $('#taxNote');
    if (taxNoteEl) taxNoteEl.textContent = '';

    renderTabbar();
    renderShiftChip();
  }

  function renderTabbar() {
    var items = [
      { v: 'dashboard', i: 'grid',  l: 'Home' },
      { v: 'inventory', i: 'box',   l: 'Inventory' },
      { v: 'chat',      i: 'chat',  l: 'Chat' },
      { v: 'invoices',  i: 'doc',   l: 'Invoices' },
      { v: 'photos',    i: 'cam',   l: 'Photos' },
      { v: 'timeclock', i: 'clock', l: 'Clock' }
    ].filter(function (x) {
      if (x.v === 'invoices') return can('invoices') && isRecycling();
      return can(x.v);
    });

    var tabbar = $('#tabbar');
    if (!tabbar) return;

    tabbar.innerHTML = items.map(function (x) {
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
    if (!chip) return;
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
    if (!can(next) && next !== 'editor') next = 'dashboard';
    if (next === 'editor' && !can('invoices')) next = 'inventory';

    view = next;
    $$('.view').forEach(function (v) { v.classList.remove('active'); });
    var el = $('#v-' + view);
    if (el) el.classList.add('active');

    $$('.navitem').forEach(function (b) {
      var on = b.dataset.view === view || (view === 'editor' && b.dataset.view === 'invoices');
      if (on) b.classList.add('active'); else b.classList.remove('active');
    });
    var app = $('#app');
    if (app) app.classList.remove('menu-open');
    var scroll = $('#scroll');
    if (scroll) scroll.scrollTop = 0;
    renderTabbar();
    render();
  }

  function renderDashboard() {
    loadUsersCache();
    var w = warehouse();
    var dashSub = $('#dashSub');
    var facEl = $('#dashScopeFacilityName');
    var divEl = $('#dashScopeDivisionUnit');
    var isRec = isRecycling();
    if (facEl) facEl.textContent = w ? w.name : 'No facility assigned';
    if (divEl) divEl.textContent = (isRec ? 'Recycling' : 'Healthcare') + ' · ' + (isRec ? 'Pallets' : 'Boxes');
    if (dashSub) dashSub.textContent = w ? 'Today’s operations at ' + w.name + '.' : 'Assign a facility to see operational data.';

    var invCard = $('#dashInvoiceKpiCard');
    if (invCard) invCard.hidden = !(isAdminOrManager() && isRec);

    var activityHost = $('#dashRecentActivity');
    if (!w) {
      ['dashKpiCurrentStock', 'dashKpiInboundTotal', 'dashKpiOutboundTotal', 'dashKpiActiveStaff'].forEach(function (id) {
        var el = $('#' + id); if (el) el.textContent = '0';
      });
      if (activityHost) activityHost.innerHTML = emptyState('box', 'No facility assigned', 'Ask an administrator to grant you access to a facility to see operational data.');
      return;
    }

    loadingState('#dashRecentActivity');

    var div = isRec ? 'recycling' : 'healthcare';
    var tasks = [
      Api.listMaterials({ warehouseId: w.id, division: div }),
      Api.getInventoryBalances(w.id, div),
      Api.listInventoryTransactions({ warehouseId: w.id, division: div })
    ];
    tasks.push(isAdminOrManager() ? Api.teamShifts() : Promise.resolve(currentShiftCache ? [currentShiftCache] : []));

    Promise.all(tasks).then(function (res) {
      var materials = res[0] || [];
      var balances = res[1] || [];
      var transactions = res[2] || [];
      var shifts = res[3] || [];
      var matById = {};
      materials.forEach(function (m) { matById[m.id] = m; });

      var grandCurrent = 0, grandInbound = 0, grandOutbound = 0;
      balances.forEach(function (b) {
        grandCurrent += Number(b.balance || b.totalBalance || 0);
        grandInbound += Number(b.inboundTotal || 0);
        grandOutbound += Number(b.outboundTotal || 0);
      });
      if (!balances.length && transactions.length) {
        transactions.forEach(function (t) {
          var tot = Number(t.total) || 0;
          if (t.type === 'inbound') { grandInbound += tot; grandCurrent += tot; }
          else if (t.type === 'outbound') { grandOutbound += tot; grandCurrent -= tot; }
          else if (t.type === 'adjustment') { grandCurrent += tot; }
        });
      }

      var elCur = $('#dashKpiCurrentStock'); if (elCur) elCur.textContent = num(grandCurrent);
      var elIn = $('#dashKpiInboundTotal'); if (elIn) elIn.textContent = num(grandInbound);
      var elOut = $('#dashKpiOutboundTotal'); if (elOut) elOut.textContent = num(grandOutbound);
      var stockSub = $('#dashKpiStockSub');
      if (stockSub) stockSub.textContent = isRec ? 'Total pallets across all materials' : 'Total boxes across all products';

      var elStaff = $('#dashKpiActiveStaff'); if (elStaff) elStaff.textContent = num(shifts.length);

      if (activityHost) {
        var recent = transactions.slice().sort(function (a, b) {
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        }).slice(0, 8);

        if (!recent.length) {
          activityHost.innerHTML = emptyState('history', 'No activity recorded yet',
            'Inbound, outbound, and adjustment transactions for this facility will appear here as they happen.');
        } else {
          activityHost.innerHTML = '<div class="tablewrap" tabindex="0" role="region" aria-label="Scrollable table"><table class="table"><thead><tr>' +
            '<th>When</th><th>Type</th><th>Product</th><th class="num">Qty</th><th>Recorded by</th></tr></thead><tbody>' +
            recent.map(function (t) {
              var typeLabel = t.type === 'inbound' ? 'Inbound' : (t.type === 'outbound' ? 'Outbound' : 'Adjustment');
              var typeBadge = t.type === 'inbound' ? 'badge-received' : (t.type === 'outbound' ? 'badge-out' : 'badge-transit');
              var m = matById[t.materialId] || { name: t.materialName || 'Item' };
              return '<tr><td class="mono" style="font-size:13px" title="' + esc(when(t.createdAt)) + '">' + esc(friendlyTime(t.createdAt)) + '</td>' +
                '<td><span class="badge ' + typeBadge + '">' + typeLabel + '</span></td>' +
                '<td>' + esc(m.name) + '</td>' +
                '<td class="num">' + num(Number(t.total) || 0) + '</td>' +
                '<td style="color:var(--muted)">' + esc((me && t.createdBy === me.id) ? me.name : userName(t.createdBy)) + '</td></tr>';
            }).join('') + '</tbody></table></div>';
        }
      }
    }).catch(function (err) {
      apiErrorState('#dashRecentActivity', err);
    });

    if (isAdminOrManager() && isRec) {
      Api.getPaymentMetrics(w.id).then(function (metrics) {
        if (!metrics) return;
        var el = $('#dashKpiOutstanding'); if (el) el.textContent = moneyDollars(metrics.totalOutstanding);
        var sub = $('#dashKpiOutstandingSub');
        if (sub) sub.textContent = num(metrics.unpaidCount || 0) + ' unpaid, ' + num(metrics.pendingCount || 0) + ' pending';
      }).catch(function () {});
    }
  }

  function renderInventory() {
    var w = warehouse();
    var invSub = $('#invenSub');
    if (invSub) invSub.textContent = w ? 'Current inventory and operations for ' + w.name + '.' : '';
    var invBody = $('#invenBody');
    if (!w) { if (invBody) invBody.innerHTML = ''; return; }

    loadingState('#invenBody');

    var div = isRecycling() ? 'recycling' : 'healthcare';
    Promise.all([
      Api.listMaterials({ warehouseId: w.id, division: div }),
      Api.getInventoryBalances(w.id, div),
      Api.listInventoryTransactions({ warehouseId: w.id, division: div }),
      Api.listContainers({ warehouseId: w.id, division: div })
    ]).then(function (res) {
      var allMaterials = res[0];
      var balances = res[1];
      var transactions = res[2];
      var containers = res[3];

      var visibleMats = allMaterials;
      inventoryBalancesCache = balances;
      inventoryTransactionsCache = transactions;
      inventoryContainersCache = containers;

      var prodFilterEl = $('#invenProductFilter');
      if (prodFilterEl) {
        var prevVal = prodFilterEl.value;
        prodFilterEl.innerHTML = '<option value="">All Products / Materials</option>' +
          visibleMats.map(function (m) {
            return '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>';
          }).join('');
        if (prevVal) prodFilterEl.value = prevVal;
      }

      var grandCurrent = 0, grandInbound = 0, grandOutbound = 0, grandAdj = 0;
      balances.forEach(function (b) {
        grandCurrent += Number(b.balance || b.totalBalance || 0);
        grandInbound += Number(b.inboundTotal || 0);
        grandOutbound += Number(b.outboundTotal || 0);
        grandAdj += Number(b.adjustmentTotal || 0);
      });

      if (!balances.length && transactions.length) {
        transactions.forEach(function (t) {
          var tot = Number(t.total) || 0;
          if (t.type === 'inbound') { grandInbound += tot; grandCurrent += tot; }
          else if (t.type === 'outbound') { grandOutbound += tot; grandCurrent -= tot; }
          else if (t.type === 'adjustment') { grandAdj += tot; grandCurrent += tot; }
        });
      }

      var isRec = isRecycling();
      var unitSuffix = isRec ? ' PALLETS' : ' BOXES';
      var elCur = $('#kpiCurrentStock'); if (elCur) elCur.textContent = num(grandCurrent);
      var elIn = $('#kpiInboundTotal'); if (elIn) elIn.textContent = num(grandInbound);
      var elOut = $('#kpiOutboundTotal'); if (elOut) elOut.textContent = num(grandOutbound);
      var elAdj = $('#kpiAdjustmentTotal'); if (elAdj) elAdj.textContent = (grandAdj >= 0 ? '+' : '') + num(grandAdj);

      var kpiSub = $('#kpiStockSub');
      if (kpiSub) kpiSub.textContent = isRec ? 'Total pallets across all materials' : 'Total boxes across all products';

      if (invenTab === 'balances') {
        renderBalancesTab(visibleMats, balances, transactions);
      } else if (invenTab === 'containers') {
        renderContainersTab(containers);
      }
    }).catch(function (err) {
      apiErrorState('#invenBody', err);
    });
  }

  function renderBalancesTab(materials, balances, transactions) {
    var invBody = $('#invenBody');
    if (!invBody) return;
    if (!materials.length) {
      invBody.innerHTML = emptyState('tag', isRecycling() ? 'No materials cataloged' : 'No products cataloged',
        'Add what you handle in Materials first to track stock balances.',
        can('products') ? 'Add catalog item' : null, 'goProducts');
      return;
    }

    var isRec = isRecycling();
    var matMap = {};
    materials.forEach(function (m) {
      matMap[m.id] = { material: m, xl: 0, l: 0, m: 0, s: 0, total: 0, inbound: 0, outbound: 0, adj: 0 };
    });

    if (balances.length) {
      balances.forEach(function (b) {
        if (matMap[b.materialId]) {
          matMap[b.materialId].xl = Number(b.xlBalance || 0);
          matMap[b.materialId].l = Number(b.lBalance || 0);
          matMap[b.materialId].m = Number(b.mBalance || 0);
          matMap[b.materialId].s = Number(b.sBalance || 0);
          matMap[b.materialId].total = Number(b.balance || b.totalBalance || 0);
          matMap[b.materialId].inbound = Number(b.inboundTotal || 0);
          matMap[b.materialId].outbound = Number(b.outboundTotal || 0);
          matMap[b.materialId].adj = Number(b.adjustmentTotal || 0);
        }
      });
    } else {
      transactions.forEach(function (t) {
        var row = matMap[t.materialId];
        if (!row) return;
        var sign = t.type === 'outbound' ? -1 : 1;
        var tot = Number(t.total) || 0;
        if (!isRec) {
          SIZE_KEYS.forEach(function (k) { row[k] += sign * (Number(t[k]) || 0); });
        }
        row.total += sign * tot;
        if (t.type === 'inbound') row.inbound += tot;
        else if (t.type === 'outbound') row.outbound += tot;
        else if (t.type === 'adjustment') row.adj += tot;
      });
    }

    var rows = Object.keys(matMap).map(function (k) { return matMap[k]; });

    if (invenProductFilter) {
      rows = rows.filter(function (r) { return r.material.id === invenProductFilter; });
    }
    if (invenSearchQuery) {
      var q = invenSearchQuery.toLowerCase();
      rows = rows.filter(function (r) {
        return (r.material.name || '').toLowerCase().indexOf(q) >= 0 ||
               (r.material.category || '').toLowerCase().indexOf(q) >= 0;
      });
    }

    var unitLabel = isRec ? 'PALLET' : 'BOX';

    var head = isRec
      ? '<tr>' +
          '<th>Product / Material</th>' +
          '<th>Category</th>' +
          '<th class="num" style="background:var(--acc-soft);color:var(--acc)">Current Stock (Pallets)</th>' +
          '<th class="num">Inbound</th>' +
          '<th class="num">Outbound</th>' +
          '<th class="num">Net Adj</th>' +
          '<th>Unit</th>' +
        '</tr>'
      : '<tr>' +
          '<th>Product</th>' +
          '<th>Category</th>' +
          '<th class="num">XL</th>' +
          '<th class="num">L</th>' +
          '<th class="num">M</th>' +
          '<th class="num">S</th>' +
          '<th class="num" style="background:var(--acc-soft);color:var(--acc)">Current Stock (Boxes)</th>' +
          '<th class="num">Inbound</th>' +
          '<th class="num">Outbound</th>' +
          '<th class="num">Net Adj</th>' +
          '<th>Unit</th>' +
        '</tr>';

    var body = rows.map(function (r) {
      if (isRec) {
        return '<tr>' +
          '<td><strong>' + esc(r.material.name) + '</strong></td>' +
          '<td style="color:var(--muted)">' + esc(r.material.category || '—') + '</td>' +
          '<td class="num" style="background:var(--acc-soft);font-weight:700;color:var(--acc)">' + num(r.total) + '</td>' +
          '<td class="num text-success">' + num(r.inbound) + '</td>' +
          '<td class="num text-warning">' + num(r.outbound) + '</td>' +
          '<td class="num text-accent">' + (r.adj >= 0 ? '+' : '') + num(r.adj) + '</td>' +
          '<td style="color:var(--muted)">' + unitLabel + '</td>' +
          '</tr>';
      } else {
        return '<tr>' +
          '<td><strong>' + esc(r.material.name) + '</strong></td>' +
          '<td style="color:var(--muted)">' + esc(r.material.category || '—') + '</td>' +
          '<td class="num">' + num(r.xl) + '</td>' +
          '<td class="num">' + num(r.l) + '</td>' +
          '<td class="num">' + num(r.m) + '</td>' +
          '<td class="num">' + num(r.s) + '</td>' +
          '<td class="num" style="background:var(--acc-soft);font-weight:700;color:var(--acc)">' + num(r.total) + '</td>' +
          '<td class="num text-success">' + num(r.inbound) + '</td>' +
          '<td class="num text-warning">' + num(r.outbound) + '</td>' +
          '<td class="num text-accent">' + (r.adj >= 0 ? '+' : '') + num(r.adj) + '</td>' +
          '<td style="color:var(--muted)">' + unitLabel + '</td>' +
          '</tr>';
      }
    }).join('');

    var totXL = rows.reduce(function (a, r) { return a + r.xl; }, 0);
    var totL  = rows.reduce(function (a, r) { return a + r.l; }, 0);
    var totM  = rows.reduce(function (a, r) { return a + r.m; }, 0);
    var totS  = rows.reduce(function (a, r) { return a + r.s; }, 0);
    var totStock = rows.reduce(function (a, r) { return a + r.total; }, 0);
    var totIn = rows.reduce(function (a, r) { return a + r.inbound; }, 0);
    var totOut = rows.reduce(function (a, r) { return a + r.outbound; }, 0);
    var totAdj = rows.reduce(function (a, r) { return a + r.adj; }, 0);

    var foot = isRec
      ? '<tfoot><tr style="font-weight:700">' +
          '<td>TOTALS</td><td></td>' +
          '<td class="num" style="background:var(--acc-soft);color:var(--acc)">' + num(totStock) + '</td>' +
          '<td class="num text-success">' + num(totIn) + '</td>' +
          '<td class="num text-warning">' + num(totOut) + '</td>' +
          '<td class="num text-accent">' + (totAdj >= 0 ? '+' : '') + num(totAdj) + '</td>' +
          '<td></td>' +
        '</tr></tfoot>'
      : '<tfoot><tr style="font-weight:700">' +
          '<td>TOTALS</td><td></td>' +
          '<td class="num">' + num(totXL) + '</td>' +
          '<td class="num">' + num(totL) + '</td>' +
          '<td class="num">' + num(totM) + '</td>' +
          '<td class="num">' + num(totS) + '</td>' +
          '<td class="num" style="background:var(--acc-soft);color:var(--acc)">' + num(totStock) + '</td>' +
          '<td class="num text-success">' + num(totIn) + '</td>' +
          '<td class="num text-warning">' + num(totOut) + '</td>' +
          '<td class="num text-accent">' + (totAdj >= 0 ? '+' : '') + num(totAdj) + '</td>' +
          '<td></td>' +
        '</tr></tfoot>';

    var colSpan = isRec ? 7 : 11;
    invBody.innerHTML = '<div class="card">' +
      '<div class="tablewrap" tabindex="0" role="region" aria-label="Scrollable table"><table class="table">' +
      '<thead>' + head + '</thead>' +
      '<tbody>' + (body || '<tr><td colspan="' + colSpan + '" style="text-align:center;color:var(--muted);padding:30px">No matching stock balances found.</td></tr>') + '</tbody>' +
      foot +
      '</table></div></div>';
  }

  /* Operational transaction timeline — lives on the History page. Spans every
     facility/division the user is authorized for, so each row states its own
     facility/division/unit rather than assuming the app's current scope. */
  function renderHistoryTransactionsTable(materials, transactions) {
    var matById = {};
    materials.forEach(function (m) { matById[m.id] = m; });

    var rows = transactions.slice();

    if (histProductFilter) {
      rows = rows.filter(function (t) { return t.materialId === histProductFilter; });
    }
    if (histTypeFilter) {
      rows = rows.filter(function (t) { return t.type === histTypeFilter; });
    }
    if (histRecordedByFilter) {
      rows = rows.filter(function (t) { return String(t.createdBy) === histRecordedByFilter; });
    }
    if (histSearchQuery) {
      var q = histSearchQuery.toLowerCase();
      rows = rows.filter(function (t) {
        var m = matById[t.materialId] || {};
        return (t.orderNumber || '').toLowerCase().indexOf(q) >= 0 ||
               (t.reference || '').toLowerCase().indexOf(q) >= 0 ||
               (t.containerNumber || '').toLowerCase().indexOf(q) >= 0 ||
               (t.sealNumber || '').toLowerCase().indexOf(q) >= 0 ||
               (t.reason || '').toLowerCase().indexOf(q) >= 0 ||
               (t.notes || '').toLowerCase().indexOf(q) >= 0 ||
               (m.name || '').toLowerCase().indexOf(q) >= 0;
      });
    }

    var head = '<tr>' +
        '<th>Date</th>' +
        '<th>Facility</th>' +
        '<th>Division</th>' +
        '<th>Order / Ref #</th>' +
        '<th>Type</th>' +
        '<th>Product / Material</th>' +
        '<th>Unit</th>' +
        '<th class="num">Quantity</th>' +
        '<th>Container No.</th>' +
        '<th>Seal No.</th>' +
        '<th>Recorded By</th>' +
        '<th>Notes / Reason</th>' +
      '</tr>';

    var body = rows.map(function (t) {
      var isRec = t.division === 'healthcare' ? false : true;
      var m = matById[t.materialId] || { name: t.materialName || 'Item' };
      var badgeClass = t.type === 'inbound' ? 'badge-in' : t.type === 'outbound' ? 'badge-out' : 'badge-adj';
      var typeLabel = t.type === 'inbound' ? 'IN' : t.type === 'outbound' ? 'OUT' : 'ADJ';
      var by = (me && t.createdBy === me.id) ? me.name : (usersCache ? userName(t.createdBy) : ('Staff #' + t.createdBy));
      var unitStr = (t.unitType || (isRec ? 'pallet' : 'box')).toUpperCase();
      var qtyStr = isRec
        ? num(t.total) + ' PALLETS' + ((t.weightValue != null && Number(t.weightValue) > 0) ? ' (' + num(t.weightValue) + ' ' + (t.weightUnit || 'kg').toUpperCase() + ')' : '')
        : num(t.total) + ' BOXES (XL' + num(t.xl) + '/L' + num(t.l) + '/M' + num(t.m) + '/S' + num(t.s) + ')';

      return '<tr class="clickable-row" data-tx="' + esc(t.id) + '" title="Click to view full transaction details and photos">' +
        '<td class="mono" style="font-size:12.5px">' + esc(when(t.createdAt).split(' ')[0]) + '</td>' +
        '<td>' + esc(t.warehouseName || warehouseName(t.warehouseId)) + '</td>' +
        '<td>' + (isRec ? 'Recycling' : 'Healthcare') + '</td>' +
        '<td class="mono"><strong>' + esc(t.orderNumber || t.reference || '—') + '</strong></td>' +
        '<td><span class="badge ' + badgeClass + '">' + typeLabel + '</span></td>' +
        '<td>' + esc(m.name) + '</td>' +
        '<td><span class="mono" style="font-size:11.5px;font-weight:700">' + esc(unitStr) + '</span></td>' +
        '<td class="num mono" style="font-size:12px"><strong>' + qtyStr + '</strong></td>' +
        '<td class="mono">' + esc(t.containerNumber || '—') + '</td>' +
        '<td class="mono">' + esc(t.sealNumber || '—') + '</td>' +
        '<td style="color:var(--ink-2)">' + esc(by) + '</td>' +
        '<td style="color:var(--muted);font-size:12.5px">' + esc(t.reason || t.notes || '—') + '</td>' +
        '</tr>';
    }).join('');

    var histBody = $('#historyBody');
    if (histBody) {
      histBody.innerHTML = '<div class="card">' +
        '<div class="tablewrap" tabindex="0" role="region" aria-label="Scrollable table"><table class="table">' +
        '<thead>' + head + '</thead>' +
        '<tbody>' + (body || '<tr><td colspan="12" style="text-align:center;color:var(--muted);padding:30px">No matching transactions found.</td></tr>') + '</tbody>' +
        '</table></div></div>';
    }

    $$('#historyBody .clickable-row[data-tx]').forEach(function (row) {
      row.addEventListener('click', function () {
        openTransactionDetailModal(row.dataset.tx);
      });
    });
  }

  function openTransactionDetailModal(txId) {
    Api.getInventoryTransaction(txId).then(function (tx) {
      var photoHtml = '';
      if (tx.photos && tx.photos.length > 0) {
        photoHtml = '<div class="tx-photos-section" style="margin-top:16px">' +
          '<span class="tx-detail-label">Associated Photos (' + tx.photos.length + ') — Click thumbnail to open lightbox</span>' +
          '<div class="tx-photos-grid">' +
          tx.photos.map(function (p) {
            var fileName = p.originalFilename || p.filename || 'Photo';
            return '<div class="tx-photo-card" data-url="' + esc(p.url) + '" data-meta="' + esc(fileName) + '">' +
              '<img src="' + esc(p.url) + '" alt="Photo" class="tx-photo-img">' +
              '<div class="tx-photo-meta">' + esc(fileName) + '</div>' +
              '</div>';
          }).join('') +
          '</div></div>';
      } else {
        photoHtml = '<div class="tx-detail-item" style="grid-column: 1 / -1;margin-top:8px"><span class="tx-detail-label">Associated Photos</span><span class="tx-detail-val" style="color:var(--muted)">— None attached</span></div>';
      }

      var txIsRec = (tx.division === 'recycling' || tx.unitType === 'pallet' || (!tx.division && !tx.unitType && (tx.weightValue != null && Number(tx.weightValue) > 0)));
      if (tx.division === 'healthcare' || tx.unitType === 'box') {
        txIsRec = false;
      }
      var divLabel = txIsRec ? 'Recycling (Pallets)' : 'Healthcare (Boxes)';
      var unitLabel = txIsRec ? 'PALLET' : 'BOX';
      var typeLabel = tx.type === 'inbound' ? 'Inbound (IN)' : tx.type === 'outbound' ? 'Outbound (OUT)' : 'Adjustment (ADJ)';

      var divisionSpecificFields = '';
      if (txIsRec) {
        var weightStr = (tx.weightValue != null && Number(tx.weightValue) > 0) ? (num(tx.weightValue) + ' ' + (tx.weightUnit || 'KG').toUpperCase()) : '—';
        divisionSpecificFields =
          '<div class="tx-detail-item"><span class="tx-detail-label">Weight</span><span class="tx-detail-val mono">⚖️ ' + esc(weightStr) + '</span></div>' +
          '<div class="tx-detail-item"><span class="tx-detail-label">Total Unit Quantity</span><span class="tx-detail-val mono text-success" style="font-size:16px"><strong>' + num(tx.total) + ' PALLETS</strong></span></div>';
      } else {
        divisionSpecificFields =
          '<div class="tx-detail-item"><span class="tx-detail-label">Total Unit Quantity</span><span class="tx-detail-val mono text-success" style="font-size:16px"><strong>' + num(tx.total) + ' BOXES</strong></span></div>' +
          '<div class="tx-detail-item" style="grid-column: 1 / -1"><span class="tx-detail-label">Size Breakdown (Whole BOX counts only)</span><span class="tx-detail-val mono">XL: ' + num(tx.xl) + '  |  L: ' + num(tx.l) + '  |  M: ' + num(tx.m) + '  |  S: ' + num(tx.s) + '</span></div>';
      }

      var bodyHtml =
        '<div class="tx-detail-card">' +
          '<div class="tx-detail-grid">' +
            '<div class="tx-detail-item"><span class="tx-detail-label">Transaction ID</span><span class="tx-detail-val mono" style="font-size:12px">' + esc(tx.id) + '</span></div>' +
            '<div class="tx-detail-item"><span class="tx-detail-label">Recorded At</span><span class="tx-detail-val mono">' + esc(when(tx.createdAt)) + '</span></div>' +
            '<div class="tx-detail-item"><span class="tx-detail-label">Facility / Warehouse</span><span class="tx-detail-val">📍 ' + esc(tx.warehouseName || 'Assigned Facility') + (tx.warehouseCode ? ' (' + esc(tx.warehouseCode) + ')' : '') + '</span></div>' +
            '<div class="tx-detail-item"><span class="tx-detail-label">Division</span><span class="tx-detail-val">🏢 ' + esc(divLabel) + '</span></div>' +
            '<div class="tx-detail-item"><span class="tx-detail-label">Transaction Type</span><span class="tx-detail-val"><strong>' + esc(typeLabel) + '</strong></span></div>' +
            '<div class="tx-detail-item"><span class="tx-detail-label">Order / Reference #</span><span class="tx-detail-val mono"><strong>' + esc(tx.orderNumber || tx.reference || '—') + '</strong></span></div>' +
            '<div class="tx-detail-item"><span class="tx-detail-label">' + (txIsRec ? 'Material' : 'Product') + '</span><span class="tx-detail-val"><strong>' + esc(tx.materialName || '—') + '</strong></span></div>' +
            '<div class="tx-detail-item"><span class="tx-detail-label">Unit Type</span><span class="tx-detail-val">' + esc(unitLabel) + '</span></div>' +
            divisionSpecificFields +
            '<div class="tx-detail-item"><span class="tx-detail-label">Container Number</span><span class="tx-detail-val mono">' + esc(tx.containerNumber || '—') + '</span></div>' +
            '<div class="tx-detail-item"><span class="tx-detail-label">Seal Number</span><span class="tx-detail-val mono">' + esc(tx.sealNumber || '—') + '</span></div>' +
            '<div class="tx-detail-item"><span class="tx-detail-label">BL / Tracking Number</span><span class="tx-detail-val mono">' + esc(tx.blNumber || '—') + '</span></div>' +
            '<div class="tx-detail-item"><span class="tx-detail-label">Shipping Line / Carrier</span><span class="tx-detail-val">' + esc(tx.shippingLine || '—') + '</span></div>' +
            '<div class="tx-detail-item"><span class="tx-detail-label">ETA / Expected Date</span><span class="tx-detail-val mono">' + esc(tx.eta || '—') + '</span></div>' +
            '<div class="tx-detail-item"><span class="tx-detail-label">Recorded By</span><span class="tx-detail-val">👤 ' + esc(tx.creatorName || ('Staff #' + tx.createdBy)) + '</span></div>' +
            '<div class="tx-detail-item" style="grid-column: 1 / -1"><span class="tx-detail-label">Notes / Reason</span><span class="tx-detail-val">' + esc(tx.reason || tx.notes || '—') + '</span></div>' +
          '</div>' +
          photoHtml +
        '</div>';

      openModal('Transaction Details · ' + (tx.orderNumber || tx.reference || tx.id.slice(0, 8)), bodyHtml, null);
      var okBtn = $('#modalOk'); if (okBtn) okBtn.hidden = true;
      var cancelBtn = $('#modalCancel'); if (cancelBtn) cancelBtn.textContent = 'Close';

      $$('.tx-photo-card').forEach(function (card) {
        card.addEventListener('click', function () {
          var url = card.dataset.url;
          var meta = card.dataset.meta;
          var lb = $('#lightbox');
          var lbImg = $('#lbImg');
          var lbMeta = $('#lbMeta');
          if (lb && lbImg) {
            lbImg.src = url;
            if (lbMeta) lbMeta.textContent = meta;
            lb.hidden = false;
          }
        });
      });
    }).catch(function (err) {
      toast('Failed to load transaction details: ' + (err.message || err));
    });
  }

  function renderContainersTab(containers) {
    var rows = containers.slice();
    if (invenSearchQuery) {
      var q = invenSearchQuery.toLowerCase();
      rows = rows.filter(function (c) {
        return (c.containerNumber || '').toLowerCase().indexOf(q) >= 0 ||
               (c.sealNumber || '').toLowerCase().indexOf(q) >= 0 ||
               (c.orderNumber || '').toLowerCase().indexOf(q) >= 0 ||
               (c.blNumber || '').toLowerCase().indexOf(q) >= 0 ||
               (c.productName || '').toLowerCase().indexOf(q) >= 0;
      });
    }

    var head = '<tr>' +
      '<th>Container No.</th>' +
      '<th>Seal No.</th>' +
      '<th>Order No.</th>' +
      '<th>BL No.</th>' +
      '<th>Product</th>' +
      '<th class="num">XL</th>' +
      '<th class="num">L</th>' +
      '<th class="num">M</th>' +
      '<th class="num">S</th>' +
      '<th class="num">Total</th>' +
      '<th>Status</th>' +
      '<th>ETA / Date</th>' +
      '<th>Notes</th>' +
      '</tr>';

    var body = rows.map(function (c) {
      var stBadge = c.status === 'received' ? 'badge-received' : c.status === 'dispatched' ? 'badge-dispatched' : 'badge-transit';
      return '<tr>' +
        '<td class="mono"><strong>' + esc(c.containerNumber || '—') + '</strong></td>' +
        '<td class="mono">' + esc(c.sealNumber || '—') + '</td>' +
        '<td class="mono">' + esc(c.orderNumber || '—') + '</td>' +
        '<td class="mono">' + esc(c.blNumber || '—') + '</td>' +
        '<td>' + esc(c.productName || 'General Product') + '</td>' +
        '<td class="num">' + num(c.xl) + '</td>' +
        '<td class="num">' + num(c.l) + '</td>' +
        '<td class="num">' + num(c.m) + '</td>' +
        '<td class="num">' + num(c.s) + '</td>' +
        '<td class="num"><strong>' + num(c.total) + '</strong></td>' +
        '<td><span class="badge ' + stBadge + '">' + esc(c.status || 'In Transit') + '</span></td>' +
        '<td class="mono" style="font-size:12.5px">' + esc(c.eta || when(c.createdAt).split(' ')[0]) + '</td>' +
        '<td style="color:var(--muted);font-size:12.5px">' + esc(c.notes || '—') + '</td>' +
        '</tr>';
    }).join('');

    var invBody = $('#invenBody');
    if (invBody) {
      invBody.innerHTML = '<div class="card">' +
        '<div class="tablewrap" tabindex="0" role="region" aria-label="Scrollable table"><table class="table">' +
        '<thead>' + head + '</thead>' +
        '<tbody>' + (body || '<tr><td colspan="13" style="text-align:center;color:var(--muted);padding:30px">No container records found.</td></tr>') + '</tbody>' +
        '</table></div></div>';
    }
  }

  function openReceiveModal() {
    var w = warehouse();
    if (!w) { toast('Please select a warehouse first.'); return; }

    Api.listMaterials({ warehouseId: w.id, division: entity }).then(function (all) {
      var mats = all;
      if (!mats.length) { toast('Please create materials in the catalog first.'); return; }

      var isRec = isRecycling();
      var unitType = isRec ? 'pallet' : 'box';
      var unitLabel = isRec ? 'PALLET' : 'BOX';
      var divName = isRec ? 'recycling' : 'healthcare';

      var formHtml = '';
      if (isRec) {
        // RECYCLING: PALLET-BASED INVENTORY (WEIGHT REQUIRED / NO XL/L/M/S)
        formHtml =
          '<div class="grid g2">' +
            '<div class="field"><label for="modalWhLocation">Warehouse Location</label><input id="modalWhLocation" type="text" value="' + esc(w.name) + '" readonly style="background:var(--panel-2)"></div>' +
            '<div class="field"><label>Division &amp; Packaging</label><div class="division-chip">♻️ Recycling — PALLETS</div></div>' +
          '</div>' +
          '<div class="grid g2">' +
            '<div class="field"><label for="modalTxDate">Date</label><input id="modalTxDate" type="date" name="date" value="' + today() + '" required></div>' +
            '<div class="field"><label>Order Number (e.g. Jul20-DIVESTPC-AB38A)</label><input type="text" name="orderNumber" placeholder="Order / PO #" required></div>' +
          '</div>' +
          '<div class="field"><label for="modalMaterialSelect">Material</label><select id="modalMaterialSelect" name="materialId" required>' +
            mats.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>'; }).join('') +
          '</select></div>' +
          '<div class="grid g2">' +
            '<div class="field"><label>Dedicated Weight</label>' +
              '<div class="weight-input-group">' +
                '<input type="number" name="weightValue" step="any" min="0" placeholder="e.g. 3658" required>' +
                '<select name="weightUnit" class="weight-unit-select" aria-label="Weight unit"><option value="kg" selected>KG</option><option value="lb">LB</option></select>' +
              '</div>' +
            '</div>' +
            '<div class="field"><label>Pallet Quantity</label><input type="number" name="palletQty" min="1" step="any" placeholder="e.g. 3" required class="pallet-input"></div>' +
          '</div>' +
          '<div class="grid g2">' +
            '<div class="field"><label>Container Number (e.g. MSMU 6896930)</label><input type="text" name="containerNumber" placeholder="MSMU 6896930"></div>' +
            '<div class="field"><label>Seal Number (e.g. 0336695)</label><input type="text" name="sealNumber" placeholder="0336695"></div>' +
          '</div>' +
          '<div class="total-preview-box">' +
            '<span class="total-preview-label">Total Pallets:</span>' +
            '<span class="total-preview-val" id="modalAutoTotal">0 PALLETS</span>' +
          '</div>' +
          '<div class="field">' +
            '<label>Inbound Photo Capture (Optional)</label>' +
            '<div class="inbound-photo-zone">' +
              '<div class="inbound-photo-btns">' +
                '<input type="file" id="inboundPhotoInput" accept="image/*" capture="environment" style="display:none">' +
                '<button type="button" class="btn ghost btn-sm" id="btnInboundTakePhoto"><svg><use href="#i-cam"></use></svg> Take Photo</button>' +
                '<button type="button" class="btn ghost btn-sm" id="btnInboundUploadPhoto"><svg><use href="#i-download"></use></svg> Upload Photo</button>' +
              '</div>' +
              '<div id="inboundPhotoPreviewWrap" hidden>' +
                '<div class="inbound-photo-preview">' +
                  '<img id="inboundPhotoThumb" src="" alt="Thumbnail">' +
                  '<span id="inboundPhotoName" style="font-size:12px;color:var(--ink-2);flex:1"></span>' +
                  '<button type="button" class="btn ghost btn-sm text-crit" id="btnInboundRemovePhoto" style="padding:2px 8px">Remove</button>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="field"><label>Notes / Comments (optional)</label><input type="text" name="notes" placeholder="e.g. SI SENT, cross dock"></div>';
      } else {
        // HEALTHCARE: BOX-BASED INVENTORY ONLY (NO WEIGHT)
        formHtml =
          '<div class="grid g2">' +
            '<div class="field"><label for="modalWhLocation">Warehouse Location</label><input id="modalWhLocation" type="text" value="' + esc(w.name) + '" readonly style="background:var(--panel-2)"></div>' +
            '<div class="field"><label>Division &amp; Packaging</label><div class="division-chip healthcare">🏥 Healthcare — BOXES</div></div>' +
          '</div>' +
          '<div class="grid g2">' +
            '<div class="field"><label for="modalTxDate">Date</label><input id="modalTxDate" type="date" name="date" value="' + today() + '" required></div>' +
            '<div class="field"><label>Order Number (e.g. Jul20-DIVESTPC-AB38A)</label><input type="text" name="orderNumber" placeholder="Order / PO #" required></div>' +
          '</div>' +
          '<div class="field"><label for="modalMaterialSelect">Product</label><select id="modalMaterialSelect" name="materialId" required>' +
            mats.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>'; }).join('') +
          '</select></div>' +
          '<div class="grid g2">' +
            '<div class="field"><label>Container Number (e.g. MSMU 6896930)</label><input type="text" name="containerNumber" placeholder="MSMU 6896930"></div>' +
            '<div class="field"><label>Seal Number (e.g. 0336695)</label><input type="text" name="sealNumber" placeholder="0336695"></div>' +
          '</div>' +
          '<label style="font-size:13px;font-weight:600;margin-top:10px;display:block">Quantities by Size (Whole BOX counts only)</label>' +
          '<div class="sizes-grid">' +
            '<div class="field"><label>XL</label><input type="number" name="xl" min="0" step="any" placeholder="0" class="size-input"></div>' +
            '<div class="field"><label>L</label><input type="number" name="l" min="0" step="any" placeholder="0" class="size-input"></div>' +
            '<div class="field"><label>M</label><input type="number" name="m" min="0" step="any" placeholder="0" class="size-input"></div>' +
            '<div class="field"><label>S</label><input type="number" name="s" min="0" step="any" placeholder="0" class="size-input"></div>' +
          '</div>' +
          '<div class="total-preview-box">' +
            '<span class="total-preview-label">Total Boxes (XL + L + M + S):</span>' +
            '<span class="total-preview-val" id="modalAutoTotal">0 BOXES</span>' +
          '</div>' +
          '<div class="field">' +
            '<label>Inbound Photo Capture (Optional)</label>' +
            '<div class="inbound-photo-zone">' +
              '<div class="inbound-photo-btns">' +
                '<input type="file" id="inboundPhotoInput" accept="image/*" capture="environment" style="display:none">' +
                '<button type="button" class="btn ghost btn-sm" id="btnInboundTakePhoto"><svg><use href="#i-cam"></use></svg> Take Photo</button>' +
                '<button type="button" class="btn ghost btn-sm" id="btnInboundUploadPhoto"><svg><use href="#i-download"></use></svg> Upload Photo</button>' +
              '</div>' +
              '<div id="inboundPhotoPreviewWrap" hidden>' +
                '<div class="inbound-photo-preview">' +
                  '<img id="inboundPhotoThumb" src="" alt="Thumbnail">' +
                  '<span id="inboundPhotoName" style="font-size:12px;color:var(--ink-2);flex:1"></span>' +
                  '<button type="button" class="btn ghost btn-sm text-crit" id="btnInboundRemovePhoto" style="padding:2px 8px">Remove</button>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="field"><label>Notes / Comments (optional)</label><input type="text" name="notes" placeholder="e.g. SI SENT, cross dock"></div>';
      }

      var selectedPhotoFile = null;

      openModal('Receive Inbound (' + (isRec ? 'PALLETS' : 'BOXES') + ')', formHtml, function (fd) {
        var parseWhole = function (val) {
          if (!val || val === '') return 0;
          var n = Number(val);
          if (isNaN(n) || !Number.isInteger(n) || n < 0) {
            throw new Error('Quantity counts must be non-negative whole integers (received ' + val + ').');
          }
          return n;
        };

        var xl = 0, l = 0, m = 0, s = 0, total = 0, weightVal, weightUnit;

        if (isRec) {
          var pQty = 0;
          try {
            pQty = parseWhole(fd.palletQty);
          } catch (e) {
            toast(e.message);
            return Promise.reject(e);
          }
          if (pQty <= 0) { toast('Please enter a valid Pallet Quantity.'); return Promise.reject(new Error('Please enter a valid Pallet Quantity.')); }
          total = pQty;
          xl = pQty;
          l = 0; m = 0; s = 0;

          weightVal = fd.weightValue ? Number(fd.weightValue) : undefined;
          if (weightVal !== undefined && (isNaN(weightVal) || weightVal < 0)) {
            toast('Weight value must be a positive number.');
            return Promise.reject(new Error('Weight value must be a positive number.'));
          }
          weightUnit = fd.weightUnit || 'kg';
        } else {
          try {
            xl = parseWhole(fd.xl);
            l = parseWhole(fd.l);
            m = parseWhole(fd.m);
            s = parseWhole(fd.s);
          } catch (e) {
            toast(e.message);
            return Promise.reject(e);
          }
          total = xl + l + m + s;
          if (total <= 0) { toast('Please enter a box quantity for at least one size.'); return Promise.reject(new Error('Please enter a box quantity for at least one size.')); }
          weightVal = undefined;
          weightUnit = undefined;
        }

        var doSubmit = function (photoId) {
          var payload = {
            warehouseId: w.id,
            materialId: fd.materialId,
            type: 'inbound',
            division: divName,
            unitType: unitType,
            weightValue: weightVal,
            weightUnit: weightUnit,
            photoId: photoId || undefined,
            orderNumber: fd.orderNumber,
            reference: fd.orderNumber,
            containerNumber: fd.containerNumber || undefined,
            sealNumber: fd.sealNumber || undefined,
            xl: xl, l: l, m: m, s: s,
            notes: fd.notes || undefined
          };

          return Api.createInventoryTransaction(payload).then(function () {
            toast('Inbound shipment received (' + num(total) + ' ' + unitLabel + 's) and stock updated.');
            renderInventory();
          });
        };

        if (selectedPhotoFile) {
          return Photos.prepare(selectedPhotoFile).then(function (prepared) {
            return Api.uploadPhoto(prepared.file, {
              warehouseId: w.id,
              photoType: 'inventory_inbound',
              jobReference: fd.orderNumber
            });
          }).then(function (res) {
            return doSubmit(res && res.id);
          }).catch(function (err) {
            toast('Photo upload failed: ' + (err.message || err));
            return doSubmit(undefined);
          });
        } else {
          return doSubmit(undefined);
        }
      });

      var pInput = $('#inboundPhotoInput');
      var pWrap = $('#inboundPhotoPreviewWrap');
      var pThumb = $('#inboundPhotoThumb');
      var pName = $('#inboundPhotoName');

      var btnTake = $('#btnInboundTakePhoto');
      if (btnTake) {
        btnTake.addEventListener('click', function () {
          if (pInput) pInput.click();
        });
      }
      var btnUp = $('#btnInboundUploadPhoto');
      if (btnUp) {
        btnUp.addEventListener('click', function () {
          if (pInput) pInput.click();
        });
      }
      var btnRem = $('#btnInboundRemovePhoto');
      if (btnRem) {
        btnRem.addEventListener('click', function () {
          selectedPhotoFile = null;
          if (pInput) pInput.value = '';
          if (pWrap) pWrap.hidden = true;
        });
      }
      if (pInput) {
        pInput.addEventListener('change', function (e) {
          var f = e.target.files && e.target.files[0];
          if (f) {
            selectedPhotoFile = f;
            if (pName) pName.textContent = f.name + ' (' + Math.round(f.size / 1024) + ' KB)';
            var reader = new FileReader();
            reader.onload = function (ev) {
              if (pThumb) pThumb.src = ev.target.result;
              if (pWrap) pWrap.hidden = false;
            };
            reader.readAsDataURL(f);
          }
        });
      }

      if (isRec) {
        var palInp = $('.pallet-input');
        if (palInp) {
          palInp.addEventListener('input', function () {
            var val = Math.floor(Number(palInp.value) || 0);
            var totEl = $('#modalAutoTotal');
            if (totEl) totEl.textContent = num(val) + ' PALLETS';
          });
        }
      } else {
        $$('.size-input').forEach(function (inp) {
          inp.addEventListener('input', function () {
            var t = 0;
            $$('.size-input').forEach(function (x) { t += Math.floor(Number(x.value) || 0); });
            var totEl = $('#modalAutoTotal');
            if (totEl) totEl.textContent = num(t) + ' BOXES';
          });
        });
      }
    });
  }

  function openShipModal() {
    var w = warehouse();
    if (!w) { toast('Please select a warehouse first.'); return; }

    Api.listMaterials({ warehouseId: w.id, division: entity }).then(function (all) {
      var mats = all;
      if (!mats.length) { toast('Please create materials in the catalog first.'); return; }

      var isRec = isRecycling();
      var unitType = isRec ? 'pallet' : 'box';
      var unitLabel = isRec ? 'PALLET' : 'BOX';
      var divName = isRec ? 'recycling' : 'healthcare';

      var formHtml = '';
      if (isRec) {
        formHtml =
          '<div class="grid g2">' +
            '<div class="field"><label for="modalWhLocation">Warehouse Location</label><input id="modalWhLocation" type="text" value="' + esc(w.name) + '" readonly style="background:var(--panel-2)"></div>' +
            '<div class="field"><label>Division &amp; Packaging</label><div class="division-chip">♻️ Recycling — PALLETS</div></div>' +
          '</div>' +
          '<div class="grid g2">' +
            '<div class="field"><label for="modalTxDate">Date</label><input id="modalTxDate" type="date" name="date" value="' + today() + '" required></div>' +
            '<div class="field"><label>Order / Reference #</label><input type="text" name="orderNumber" placeholder="Order / BOL #" required></div>' +
          '</div>' +
          '<div class="field"><label for="modalMaterialSelect">Material</label><select id="modalMaterialSelect" name="materialId" required>' +
            mats.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>'; }).join('') +
          '</select></div>' +
          '<div class="grid g2">' +
            '<div class="field"><label>Pallet Quantity to Dispatch</label><input type="number" name="palletQty" min="1" step="any" placeholder="e.g. 3" required class="pallet-input"></div>' +
            '<div class="field"><label>Container / Trailer # (optional)</label><input type="text" name="containerNumber" placeholder="MSMU 6896930 / Trailer"></div>' +
          '</div>' +
          '<div class="field"><label>Seal Number (optional)</label><input type="text" name="sealNumber" placeholder="0336695"></div>' +
          '<div class="total-preview-box">' +
            '<span class="total-preview-label">Calculated Outbound Total:</span>' +
            '<span class="total-preview-val text-warning" id="modalAutoTotal">0 PALLETS</span>' +
          '</div>' +
          '<div class="field"><label>Notes / Outbound Details</label><input type="text" name="notes" placeholder="e.g. shipped via Trailer 12345"></div>';
      } else {
        formHtml =
          '<div class="grid g2">' +
            '<div class="field"><label for="modalWhLocation">Warehouse Location</label><input id="modalWhLocation" type="text" value="' + esc(w.name) + '" readonly style="background:var(--panel-2)"></div>' +
            '<div class="field"><label>Division &amp; Packaging</label><div class="division-chip healthcare">🏥 Healthcare — BOXES</div></div>' +
          '</div>' +
          '<div class="grid g2">' +
            '<div class="field"><label for="modalTxDate">Date</label><input id="modalTxDate" type="date" name="date" value="' + today() + '" required></div>' +
            '<div class="field"><label>Order / Reference #</label><input type="text" name="orderNumber" placeholder="Order / BOL #" required></div>' +
          '</div>' +
          '<div class="field"><label for="modalMaterialSelect">Product</label><select id="modalMaterialSelect" name="materialId" required>' +
            mats.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>'; }).join('') +
          '</select></div>' +
          '<div class="grid g2">' +
            '<div class="field"><label>Container Number (optional)</label><input type="text" name="containerNumber" placeholder="MSMU 6896930 / Trailer"></div>' +
            '<div class="field"><label>Seal Number (optional)</label><input type="text" name="sealNumber" placeholder="0336695"></div>' +
          '</div>' +
          '<label style="font-size:13px;font-weight:600;margin-top:10px;display:block">Quantities to Dispatch (Whole BOX counts only)</label>' +
          '<div class="sizes-grid">' +
            '<div class="field"><label>XL</label><input type="number" name="xl" min="0" step="any" placeholder="0" class="size-input"></div>' +
            '<div class="field"><label>L</label><input type="number" name="l" min="0" step="any" placeholder="0" class="size-input"></div>' +
            '<div class="field"><label>M</label><input type="number" name="m" min="0" step="any" placeholder="0" class="size-input"></div>' +
            '<div class="field"><label>S</label><input type="number" name="s" min="0" step="any" placeholder="0" class="size-input"></div>' +
          '</div>' +
          '<div class="total-preview-box">' +
            '<span class="total-preview-label">Calculated Outbound Total:</span>' +
            '<span class="total-preview-val text-warning" id="modalAutoTotal">0 BOXES</span>' +
          '</div>' +
          '<div class="field"><label>Notes / Outbound Details</label><input type="text" name="notes" placeholder="e.g. shipped via Trailer 12345"></div>';
      }

      openModal('Ship Outbound (' + (isRec ? 'PALLETS' : 'BOXES') + ')', formHtml, function (fd) {
        var parseWhole = function (val) {
          if (!val || val === '') return 0;
          var n = Number(val);
          if (isNaN(n) || !Number.isInteger(n) || n < 0) {
            throw new Error('Quantity counts must be non-negative whole integers (received ' + val + ').');
          }
          return n;
        };

        var xl = 0, l = 0, m = 0, s = 0, total = 0;
        if (isRec) {
          var pQty = 0;
          try {
            pQty = parseWhole(fd.palletQty);
          } catch (e) {
            toast(e.message);
            return Promise.reject(e);
          }
          if (pQty <= 0) { toast('Please enter a valid Pallet Quantity.'); return Promise.reject(new Error('Please enter a valid Pallet Quantity.')); }
          total = pQty;
          xl = pQty;
          l = 0; m = 0; s = 0;
        } else {
          try {
            xl = parseWhole(fd.xl);
            l = parseWhole(fd.l);
            m = parseWhole(fd.m);
            s = parseWhole(fd.s);
          } catch (e) {
            toast(e.message);
            return Promise.reject(e);
          }
          total = xl + l + m + s;
          if (total <= 0) { toast('Please enter a box quantity for at least one size.'); return Promise.reject(new Error('Please enter a box quantity for at least one size.')); }
        }

        var payload = {
          warehouseId: w.id,
          materialId: fd.materialId,
          type: 'outbound',
          division: divName,
          unitType: unitType,
          orderNumber: fd.orderNumber,
          reference: fd.orderNumber,
          containerNumber: fd.containerNumber || undefined,
          sealNumber: fd.sealNumber || undefined,
          xl: xl, l: l, m: m, s: s,
          notes: fd.notes || undefined
        };

        return Api.createInventoryTransaction(payload).then(function () {
          toast('Outbound shipment recorded (' + num(total) + ' ' + unitLabel + 's) and stock reduced.');
          renderInventory();
        });
      });

      if (isRec) {
        var palInp = $('.pallet-input');
        if (palInp) {
          palInp.addEventListener('input', function () {
            var val = Math.floor(Number(palInp.value) || 0);
            var totEl = $('#modalAutoTotal');
            if (totEl) totEl.textContent = num(val) + ' PALLETS';
          });
        }
      } else {
        $$('.size-input').forEach(function (inp) {
          inp.addEventListener('input', function () {
            var t = 0;
            $$('.size-input').forEach(function (x) { t += Math.floor(Number(x.value) || 0); });
            var totEl = $('#modalAutoTotal');
            if (totEl) totEl.textContent = num(t) + ' BOXES';
          });
        });
      }
    });
  }

  function openAdjustModal() {
    var w = warehouse();
    if (!w) { toast('Please select a warehouse first.'); return; }

    Api.listMaterials({ warehouseId: w.id, division: entity }).then(function (all) {
      var mats = all;
      if (!mats.length) { toast('Please create materials in the catalog first.'); return; }

      var isRec = isRecycling();
      var unitType = isRec ? 'pallet' : 'box';
      var unitLabel = isRec ? 'PALLET' : 'BOX';
      var divName = isRec ? 'recycling' : 'healthcare';

      var formHtml = '';
      if (isRec) {
        formHtml =
          '<div class="grid g2">' +
            '<div class="field"><label for="modalWhLocation">Warehouse Location</label><input id="modalWhLocation" type="text" value="' + esc(w.name) + '" readonly style="background:var(--panel-2)"></div>' +
            '<div class="field"><label>Division &amp; Packaging</label><div class="division-chip">♻️ Recycling — PALLETS</div></div>' +
          '</div>' +
          '<div class="field"><label for="modalMaterialSelect">Material</label><select id="modalMaterialSelect" name="materialId" required>' +
            mats.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>'; }).join('') +
          '</select></div>' +
          '<div class="field"><label for="modalAdjReason">Reason for Adjustment (Required)</label><input id="modalAdjReason" type="text" name="reason" placeholder="e.g. physical recount, corrected pallet count" required></div>' +
          '<div class="field"><label for="modalAdjPalletQty">Pallet Adjustment Quantity (+ / -)</label><input id="modalAdjPalletQty" type="number" name="palletQty" step="any" placeholder="e.g. +2 or -1" required class="pallet-input"></div>' +
          '<div class="total-preview-box">' +
            '<span class="total-preview-label">Net Adjustment Total:</span>' +
            '<span class="total-preview-val text-accent" id="modalAutoTotal">0 PALLETS</span>' +
          '</div>';
      } else {
        formHtml =
          '<div class="grid g2">' +
            '<div class="field"><label for="modalWhLocation">Warehouse Location</label><input id="modalWhLocation" type="text" value="' + esc(w.name) + '" readonly style="background:var(--panel-2)"></div>' +
            '<div class="field"><label>Division &amp; Packaging</label><div class="division-chip healthcare">🏥 Healthcare — BOXES</div></div>' +
          '</div>' +
          '<div class="field"><label for="modalMaterialSelect">Product</label><select id="modalMaterialSelect" name="materialId" required>' +
            mats.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>'; }).join('') +
          '</select></div>' +
          '<div class="field"><label for="modalAdjReason">Reason for Adjustment (Required)</label><input id="modalAdjReason" type="text" name="reason" placeholder="e.g. physical recount, adjusted 5 units to match count" required></div>' +
          '<label id="modalAdjSizesLabel" style="font-size:13px;font-weight:600;margin-top:10px;display:block">Adjustment Quantities (Whole BOX counts only)</label>' +
          '<div class="sizes-grid" role="group" aria-labelledby="modalAdjSizesLabel">' +
            '<div class="field"><label for="modalAdjXl">XL</label><input id="modalAdjXl" type="number" name="xl" step="any" placeholder="0" class="size-input"></div>' +
            '<div class="field"><label for="modalAdjL">L</label><input id="modalAdjL" type="number" name="l" step="any" placeholder="0" class="size-input"></div>' +
            '<div class="field"><label for="modalAdjM">M</label><input id="modalAdjM" type="number" name="m" step="any" placeholder="0" class="size-input"></div>' +
            '<div class="field"><label for="modalAdjS">S</label><input id="modalAdjS" type="number" name="s" step="any" placeholder="0" class="size-input"></div>' +
          '</div>' +
          '<div class="total-preview-box">' +
            '<span class="total-preview-label">Net Adjustment Total:</span>' +
            '<span class="total-preview-val text-accent" id="modalAutoTotal">0 BOXES</span>' +
          '</div>';
      }

      openModal('Adjust Stock Balance (' + (isRec ? 'PALLETS' : 'BOXES') + ')', formHtml, function (fd) {
        var reason = (fd.reason || '').trim();
        if (!reason) { toast('Adjustment reason is required.'); return Promise.reject(new Error('Adjustment reason is required.')); }

        var parseWholeAdj = function (val) {
          if (!val || val === '') return 0;
          var n = Number(val);
          if (isNaN(n) || !Number.isInteger(n)) {
            throw new Error('Quantity counts must be whole integers (received ' + val + ').');
          }
          return n;
        };

        var xl = 0, l = 0, m = 0, s = 0, total = 0;
        if (isRec) {
          var pQty = 0;
          try {
            pQty = parseWholeAdj(fd.palletQty);
          } catch (e) {
            toast(e.message);
            return Promise.reject(e);
          }
          if (pQty === 0) { toast('Please enter a non-zero adjustment quantity.'); return Promise.reject(new Error('Please enter a non-zero adjustment quantity.')); }
          total = pQty;
          xl = pQty;
          l = 0; m = 0; s = 0;
        } else {
          try {
            xl = parseWholeAdj(fd.xl);
            l = parseWholeAdj(fd.l);
            m = parseWholeAdj(fd.m);
            s = parseWholeAdj(fd.s);
          } catch (e) {
            toast(e.message);
            return Promise.reject(e);
          }
          total = xl + l + m + s;
          if (total === 0 && !xl && !l && !m && !s) { toast('Please enter an adjustment quantity.'); return Promise.reject(new Error('Please enter an adjustment quantity.')); }
        }

        var payload = {
          warehouseId: w.id,
          materialId: fd.materialId,
          type: 'adjustment',
          division: divName,
          unitType: unitType,
          reason: reason,
          xl: xl, l: l, m: m, s: s
        };

        return Api.createInventoryTransaction(payload).then(function () {
          toast('Stock adjustment recorded.');
          renderInventory();
        });
      });

      if (isRec) {
        var palInp = $('.pallet-input');
        if (palInp) {
          palInp.addEventListener('input', function () {
            var val = Math.floor(Number(palInp.value) || 0);
            var totEl = $('#modalAutoTotal');
            if (totEl) totEl.textContent = (val >= 0 ? '+' : '') + num(val) + ' PALLETS';
          });
        }
      } else {
        $$('.size-input').forEach(function (inp) {
          inp.addEventListener('input', function () {
            var t = 0;
            $$('.size-input').forEach(function (x) { t += Math.floor(Number(x.value) || 0); });
            var totEl = $('#modalAutoTotal');
            if (totEl) totEl.textContent = (t >= 0 ? '+' : '') + num(t) + ' BOXES';
          });
        });
      }
    });
  }

  function exportInventoryCsv() {
    var w = warehouse();
    if (!w) return;

    var csvContent = 'Warehouse,Product ID,XL Balance,L Balance,M Balance,S Balance,Current Stock,Inbound Total,Outbound Total,Net Adjustment\n';
    inventoryBalancesCache.forEach(function (b) {
      csvContent += [
        '"' + w.name + '"',
        b.materialId,
        b.xlBalance || 0,
        b.lBalance || 0,
        b.mBalance || 0,
        b.sBalance || 0,
        b.balance || b.totalBalance || 0,
        b.inboundTotal || 0,
        b.outboundTotal || 0,
        b.adjustmentTotal || 0
      ].join(',') + '\n';
    });

    var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast('Export downloaded: ' + filename);
  }

  function renderChat() {
    var wrap = $('#chatMessagesList');
    if (!wrap) return;

    loadUsersCache();

    Api.listChatMessages({ limit: 50 }).then(function (messages) {
      chatMessages = messages || [];
      renderChatMessagesList();
      scrollToChatBottom();
    }).catch(function (err) {
      wrap.innerHTML = '<div class="chat-empty" style="color:var(--crit)">Could not load chat messages: ' + esc(err.message) + '</div>';
    });

    refreshOnlineStaff();
    initChatSse();

    if (chatPollTimer) clearInterval(chatPollTimer);
    chatPollTimer = setInterval(function () {
      if (view === 'chat') {
        Api.listChatMessages({ limit: 50 }).then(function (latest) {
          if (latest && latest.length) {
            var added = false;
            latest.forEach(function (msg) {
              if (!chatMessages.some(function (m) { return m.id === msg.id; })) {
                chatMessages.push(msg);
                added = true;
              }
            });
            if (added) {
              renderChatMessagesList();
              scrollToChatBottom();
            }
          }
        }).catch(function () {});
      }
    }, 4000);
  }

  function initChatSse() {
    if (chatSseSource) return;
    try {
      var sseUrl = Api.chatStreamUrl();
      chatSseSource = new EventSource(sseUrl);
      chatSseSource.onmessage = function (event) {
        try {
          var payload = JSON.parse(event.data);
          if (payload && payload.data) {
            var msg = payload.data;
            if (!chatMessages.some(function (m) { return m.id === msg.id; })) {
              chatMessages.push(msg);
              if (view === 'chat') {
                renderChatMessagesList();
                scrollToChatBottom();
              } else {
                var badge = $('#chatNavBadge');
                if (badge) {
                  badge.hidden = false;
                  badge.textContent = Number(badge.textContent || 0) + 1;
                }
              }
            }
          }
        } catch (e) {}
      };
      chatSseSource.onerror = function () {
        if (chatSseSource) {
          chatSseSource.close();
          chatSseSource = null;
          setTimeout(initChatSse, 8000);
        }
      };
    } catch (e) {
      chatSseSource = null;
    }
  }

  function refreshOnlineStaff() {
    Api.getOnlineStaff().then(function (res) {
      var count = res ? (res.count || 1) : 1;
      var chip = $('#onlineStaffChip');
      if (chip) chip.textContent = '🟢 ' + count + ' online';
      var presence = $('#chatPresenceText');
      if (presence) presence.textContent = count + ' staff active online';
    }).catch(function () {});
  }

  function renderChatMessagesList() {
    var wrap = $('#chatMessagesList');
    if (!wrap) return;

    if (!chatMessages.length) {
      wrap.innerHTML = '<div class="chat-empty">No messages yet. Send a message to start communicating with the team!</div>';
      return;
    }

    wrap.innerHTML = chatMessages.map(function (msg) {
      var senderName = msg.senderName || userName(msg.senderId) || 'Staff';
      var role = (msg.senderRole || 'staff').toLowerCase();
      var roleClass = role === 'admin' ? 'role-admin' : role === 'manager' ? 'role-manager' : 'role-staff';
      var exactDate = when(msg.createdAt);
      var relDate = friendlyTime(msg.createdAt);

      return '<div class="chat-msg" data-msg-id="' + esc(msg.id) + '">' +
        '<div class="chat-avatar ' + roleClass + '">' + esc(initials(senderName)) + '</div>' +
        '<div class="chat-content">' +
          '<div class="chat-meta">' +
            '<span class="chat-sender">' + esc(senderName) + '</span>' +
            '<span class="chat-role">' + esc(role) + '</span>' +
            '<span class="chat-time" title="' + esc(exactDate) + '">' + esc(relDate) + '</span>' +
          '</div>' +
          '<div class="chat-text">' + esc(msg.message) + '</div>' +
        '</div>' +
        '</div>';
    }).join('');
  }

  function scrollToChatBottom() {
    var wrap = $('#chatMessagesWrap');
    if (wrap) {
      wrap.scrollTop = wrap.scrollHeight;
    }
  }

  function setupChatComposer() {
    var form = $('#chatForm');
    var input = $('#chatInput');
    if (!form || !input) return;

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        form.dispatchEvent(new Event('submit', { cancelable: true }));
      }
    });

    input.addEventListener('input', function () {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = input.value.trim();
      if (!text) return;

      input.value = '';
      input.style.height = 'auto';

      Api.sendChatMessage(text).then(function (saved) {
        if (!chatMessages.some(function (m) { return m.id === saved.id; })) {
          chatMessages.push(saved);
          renderChatMessagesList();
          scrollToChatBottom();
        }
      }).catch(function (err) {
        toast('Failed to send message: ' + (err.message || 'Network error'));
      });
    });

    var refreshBtn = $('#chatRefreshBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        renderChat();
        toast('Chat refreshed.');
      });
    }
  }

  var intakeMaterials = [];

  function renderIntake() {
    var w = warehouse();
    var titleEl = $('#intakeTitle');
    if (titleEl) titleEl.textContent = isRecycling() ? 'Weigh-in' : 'Receive stock';
    var subEl = $('#intakeSub');
    if (subEl) subEl.textContent = isRecycling()
      ? 'Gross less tare gives net. It posts to ' + (w ? w.name : 'the warehouse') + '.'
      : 'Count what arrived. It posts to ' + (w ? w.name : 'the warehouse') + '.';
    var body = $('#intakeBody');
    if (!w) { if (body) body.innerHTML = ''; return; }

    loadingState('#intakeBody');
    Api.listMaterials({ warehouseId: w.id, division: entity }).then(function (all) {
      var list = all;
      intakeMaterials = list;
      if (!list.length) {
        if (body) {
          body.innerHTML = emptyState('tag', 'Nothing to record against',
            'Add what you handle in Materials first.',
            can('products') ? 'Add material' : null, 'goProducts');
        }
        return;
      }

      var dirOptions = '<option value="in">In — arriving</option><option value="out">Out — shipping</option>' +
        (isAdminOrManager() ? '<option value="adj">Adjustment — correct a count</option>' : '');

      if (body) {
        body.innerHTML =
          '<div class="card"><div class="cardhead"><h3>' + (isRecycling() ? 'Inbound ticket' : 'Receipt') + '</h3></div>' +
          '<div class="pad"><div class="grid g2">' +
            '<div class="field"><label>' + (isRecycling() ? 'Material' : 'Product') + '</label><select id="tkMaterial">' +
              list.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + ' (' + esc(m.unit) + ')</option>'; }).join('') +
            '</select></div>' +
            '<div class="field"><label>Direction</label><select id="tkDir">' + dirOptions + '</select></div>' +
            '<div class="field"><label>Date</label><input type="date" id="tkDate" value="' + today() + '"></div>' +
            '<div class="field"><label>Reference</label><input type="text" id="tkRef" placeholder="Order #, container # or BOL"></div>' +
          '</div><div id="tkReasonWrap" hidden style="margin-top:16px">' + field('reason', 'Reason for adjustment', { required: true }) + '</div>' +
          '<div id="tkQty" style="margin-top:16px"></div>' +
          '<div id="tkContainer" style="margin-top:16px"></div>' +
          '<button type="button" class="btn btn-primary" id="tkPost" style="margin-top:18px"><svg><use href="#i-check"></use></svg>Post ticket</button>' +
          '</div></div><div id="tkRecent"></div>';
      }

      var tkMat = $('#tkMaterial'); if (tkMat) tkMat.addEventListener('change', renderQtyFields);
      var tkDir = $('#tkDir');
      if (tkDir) {
        tkDir.addEventListener('change', function () {
          var rWrap = $('#tkReasonWrap'); if (rWrap) rWrap.hidden = tkDir.value !== 'adj';
          renderContainerFields();
        });
      }
      var tkPost = $('#tkPost'); if (tkPost) tkPost.addEventListener('click', postTicket);
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
      host.innerHTML = '<div class="sizes-grid">' + SIZE_KEYS.map(function (k) {
        return '<div class="field"><label>' + SIZE_LABELS[k] + '</label><input type="number" step="any" min="0" data-size="' + k + '" placeholder="0"></div>';
      }).join('') + '</div><div class="total-preview-box"><span class="total-preview-label">Total this ticket:</span><span class="total-preview-val" id="tkTotal">0 ' + esc(m.unit) + '</span></div>';
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
            ? '<div class="note" style="border-left-color:var(--crit);color:var(--crit)">Tare is higher than gross — check weights.</div>' : '';
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
    host.innerHTML = '<details><summary style="cursor:pointer;color:var(--ink-2);font-size:13.5px">Container &amp; Loading Details (optional)</summary>' +
      '<div class="grid g3" style="margin-top:12px">' +
        field('ctOrder', 'Order number') + field('ctBl', 'BL number') + field('ctLine', 'Shipping line') +
        field('ctNum', 'Container number') + field('ctSeal', 'Seal number') + field('ctEta', 'ETA', { type: 'date' }) +
      '</div></details>';
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
    Api.createInventoryTransaction(payload).then(function () {
      toast('Ticket posted successfully.');
      renderIntake();
    }).catch(function (err) {
      btn.disabled = false;
      toast(err.message || 'Could not post ticket.');
    });
  }

  function renderRecent(w) {
    Api.listInventoryTransactions({ warehouseId: w.id }).then(function (txs) {
      var host = $('#tkRecent'); if (!host) return;
      var mine = txs.slice(0, 8);
      if (!mine.length) { host.innerHTML = ''; return; }
      var byId = {}; intakeMaterials.forEach(function (m) { byId[m.id] = m; });

      host.innerHTML = '<div class="card"><div class="cardhead pad"><h3>Recent transactions here</h3></div>' +
        '<div class="tablewrap" tabindex="0" role="region" aria-label="Scrollable table"><table class="table"><thead><tr><th>Date</th><th>Item</th><th>Reference</th><th>By</th><th>Type</th><th class="num">Qty</th></tr></thead><tbody>' +
        mine.map(function (t) {
          var m = byId[t.materialId] || { name: '—', unit: '' };
          var q = num(t.total) + ' ' + m.unit;
          var by = (me && t.createdBy === me.id) ? me.name : (usersCache ? userName(t.createdBy) : ('Staff #' + t.createdBy));
          var kind = t.type === 'outbound' ? 'Out' : t.type === 'adjustment' ? 'Adj' : 'In';
          var badgeClass = t.type === 'outbound' ? 'badge-out' : t.type === 'adjustment' ? 'badge-adj' : 'badge-in';
          return '<tr><td class="mono" style="font-size:13px">' + esc(when(t.createdAt).split(' ')[0]) + '</td><td>' + esc(m.name) + '</td>' +
            '<td class="mono" style="font-size:12.5px;color:var(--muted)">' + esc(t.orderNumber || t.reference || t.reason || '—') + '</td>' +
            '<td style="color:var(--ink-2)">' + esc(by) + '</td>' +
            '<td><span class="badge ' + badgeClass + '">' + kind + '</span></td>' +
            '<td class="num"><strong>' + esc(q) + '</strong></td></tr>';
        }).join('') + '</tbody></table></div></div>';
    }).catch(function () { var host = $('#tkRecent'); if (host) host.innerHTML = ''; });
  }

  var photoCache = [];

  function renderPhotos() {
    var isAdmin = isAdminOrManager();
    var pSub = $('#photoSub');
    if (pSub) {
      pSub.textContent = isAdmin
        ? 'Every photo uploaded across warehouses, newest first.'
        : 'Photos you have taken. Administrators can view all.';
    }

    loadingState('#photoBody');
    loadUsersCache();
    var w = warehouse();
    Api.listPhotos({ warehouseId: w ? w.id : undefined }).then(function (all) {
      photoCache = all;
      var used = photoCache.reduce(function (a, p) { return a + (p.sizeBytes || 0); }, 0);
      var pBody = $('#photoBody');
      if (!pBody) return;

      if (!photoCache.length) {
        pBody.innerHTML = emptyState('cam', 'No photos yet',
          'Take a picture of a load, a seal, or an arrival. Photos are persisted in MinIO with GPS EXIF stripped.',
          'Add photo', 'addPhoto');
        return;
      }

      pBody.innerHTML = '<div class="card">' +
        '<div class="pad" style="display:flex;align-items:center;border-bottom:1px solid var(--line)">' +
        '<span><b style="color:var(--ink)">' + photoCache.length + '</b> photos · ' + bytes(used) + '</span>' +
        '</div>' +
        '<div class="photogrid pad" style="display:grid;grid-template-columns:repeat(auto-fill, minmax(180px, 1fr));gap:12px">' +
        photoCache.map(function (p, i) {
          return '<button type="button" class="photo btn ghost" data-photo="' + i + '" style="padding:0;overflow:hidden;text-align:left;display:flex;flex-direction:column">' +
            '<img src="' + esc(p.url) + '" alt="' + esc(p.originalFilename || 'photo') + '" loading="lazy" style="width:100%;height:130px;object-fit:cover">' +
            '<span style="padding:8px;font-size:11.5px;color:var(--muted)"><b>' + esc(userName(p.takenBy)) + '</b><br>' + esc(when(p.takenAt)) + '</span></button>';
        }).join('') + '</div></div>';

      $$('[data-photo]').forEach(function (b) {
        b.addEventListener('click', function () { openLightbox(Number(b.dataset.photo)); });
      });
    }).catch(function (err) { apiErrorState('#photoBody', err); });
  }

  function closeLightbox() {
    var lb = $('#lightbox');
    if (!lb || lb.hidden) return;
    lb.hidden = true;
    if (dialogOpenerEl && document.contains(dialogOpenerEl)) dialogOpenerEl.focus();
    dialogOpenerEl = null;
  }

  function openLightbox(i) {
    var p = photoCache[i]; if (!p) return;
    dialogOpenerEl = document.activeElement;
    var lbImg = $('#lbImg'); if (lbImg) lbImg.src = p.url;
    var lbMeta = $('#lbMeta');
    if (lbMeta) {
      lbMeta.innerHTML = esc(userName(p.takenBy)) + ' · ' + esc(when(p.takenAt)) +
        ' · ' + bytes(p.sizeBytes) +
        (p.jobReference ? '<br>' + esc(p.jobReference) : '') +
        '<br><a href="' + esc(p.url) + '" download="' + esc(p.originalFilename || 'photo.jpg') + '" target="_blank" rel="noopener" class="btn ghost btn-sm" id="lbDownload" style="margin-top:12px;text-decoration:none;display:inline-flex">Download</a>' +
        (me && me.role === 'admin' ? ' <button type="button" class="btn danger" id="lbDel" style="margin-top:12px">Delete this photo</button>' : '');
    }
    var lb = $('#lightbox');
    if (lb) lb.hidden = false;
    var lbCloseBtn = $('#lbClose');
    if (lbCloseBtn) lbCloseBtn.focus();

    var del = $('#lbDel');
    if (del) del.addEventListener('click', function () {
      if (!confirm('Delete this photo permanently?')) return;
      Api.deletePhoto(p.id).then(function () {
        closeLightbox();
        renderPhotos();
        toast('Photo deleted.');
      }).catch(function (err) { toast(err.message || 'Could not delete photo.'); });
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
    toast('Uploading ' + files.length + ' photo(s)…');

    Promise.all(jobs).then(function () {
      toast('Photos uploaded.');
      renderPhotos();
    }).catch(function (err) {
      toast('Upload completed with some errors.');
      renderPhotos();
    });
  }

  function renderTimeclock() {
    loadingState('#clockBody');
    loadUsersCache();
    Promise.all([Api.currentShift(), Api.shiftHistory()]).then(function (r) {
      var open = r[0], mine = r[1] || [];
      currentShiftCache = open;
      renderShiftChip();

      var weekAgo = Date.now() - 7 * 864e5;
      var weekMs = (mine || []).reduce(function (a, s) {
        var st = new Date(s.clockIn).getTime();
        if (isNaN(st) || st < weekAgo) return a;
        var end = s.clockOut ? new Date(s.clockOut).getTime() : Date.now();
        return a + Math.max(0, end - st);
      }, 0);

      var clockBody = $('#clockBody');
      if (clockBody) {
        var startTimeStr = open ? new Date(open.clockIn).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
        var elapsedMs = open ? Math.max(0, Date.now() - new Date(open.clockIn).getTime()) : 0;

        clockBody.innerHTML =
          '<div class="card"><div class="pad" style="text-align:center">' +
            '<div style="font-size:14px;color:var(--muted)">' + (open ? 'On shift since ' + startTimeStr : 'Clocked out') + '</div>' +
            '<div style="font-size:40px;font-weight:700;font-family:var(--f-mono);margin:12px 0;' + (open ? 'color:var(--acc)' : 'color:var(--muted)') + '" id="clockTime">' +
              (open ? hms(elapsedMs) : '—') + '</div>' +
            '<div style="font-size:13px;color:var(--muted);margin-bottom:18px">' + hm(weekMs) + ' logged in the last 7 days</div>' +
            '<button type="button" class="btn ' + (open ? 'btn-secondary' : 'btn-primary') + '" id="clockBtn">' +
              '<svg><use href="#i-' + (open ? 'stop' : 'play') + '"></use></svg>' + (open ? 'Clock Out' : 'Clock In') + '</button>' +
          '</div></div>' +

          ((mine && mine.length) ? '<div class="card"><div class="pad"><h3>Your shift history</h3></div>' +
            '<div class="tablewrap" tabindex="0" role="region" aria-label="Scrollable table"><table class="table"><thead><tr><th>Started</th><th>Ended</th><th class="num">Duration</th></tr></thead><tbody>' +
            mine.slice(0, 30).map(function (s) {
              var st = new Date(s.clockIn).getTime();
              var end = s.clockOut ? new Date(s.clockOut).getTime() : null;
              var dur = end ? hm(end - st) : '<span class="badge badge-in">active</span>';
              return '<tr><td class="mono" style="font-size:13px">' + esc(when(s.clockIn)) + '</td>' +
                '<td class="mono" style="font-size:13px">' + (s.clockOut ? esc(when(s.clockOut)) : '<span class="badge badge-in">open</span>') + '</td>' +
                '<td class="num"><strong>' + dur + '</strong></td></tr>';
            }).join('') + '</tbody></table></div></div>' : '<div class="card"><div class="pad" style="color:var(--muted);text-align:center">No shift history in the last 7 days.</div></div>') +
          '<div id="teamClockCard"></div>';
      }

      var clockBtn = $('#clockBtn');
      if (clockBtn) clockBtn.addEventListener('click', toggleClock);

      if (isAdminOrManager()) {
        Api.teamShifts().then(function (rows) {
          var host = $('#teamClockCard'); if (!host) return;
          if (!rows || !rows.length) { host.innerHTML = ''; return; }
          host.innerHTML = '<div class="card"><div class="pad"><h3>Team members on shift right now</h3></div>' +
            '<div class="tablewrap" tabindex="0" role="region" aria-label="Scrollable table"><table class="table"><thead><tr><th>Staff Name</th><th>Warehouse</th><th class="num">Clock In Time</th></tr></thead><tbody>' +
            rows.map(function (s) {
              return '<tr><td><strong>' + esc(userName(s.userId)) + '</strong></td>' +
                '<td style="color:var(--muted)">' + esc(warehouseName(s.warehouseId)) + '</td>' +
                '<td class="num">' + esc(when(s.clockIn)) + '</td></tr>';
            }).join('') + '</tbody></table></div></div>';
        }).catch(function () { var host = $('#teamClockCard'); if (host) host.innerHTML = ''; });
      }

      if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
      if (open) {
        clockTimer = setInterval(function () {
          var el = $('#clockTime');
          if (!el) { clearInterval(clockTimer); clockTimer = null; return; }
          var ms = Math.max(0, Date.now() - new Date(open.clockIn).getTime());
          el.textContent = hms(ms);
          renderShiftChip();
        }, 1000);
      }
    }).catch(function (err) { apiErrorState('#clockBody', err); });
  }

  var clockInFlight = false;
  function toggleClock() {
    if (clockInFlight) return;
    clockInFlight = true;
    var btn = $('#clockBtn'); if (btn) { btn.disabled = true; btn.textContent = 'Processing…'; }
    var open = currentShiftCache;
    var w = warehouse();
    var wId = w ? w.id : undefined;
    var call = open ? Api.clockOut() : Api.clockIn(wId);
    call.then(function () {
      clockInFlight = false;
      toast(open ? 'Clocked out.' : 'Clocked in.');
      refreshShiftChip().then(function () {
        renderTimeclock();
      });
    }).catch(function (err) {
      clockInFlight = false;
      if (btn) btn.disabled = false;
      toast(err.status === 409 ? 'You are already clocked in.' : (err.message || 'Could not update shift.'));
      renderTimeclock();
    });
  }

  function newDraft() {
    var w = warehouse();
    var t = w ? taxFor(w.province) : { label: 'GST @ 5%', rate: 0.05 };
    var co = db.company || {};
    return {
      id: null,
      invoiceNumber: '',
      customerId: '',
      billTo: 'Fibertech Supply Chain Inc.\n7901 Progress way\nDelta BC V4G 1A3',
      shipTo: 'Fibertech Supply Chain Inc.\n7901 Progress way\nDelta BC V4G 1A3',
      shipVia: 'Greenwave Recycling Truck',
      shipDate: today(),
      reference: '',
      poReference: '',
      paymentTerms: 'Net 15',
      termsDays: 15,
      fromLocation: (w && w.name) || 'Maple Ridge, BC',
      warehouseId: w ? w.id : null,
      province: w ? w.province : 'BC',
      invoiceDate: today(),
      dueDate: new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10),
      taxLabel: t.label || 'GST @ 5%',
      taxRatePct: (t.rate || 0.05) * 100,
      companyInfo: {
        name: co.name || 'Greenwave Recycling Inc.',
        bn: co.bn || 'BN 751161951BC0001',
        gst: co.gst || '751161951RT0001',
        line1: co.line1 || '23394 Fisherman Rd',
        line2: co.line2 || 'Maple Ridge, BC V2W 1B9',
        email: co.email || 'sales@greenwaverecycling.ca',
        phone: co.phone || '6724720423'
      },
      paymentInstructions: 'sales@greenwaverecycling.ca\n6724720423',
      notes: '',
      status: 'draft',
      paymentStatus: null,
      paidAt: null,
      items: [
        {
          serviceDate: today(),
          productService: 'supply',
          unit: '',
          description: 'OCC 12 Cardboard (12 Bales)',
          quantity: 3.658,
          unitPrice: 140.00,
          discount: 0,
          isRebate: false,
          taxRateLabel: 'GST'
        }
      ]
    };
  }

  function blankLine() {
    return {
      serviceDate: today(),
      productService: 'supply',
      unit: '',
      description: '',
      quantity: 1,
      unitPrice: 0,
      discount: 0,
      isRebate: false,
      taxRateLabel: 'GST'
    };
  }

  function invoiceToDraft(inv) {
    var termsDays = 15;
    if (inv.dueDate && inv.invoiceDate) {
      termsDays = Math.max(0, Math.round((new Date(inv.dueDate) - new Date(inv.invoiceDate)) / 864e5));
    }
    var items = (inv.items || []).map(function (it) {
      return {
        serviceDate: it.serviceDate || inv.invoiceDate || today(),
        productService: it.productService || 'supply',
        unit: it.unit || '',
        description: it.description || '',
        quantity: Number(it.quantity) || 0,
        unitPrice: Number(it.unitPrice) || 0,
        discount: Number(it.discount) || 0,
        isRebate: !!it.isRebate,
        taxRateLabel: it.taxRateLabel || 'GST'
      };
    });
    if (!items.length) items = [blankLine()];
    var wh = warehouseById(inv.warehouseId);
    var co = inv.companyInfo || db.company || {};
    return {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      customerId: inv.customerId || '',
      billTo: inv.billTo || '',
      shipTo: inv.shipTo || '',
      shipVia: inv.shipVia || 'Greenwave Recycling Truck',
      shipDate: inv.shipDate || inv.invoiceDate || today(),
      paymentTerms: inv.paymentTerms || 'Net 15',
      reference: inv.notes || '',
      poReference: inv.poReference || '',
      fromLocation: (wh && wh.name) || 'Maple Ridge, BC',
      warehouseId: inv.warehouseId || null,
      province: wh ? wh.province : 'BC',
      termsDays: termsDays,
      invoiceDate: inv.invoiceDate || today(),
      dueDate: inv.dueDate || (inv.invoiceDate ? new Date(new Date(inv.invoiceDate).getTime() + termsDays * 864e5).toISOString().slice(0, 10) : today()),
      taxLabel: inv.taxLabel || 'GST @ 5%',
      taxRatePct: Number(inv.taxRate) || 5,
      companyInfo: {
        name: co.name || 'Greenwave Recycling Inc.',
        bn: co.bn || 'BN 751161951BC0001',
        gst: co.gst || '751161951RT0001',
        line1: co.line1 || '23394 Fisherman Rd',
        line2: co.line2 || 'Maple Ridge, BC V2W 1B9',
        email: co.email || 'sales@greenwaverecycling.ca',
        phone: co.phone || '6724720423'
      },
      paymentInstructions: inv.paymentInstructions || 'sales@greenwaverecycling.ca\n6724720423',
      notes: inv.notes || '',
      status: inv.status || 'draft',
      paymentStatus: inv.paymentStatus || 'unpaid',
      paidAt: inv.paidAt || null,
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
    var rate = (Number(inv.taxRatePct) || 0) / 100;
    var tax = Math.round(sub * rate * 100) / 100;
    return { subtotal: sub, tax: tax, total: Math.round((sub + tax) * 100) / 100 };
  }

  var currentInvoiceFilter = 'all';
  var invoiceSearchQuery = '';

  function updateInvoiceMetrics() {
    Api.getPaymentMetrics(warehouseId).then(function (metrics) {
      if (!metrics) return;
      var outEl = $('#kpiTotalOutstanding');
      if (outEl) outEl.textContent = moneyDollars(metrics.totalOutstanding);
      var monthEl = $('#kpiPaidThisMonth');
      if (monthEl) monthEl.textContent = moneyDollars(metrics.paidThisMonth);
      var unpEl = $('#kpiUnpaidCount');
      if (unpEl) unpEl.textContent = String(metrics.unpaidCount || 0);
      var penEl = $('#kpiPendingCount');
      if (penEl) penEl.textContent = String(metrics.pendingCount || 0);
    }).catch(function () {});
  }

  function showPaymentLinkModal(invId) {
    Api.getPaymentLink(invId).then(function (linkRes) {
      // Build the shareable link as a hash route (#pay/<token>), not the raw
      // /pay/<token> path: the hash never reaches the server, so the link
      // works on any static host (including local dev via serve.sh) without
      // depending on a server-side SPA rewrite rule. renderRoute() already
      // accepts both forms.
      var payToken = String(linkRes.paymentUrl || '').replace(/^\/?pay\//, '').split('?')[0];
      var shareUrl = window.location.origin + window.location.pathname + '#pay/' + payToken;
      openModal('Secure Customer Payment Link: #' + linkRes.invoiceNumber,
        '<p style="color:var(--ink-2);margin-bottom:12px">Share this secure payment link with the customer to collect payment online:</p>' +
        '<div style="margin-bottom:16px">' +
          '<input type="text" id="modalPayUrl" aria-label="Payment link URL" class="inv-bare-input" readonly value="' + esc(shareUrl) + '" style="background:var(--panel-2);padding:10px 12px;border:1px solid var(--line-2);border-radius:var(--r);font-family:var(--f-mono);font-size:13px;width:100%">' +
        '</div>' +
        '<div style="display:flex;gap:10px;justify-content:flex-end">' +
          '<button type="button" class="btn btn-secondary btn-sm" id="btnCopyPayLink">Copy Payment Link</button>' +
          '<a href="' + esc(shareUrl) + '" target="_blank" class="btn btn-primary btn-sm" style="text-decoration:none">Open Checkout Page</a>' +
        '</div>',
        function () { return Promise.resolve(); }
      );

      var copyBtn = $('#btnCopyPayLink');
      if (copyBtn) {
        copyBtn.onclick = function () {
          navigator.clipboard.writeText(shareUrl).then(function () {
            toast('Payment link copied to clipboard!');
          }).catch(function () {
            toast('Link copied: ' + shareUrl);
          });
        };
      }
    }).catch(function (err) { toast(err.message || 'Could not generate payment link.'); });
  }

  function showSendInvoiceModal(inv) {
    if (!inv) return;
    openModal('Send Invoice #' + inv.invoiceNumber + ' to Customer',
      '<p style="color:var(--ink-2);margin-bottom:12px">Send the invoice summary with the secure payment link directly to customer email:</p>' +
      field('recipientEmail', 'Customer Email', { type: 'email', required: true, value: (inv.companyInfo && inv.companyInfo.email) || '' }) +
      field('customMessage', 'Custom Message (Optional)', { type: 'textarea', placeholder: 'Thank you for your business. Please review and pay online.' }),
      function (fd) {
        if (!fd.recipientEmail) {
          toast('Please enter a customer recipient email.');
          return Promise.reject(new Error('Recipient email required'));
        }
        return Api.sendInvoiceEmail(inv.id, fd.recipientEmail, fd.customMessage).then(function (res) {
          toast('Invoice #' + inv.invoiceNumber + ' dispatched to ' + res.recipient);
          updateInvoiceMetrics();
        });
      }
    );
  }

  function renderInvoiceList() {
    loadingState('#invoiceList');
    updateInvoiceMetrics();

    Api.listInvoices({ warehouseId: warehouseId }).then(function (list) {
      invoiceListCache = list || [];
      var invList = $('#invoiceList');
      if (!invList) return;

      var filtered = invoiceListCache.filter(function (inv) {
        var pStatus = (inv.paymentStatus || 'unpaid').toLowerCase();
        if (currentInvoiceFilter === 'unpaid' && pStatus !== 'unpaid') return false;
        if (currentInvoiceFilter === 'pending' && pStatus !== 'pending') return false;
        if (currentInvoiceFilter === 'paid' && pStatus !== 'paid') return false;
        if (currentInvoiceFilter === 'failed' && pStatus !== 'failed') return false;
        if (currentInvoiceFilter === 'refunded' && pStatus !== 'refunded') return false;

        if (invoiceSearchQuery) {
          var q = invoiceSearchQuery.toLowerCase();
          var matchNum = String(inv.invoiceNumber || '').toLowerCase().indexOf(q) >= 0;
          var matchBill = String(inv.billTo || '').toLowerCase().indexOf(q) >= 0;
          var matchPo = String(inv.poReference || '').toLowerCase().indexOf(q) >= 0;
          if (!matchNum && !matchBill && !matchPo) return false;
        }
        return true;
      });

      if (!filtered.length) {
        invList.innerHTML = emptyState('doc', 'No matching invoices found',
          invoiceListCache.length ? 'No invoices match the current filter or search criteria.' : 'Create professional invoices with rebate lines, tax calculation, and free text fields matching the Invoice 1114 reference.',
          invoiceListCache.length ? null : 'New invoice', 'newInvoice');
        return;
      }

      invList.innerHTML = '<div class="card"><div class="tablewrap" tabindex="0" role="region" aria-label="Scrollable table"><table class="table"><thead><tr>' +
        '<th>Invoice #</th><th>Bill To</th><th>Date</th><th>Due Date</th><th class="num">Total</th><th>Currency</th><th>Status</th><th>Payment Status</th><th>Actions</th></tr></thead><tbody>' +
        filtered.slice().sort(function (a, b) { return String(b.invoiceNumber).localeCompare(String(a.invoiceNumber), undefined, { numeric: true }); })
        .map(function (inv) {
          var due = inv.dueDate || '', late = due && due < today() && inv.paymentStatus !== 'paid';
          var pStatus = (inv.paymentStatus || 'unpaid').toLowerCase();
          var pBadgeClass = pStatus === 'paid' ? 'badge-paid' :
            (pStatus === 'pending' ? 'badge-pending' :
            (pStatus === 'failed' ? 'badge-failed' :
            (pStatus === 'refunded' ? 'badge-refunded' : 'badge-unpaid')));
          var pLabel = pStatus === 'paid' ? 'PAID' :
            (pStatus === 'pending' ? 'PENDING' :
            (pStatus === 'failed' ? 'FAILED' :
            (pStatus === 'refunded' ? 'REFUNDED' : 'UNPAID')));

          return '<tr data-invoice-row="' + esc(inv.id) + '">' +
            '<td class="mono"><strong>#' + esc(inv.invoiceNumber) + '</strong></td>' +
            '<td>' + esc((inv.billTo || '').split('\n')[0] || '—') + '</td>' +
            '<td class="mono" style="font-size:13px">' + esc(inv.invoiceDate) + '</td>' +
            '<td class="mono" style="font-size:13px">' + esc(due || '—') + '</td>' +
            '<td class="num"><strong>' + moneyDollars(inv.total) + '</strong></td>' +
            '<td class="mono" style="font-size:12.5px;font-weight:600">' + esc(inv.currency || 'CAD') + '</td>' +
            '<td><span class="badge ' + (late ? 'badge-out' : (inv.status === 'draft' ? 'badge-transit' : 'badge-received')) + '">' + (late ? 'Overdue' : (inv.status === 'draft' ? 'Draft' : 'Open')) + '</span></td>' +
            '<td><span class="badge ' + pBadgeClass + '">' + pLabel + '</span></td>' +
            '<td>' +
              '<div style="display:flex;gap:6px;flex-wrap:nowrap">' +
                '<button type="button" class="btn ghost btn-sm btn-view-inv" data-view-inv="' + esc(inv.id) + '">View</button>' +
                '<button type="button" class="btn ghost btn-sm btn-pay-link" data-pay-link="' + esc(inv.id) + '" title="Get payment link"><svg style="width:13px;height:13px"><use href="#i-send"></use></svg> Link</button>' +
                '<button type="button" class="btn ghost btn-sm btn-send-inv" data-send-inv="' + esc(inv.id) + '" title="Send invoice email">Send</button>' +
                '<button type="button" class="btn ghost btn-sm" data-dupe="' + esc(inv.id) + '" title="Duplicate">Copy</button>' +
              '</div>' +
            '</td></tr>';
        }).join('') + '</tbody></table></div></div>';

      $$('.btn-view-inv').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var inv = invoiceListCache.filter(function (x) { return x.id === btn.dataset.viewInv; })[0];
          if (inv) {
            draft = invoiceToDraft(inv);
            editorViewMode = true;
            show('editor');
          }
        });
      });

      $$('.btn-pay-link').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          showPaymentLinkModal(btn.dataset.payLink);
        });
      });

      $$('.btn-send-inv').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var inv = invoiceListCache.filter(function (x) { return x.id === btn.dataset.sendInv; })[0];
          showSendInvoiceModal(inv);
        });
      });

      $$('[data-dupe]').forEach(function (b) {
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          Api.duplicateInvoice(b.dataset.dupe).then(function (saved) {
            draft = invoiceToDraft(saved);
            editorViewMode = false;
            toast('Duplicated as invoice ' + saved.invoiceNumber + '.');
            show('editor');
          }).catch(function (err) { toast(err.message || 'Could not duplicate invoice.'); });
        });
      });
    }).catch(function (err) { apiErrorState('#invoiceList', err); });
  }

  // Setup Invoices Filter Tabs & Search
  function setupInvoiceFilters() {
    $$('#invoiceFilterTabs [data-inv-filter]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('#invoiceFilterTabs [data-inv-filter]').forEach(function (b) {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        currentInvoiceFilter = btn.dataset.invFilter;
        renderInvoiceList();
      });
    });

    var sInput = $('#invoiceSearch');
    if (sInput) {
      sInput.addEventListener('input', function () {
        invoiceSearchQuery = sInput.value.trim();
        renderInvoiceList();
      });
    }
  }

  /* ==========================================================================
     Authoritative Invoice Editor & Print Layout (Aligned with Invoice 1114.pdf)

     Two rendering modes share one draft object:
       - Document mode (editorViewMode=true) — read-only, print-ready
         invoice for a saved record opened via "View".
       - Editor mode (editorViewMode=false) — the input/textarea form
         used to create a new invoice or amend an existing one.
     ========================================================================== */
  function renderEditor() {
    if (!draft) draft = newDraft();
    var edTitle = $('#edTitle');
    if (edTitle) {
      edTitle.textContent = editorViewMode
        ? 'Invoice #' + (draft.invoiceNumber || '')
        : (draft.invoiceNumber ? 'Edit Invoice #' + draft.invoiceNumber : 'New Invoice');
    }

    var edPrint = $('#edPrint');
    if (edPrint) edPrint.onclick = function () { window.print(); };

    var canShowInvoiceActions = editorViewMode && !!draft.id;
    var edPayLink = $('#edPayLink');
    if (edPayLink) {
      edPayLink.hidden = !canShowInvoiceActions;
      edPayLink.onclick = function () { showPaymentLinkModal(draft.id); };
    }
    var edSendInv = $('#edSendInv');
    if (edSendInv) {
      edSendInv.hidden = !canShowInvoiceActions;
      edSendInv.onclick = function () { showSendInvoiceModal(draft); };
    }

    var edSave = $('#edSave');
    if (editorViewMode) {
      if (edSave) {
        edSave.disabled = false;
        edSave.innerHTML = '<svg><use href="#i-edit"></use></svg>Edit Invoice';
        edSave.onclick = function () { editorViewMode = false; renderEditor(); };
      }
      renderInvoiceDocumentView();
    } else {
      if (edSave) {
        edSave.disabled = false;
        edSave.innerHTML = '<svg><use href="#i-check"></use></svg>Save Invoice';
      }
      renderInvoiceEditorForm();
    }
  }

  /* Read-only, professional invoice document — used for the "View" flow
     and for print/PDF output. No inputs, textareas, or edit affordances. */
  function renderInvoiceDocumentView() {
    var co = draft.companyInfo || {};
    var tot = totalsLocal(draft);
    var pStatus = paymentStatusMeta(draft.paymentStatus);

    var itemsHtml = draft.items.map(function (it, idx) {
      var lineAmt = lineAmountDollars(it);
      return '<tr>' +
        '<td class="mono" style="font-size:12px;color:var(--muted)">' + (idx + 1) + '</td>' +
        '<td class="mono">' + esc(it.serviceDate || draft.invoiceDate) + '</td>' +
        '<td>' + esc(it.productService || '—') + '</td>' +
        '<td>' + esc(it.unit || '—') + '</td>' +
        '<td>' + esc(it.description || '—') + '</td>' +
        '<td class="num mono">' + num(it.quantity, 3) + '</td>' +
        '<td class="num mono">' + moneyDollars(it.unitPrice) + '</td>' +
        '<td class="num mono" style="font-weight:600">' + moneyDollars(lineAmt) + '</td>' +
        '<td class="inv-doc-tax">' + esc(it.taxRateLabel || 'GST') + '</td>' +
      '</tr>';
    }).join('');

    var html =
      '<div class="invoice-doc-container">' +
        '<div class="invoice-page-1114 invoice-doc-readonly">' +

          '<div class="inv-1114-header">' +
            '<div class="inv-1114-co-left">' +
              '<h1 class="inv-1114-title">INVOICE</h1>' +
              '<div class="inv-doc-text" style="font-weight:700">' + esc(co.name || 'Greenwave Recycling Inc.') + '</div>' +
              '<div class="inv-doc-text">' + esc(co.bn || '') + '</div>' +
              '<div style="font-size:11.5px;color:#666666;margin-top:3px">GST/HST Registration No.</div>' +
              '<div class="inv-doc-text">' + esc(co.gst || '') + '</div>' +
            '</div>' +

            '<div class="inv-1114-co-mid">' +
              '<div style="height:34px"></div>' +
              '<div class="inv-doc-text">' + esc(co.line1 || '') + '</div>' +
              '<div class="inv-doc-text">' + esc(co.line2 || '') + '</div>' +
              '<div class="inv-doc-text">' + esc(co.email || '') + '</div>' +
              '<div class="inv-doc-text">' + esc(co.phone || '') + '</div>' +
            '</div>' +

            '<div class="inv-1114-logo-wrap">' +
              '<img src="assets/logo.png" alt="Greenwave Logo" class="inv-1114-logo-img">' +
              '<div class="inv-1114-logo-sub">greenwave recycling</div>' +
            '</div>' +
          '</div>' +

          '<div class="inv-1114-banner">' +
            '<div class="inv-1114-banner-col">' +
              '<label>Bill to</label>' +
              '<div class="inv-doc-address">' + (draft.billTo ? esc(draft.billTo) : '<span class="inv-doc-muted">—</span>') + '</div>' +
            '</div>' +
            '<div class="inv-1114-banner-col">' +
              '<label>Ship to</label>' +
              '<div class="inv-doc-address">' + (draft.shipTo ? esc(draft.shipTo) : '<span class="inv-doc-muted">—</span>') + '</div>' +
            '</div>' +
          '</div>' +

          '<div class="inv-1114-meta-grid">' +
            '<div class="inv-1114-meta-block">' +
              '<h4>Shipping info</h4>' +
              '<div class="inv-1114-meta-row"><label>Ship via:</label><span>' + esc(draft.shipVia || '—') + '</span></div>' +
              '<div class="inv-1114-meta-row"><label>Ship date:</label><span>' + esc(draft.shipDate || '—') + '</span></div>' +
            '</div>' +

            '<div class="inv-1114-meta-block">' +
              '<h4>Invoice details</h4>' +
              '<div class="inv-1114-meta-row"><label>Invoice no.:</label><span class="mono" style="font-weight:700">' + esc(draft.invoiceNumber || '—') + '</span></div>' +
              '<div class="inv-1114-meta-row"><label>Terms:</label><span>' + esc(draft.paymentTerms || '—') + '</span></div>' +
              '<div class="inv-1114-meta-row"><label>Invoice date:</label><span>' + esc(draft.invoiceDate || '—') + '</span></div>' +
              '<div class="inv-1114-meta-row"><label>Due date:</label><span>' + esc(draft.dueDate || '—') + '</span></div>' +
              (draft.id ? (
                '<div class="inv-1114-meta-row"><label>Status:</label><span class="badge ' + pStatus.cls + '">' + pStatus.label + '</span></div>' +
                (draft.paymentStatus === 'paid' && draft.paidAt ? '<div class="inv-1114-meta-row"><label></label><span class="inv-doc-paid-date">Paid on: ' + ddmmyyyy(draft.paidAt) + '</span></div>' : '')
              ) : '') +
            '</div>' +
          '</div>' +

          '<div class="inv-1114-table-wrap">' +
            '<table class="inv-1114-table">' +
              '<thead>' +
                '<tr>' +
                  '<th style="width:30px">#</th>' +
                  '<th style="width:110px">Service Date</th>' +
                  '<th style="width:120px">Product/service</th>' +
                  '<th style="width:60px">Unit</th>' +
                  '<th>Description</th>' +
                  '<th class="num" style="width:65px">Qty</th>' +
                  '<th class="num" style="width:85px">Rate ($)</th>' +
                  '<th class="num" style="width:90px">Amount ($)</th>' +
                  '<th style="width:60px">Tax</th>' +
                '</tr>' +
              '</thead>' +
              '<tbody>' + (itemsHtml || '<tr><td colspan="9" style="text-align:center;color:var(--muted)">No line items</td></tr>') + '</tbody>' +
            '</table>' +
          '</div>' +

          '<div class="inv-1114-bottom-grid">' +
            '<div class="inv-1114-instructions-col">' +
              '<h4>Payment instructions</h4>' +
              '<div class="inv-doc-text-block">' + (draft.paymentInstructions ? esc(draft.paymentInstructions) : '<span class="inv-doc-muted">—</span>') + '</div>' +
              '<h4 style="margin-top:18px">Additional notes / memo</h4>' +
              '<div class="inv-doc-text-block">' + (draft.notes ? esc(draft.notes) : '<span class="inv-doc-muted">—</span>') + '</div>' +
            '</div>' +

            '<div class="inv-1114-totals-col">' +
              '<div class="inv-1114-totals-row">' +
                '<span>Subtotal</span>' +
                '<span class="mono">' + moneyDollars(tot.subtotal) + '</span>' +
              '</div>' +
              '<div class="inv-1114-totals-row">' +
                '<span>' + esc(draft.taxLabel || 'GST @ 5%') + '</span>' +
                '<span class="mono">' + moneyDollars(tot.tax) + '</span>' +
              '</div>' +
              '<div class="inv-1114-totals-row inv-1114-total-due-row">' +
                '<span>TOTAL</span>' +
                '<span class="mono">' + moneyDollars(tot.total) + '</span>' +
              '</div>' +
            '</div>' +
          '</div>' +

          '<div class="inv-1114-footer">' +
            '<div class="inv-1114-footer-name">' + esc(co.name || 'Greenwave Recycling Inc.') + '</div>' +
            '<div class="inv-1114-footer-contact">' +
              esc(co.line1 || '') + (co.line2 ? ', ' + esc(co.line2) : '') +
              (co.email ? ' &middot; ' + esc(co.email) : '') +
              (co.phone ? ' &middot; ' + esc(co.phone) : '') +
            '</div>' +
          '</div>' +

        '</div>' +
      '</div>';

    var edBody = $('#editorBody');
    if (!edBody) return;
    edBody.innerHTML = html;
  }

  /* Editable invoice form — inputs/textareas live here only, never in the
     read-only document view above. */
  function renderInvoiceEditorForm() {
    var co = draft.companyInfo || {};
    var tot = totalsLocal(draft);
    var pStatus = paymentStatusMeta(draft.paymentStatus);

    var html =
      '<div class="invoice-doc-container">' +
        '<div class="invoice-page-1114">' +

          /* 1. TOP HEADER: 3-column layout (Left Title & Registration, Mid Address/Phone, Right Logo) */
          '<div class="inv-1114-header">' +
            '<div class="inv-1114-co-left">' +
              '<h1 class="inv-1114-title">INVOICE</h1>' +
              '<input type="text" id="edCoName" class="inv-bare-input" style="font-weight:700" value="' + esc(co.name || 'Greenwave Recycling Inc.') + '" placeholder="Company Name">' +
              '<input type="text" id="edCoBn" class="inv-bare-input" value="' + esc(co.bn || 'BN 751161951BC0001') + '" placeholder="BN Number">' +
              '<div style="font-size:11.5px;color:#666666;margin-top:3px">GST/HST Registration No.</div>' +
              '<input type="text" id="edCoGst" class="inv-bare-input" value="' + esc(co.gst || '751161951RT0001') + '" placeholder="GST/HST Registration">' +
            '</div>' +

            '<div class="inv-1114-co-mid">' +
              '<div style="height:34px"></div>' +
              '<input type="text" id="edCoLine1" class="inv-bare-input" value="' + esc(co.line1 || '23394 Fisherman Rd') + '" placeholder="Address Line 1">' +
              '<input type="text" id="edCoLine2" class="inv-bare-input" value="' + esc(co.line2 || 'Maple Ridge, BC V2W 1B9') + '" placeholder="City, Province, Postal">' +
              '<input type="text" id="edCoEmail" class="inv-bare-input" value="' + esc(co.email || 'sales@greenwaverecycling.ca') + '" placeholder="Sales Email">' +
              '<input type="text" id="edCoPhone" class="inv-bare-input" value="' + esc(co.phone || '6724720423') + '" placeholder="Phone Number">' +
            '</div>' +

            '<div class="inv-1114-logo-wrap">' +
              '<img src="assets/logo.png" alt="Greenwave Logo" class="inv-1114-logo-img">' +
              '<div class="inv-1114-logo-sub">greenwave recycling</div>' +
            '</div>' +
          '</div>' +

          /* 2. BILL TO & SHIP TO SHADED BANNER */
          '<div class="inv-1114-banner">' +
            '<div class="inv-1114-banner-col">' +
              '<label>Bill to</label>' +
              '<textarea id="edBill" rows="3" placeholder="Customer name and billing address">' + esc(draft.billTo) + '</textarea>' +
            '</div>' +
            '<div class="inv-1114-banner-col">' +
              '<label>Ship to</label>' +
              '<textarea id="edShip" rows="3" placeholder="Customer shipping address">' + esc(draft.shipTo) + '</textarea>' +
            '</div>' +
          '</div>' +

          /* 3. SHIPPING INFO & INVOICE DETAILS */
          '<div class="inv-1114-meta-grid">' +
            '<div class="inv-1114-meta-block">' +
              '<h4>Shipping info</h4>' +
              '<div class="inv-1114-meta-row"><label>Ship via:</label><input type="text" id="edShipVia" class="inv-1114-meta-input" value="' + esc(draft.shipVia || 'Greenwave Recycling Truck') + '"></div>' +
              '<div class="inv-1114-meta-row"><label>Ship date:</label><input type="date" id="edShipDate" class="inv-1114-meta-input" value="' + esc(draft.shipDate || draft.invoiceDate || today()) + '"></div>' +
            '</div>' +

            '<div class="inv-1114-meta-block">' +
              '<h4>Invoice details</h4>' +
              '<div class="inv-1114-meta-row"><label>Invoice no.:</label><span class="mono" style="font-weight:700">' + esc(draft.invoiceNumber || '1115 (Assigned)') + '</span></div>' +
              '<div class="inv-1114-meta-row"><label>Terms:</label><input type="text" id="edTerms" class="inv-1114-meta-input" value="' + esc(draft.paymentTerms || 'Net 15') + '"></div>' +
              '<div class="inv-1114-meta-row"><label>Invoice date:</label><input type="date" id="edDate" class="inv-1114-meta-input" value="' + esc(draft.invoiceDate) + '"></div>' +
              '<div class="inv-1114-meta-row"><label>Due date:</label><input type="date" id="edDueDate" class="inv-1114-meta-input" value="' + esc(draft.dueDate) + '"></div>' +
              (draft.id ? '<div class="inv-1114-meta-row"><label>Status:</label><span class="badge ' + pStatus.cls + '">' + pStatus.label + '</span></div>' : '') +
            '</div>' +
          '</div>' +

          /* 4. LINE ITEMS TABLE */
          '<div class="inv-1114-table-wrap">' +
            '<table class="inv-1114-table" id="edItemsTable">' +
              '<thead>' +
                '<tr>' +
                  '<th style="width:30px">#</th>' +
                  '<th style="width:110px">Service Date</th>' +
                  '<th style="width:120px">Product/service</th>' +
                  '<th style="width:60px">Unit</th>' +
                  '<th>Description</th>' +
                  '<th class="num" style="width:65px">Qty</th>' +
                  '<th class="num" style="width:85px">Rate ($)</th>' +
                  '<th class="num" style="width:90px">Amount ($)</th>' +
                  '<th style="width:60px">Tax</th>' +
                  '<th style="width:35px" class="noprint"></th>' +
                '</tr>' +
              '</thead>' +
              '<tbody id="edLinesWrap">' +
                draft.items.map(function (it, idx) {
                  var lineAmt = lineAmountDollars(it);
                  return '<tr data-line="' + idx + '">' +
                    '<td class="mono" style="font-size:12px;color:var(--muted)">' + (idx + 1) + '</td>' +
                    '<td><input type="date" class="ed-sdate" value="' + esc(it.serviceDate || draft.invoiceDate) + '"></td>' +
                    '<td><input type="text" class="ed-pservice" value="' + esc(it.productService || 'supply') + '" placeholder="e.g. supply / service"></td>' +
                    '<td><input type="text" class="ed-unit" value="' + esc(it.unit || '') + '" placeholder="kg / box"></td>' +
                    '<td><input type="text" class="ed-desc" value="' + esc(it.description || '') + '" placeholder="Item description"></td>' +
                    '<td><input type="number" step="any" class="ed-qty num" value="' + (it.quantity != null ? it.quantity : 1) + '"></td>' +
                    '<td><input type="number" step="0.01" class="ed-price num" value="' + (it.unitPrice != null ? it.unitPrice : 0) + '"></td>' +
                    '<td class="num mono ed-line-amount" style="font-weight:600">' + moneyDollars(lineAmt) + '</td>' +
                    '<td><input type="text" class="ed-taxlabel" value="' + esc(it.taxRateLabel || 'GST') + '" style="width:50px"></td>' +
                    '<td class="noprint"><button type="button" class="iconbtn ed-del-line" title="Delete line"><svg><use href="#i-trash"></use></svg></button></td>' +
                  '</tr>';
                }).join('') +
              '</tbody>' +
            '</table>' +
          '</div>' +

          '<div class="noprint" style="margin-top:8px">' +
            '<button type="button" class="btn ghost btn-sm" id="edAddLine"><svg><use href="#i-plus"></use></svg>Add Line</button>' +
          '</div>' +

          /* 5. BOTTOM SECTION: Payment Instructions & Authoritative Summary */
          '<div class="inv-1114-bottom-grid">' +
            '<div class="inv-1114-instructions-col">' +
              '<h4>Payment instructions:</h4>' +
              '<textarea id="edPayInst" class="inv-1114-instructions-area" rows="4">' + esc(draft.paymentInstructions || 'sales@greenwaverecycling.ca\n6724720423') + '</textarea>' +
              '<div style="margin-top:14px"><label style="font-size:12px;font-weight:600;color:var(--muted)">Additional Notes / Memo</label>' +
              '<textarea id="edNotes" class="inv-1114-instructions-area" rows="2" placeholder="Internal/Customer notes">' + esc(draft.notes || '') + '</textarea></div>' +
            '</div>' +

            '<div class="inv-1114-totals-col">' +
              '<div class="inv-1114-totals-row">' +
                '<span>Subtotal:</span>' +
                '<span class="mono" id="edSubtotalVal" style="font-weight:600">' + moneyDollars(tot.subtotal) + '</span>' +
              '</div>' +
              '<div class="inv-1114-totals-row">' +
                '<span id="edTaxLabelStr">' + esc(draft.taxLabel || 'GST @ 5%') + ' on ' + moneyDollars(tot.subtotal) + ':</span>' +
                '<span class="mono" id="edTaxVal" style="font-weight:600">' + moneyDollars(tot.tax) + '</span>' +
              '</div>' +
              '<div class="inv-1114-totals-row inv-1114-total-due-row">' +
                '<span>Total:</span>' +
                '<span class="mono" id="edTotalVal" style="font-weight:700;font-size:16px">' + moneyDollars(tot.total) + '</span>' +
              '</div>' +
            '</div>' +
          '</div>' +

        '</div>' +
      '</div>';

    var edBody = $('#editorBody');
    if (!edBody) return;
    edBody.innerHTML = html;

    var syncDraftValues = function () {
      draft.billTo = ($('#edBill') || {}).value || '';
      draft.shipTo = ($('#edShip') || {}).value || '';
      draft.shipVia = ($('#edShipVia') || {}).value || 'Greenwave Recycling Truck';
      draft.shipDate = ($('#edShipDate') || {}).value || today();
      draft.paymentTerms = ($('#edTerms') || {}).value || 'Net 15';
      draft.invoiceDate = ($('#edDate') || {}).value || today();
      draft.dueDate = ($('#edDueDate') || {}).value || today();
      draft.paymentInstructions = ($('#edPayInst') || {}).value || '';
      draft.notes = ($('#edNotes') || {}).value || '';

      var coName = ($('#edCoName') || {}).value;
      var coBn = ($('#edCoBn') || {}).value;
      var coGst = ($('#edCoGst') || {}).value;
      var coLine1 = ($('#edCoLine1') || {}).value;
      var coLine2 = ($('#edCoLine2') || {}).value;
      var coEmail = ($('#edCoEmail') || {}).value;
      var coPhone = ($('#edCoPhone') || {}).value;

      draft.companyInfo = {
        name: coName || 'Greenwave Recycling Inc.',
        bn: coBn || 'BN 751161951BC0001',
        gst: coGst || '751161951RT0001',
        line1: coLine1 || '23394 Fisherman Rd',
        line2: coLine2 || 'Maple Ridge, BC V2W 1B9',
        email: coEmail || 'sales@greenwaverecycling.ca',
        phone: coPhone || '6724720423'
      };

      $$('#edLinesWrap tr').forEach(function (row) {
        var idx = Number(row.dataset.line);
        if (draft.items[idx]) {
          draft.items[idx].serviceDate = (row.querySelector('.ed-sdate') || {}).value || draft.invoiceDate;
          draft.items[idx].productService = (row.querySelector('.ed-pservice') || {}).value || 'supply';
          draft.items[idx].unit = (row.querySelector('.ed-unit') || {}).value || '';
          draft.items[idx].description = (row.querySelector('.ed-desc') || {}).value || '';
          draft.items[idx].quantity = parseQty((row.querySelector('.ed-qty') || {}).value);
          draft.items[idx].unitPrice = parseQty((row.querySelector('.ed-price') || {}).value);
          draft.items[idx].taxRateLabel = (row.querySelector('.ed-taxlabel') || {}).value || 'GST';

          var amtEl = row.querySelector('.ed-line-amount');
          if (amtEl) amtEl.textContent = moneyDollars(lineAmountDollars(draft.items[idx]));
        }
      });

      var currentTot = totalsLocal(draft);
      var subEl = $('#edSubtotalVal');
      if (subEl) subEl.textContent = moneyDollars(currentTot.subtotal);
      var taxLabelStr = $('#edTaxLabelStr');
      if (taxLabelStr) taxLabelStr.textContent = esc(draft.taxLabel || 'GST') + ' on ' + moneyDollars(currentTot.subtotal) + ':';
      var taxEl = $('#edTaxVal');
      if (taxEl) taxEl.textContent = moneyDollars(currentTot.tax);
      var totEl = $('#edTotalVal');
      if (totEl) totEl.textContent = moneyDollars(currentTot.total);
    };

    $$('#editorBody input, #editorBody textarea').forEach(function (inp) {
      inp.addEventListener('input', syncDraftValues);
    });

    var addLineBtn = $('#edAddLine');
    if (addLineBtn) {
      addLineBtn.addEventListener('click', function () {
        draft.items.push(blankLine());
        renderEditor();
      });
    }

    $$('.ed-del-line').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var row = btn.closest('tr');
        var idx = Number(row.dataset.line);
        draft.items.splice(idx, 1);
        if (!draft.items.length) draft.items.push(blankLine());
        renderEditor();
      });
    });

    var doSave = function () {
      syncDraftValues();

      var payload = {
        warehouseId: draft.warehouseId || warehouseId,
        invoiceDate: draft.invoiceDate || today(),
        dueDate: draft.dueDate || today(),
        billTo: draft.billTo || '',
        shipTo: draft.shipTo || '',
        shipVia: draft.shipVia || 'Greenwave Recycling Truck',
        shipDate: draft.shipDate || draft.invoiceDate || today(),
        paymentTerms: draft.paymentTerms || 'Net 15',
        poReference: draft.poReference || '',
        companyInfo: draft.companyInfo,
        paymentInstructions: draft.paymentInstructions,
        notes: draft.notes || '',
        taxLabel: draft.taxLabel || 'GST @ 5%',
        taxRate: Number(draft.taxRatePct) || 5,
        items: draft.items.map(function (it) {
          return {
            serviceDate: it.serviceDate || draft.invoiceDate,
            productService: it.productService || 'supply',
            description: it.description || 'General Service',
            unit: it.unit || '',
            taxRateLabel: it.taxRateLabel || 'GST',
            quantity: Number(it.quantity) || 1,
            unitPrice: Number(it.unitPrice) || 0,
            discount: Number(it.discount) || 0,
            isRebate: !!it.isRebate
          };
        })
      };

      var btnSave = $('#edSave');
      if (btnSave) { btnSave.disabled = true; btnSave.textContent = 'Saving…'; }

      var resetButton = function () {
        if (btnSave) { btnSave.disabled = false; btnSave.innerHTML = '<svg><use href="#i-check"></use></svg>Save Invoice'; }
      };

      var req = draft.id ? Api.updateInvoice(draft.id, payload) : Api.createInvoice(payload);
      req.then(function (res) {
        resetButton();
        toast('Invoice #' + res.invoiceNumber + ' created successfully.');
        draft = null;
        show('invoices');
      }).catch(function (err) {
        resetButton();
        toast(err.message || 'Unable to save invoice. Please check all fields.');
      });
    };

    var edSave = $('#edSave'); if (edSave) edSave.onclick = doSave;
  }

  function renderCustomers() {
    loadingState('#customerBody');
    Api.listCustomers(warehouseId).then(function (list) {
      var cBody = $('#customerBody');
      if (!cBody) return;
      if (!list.length) {
        cBody.innerHTML = emptyState('users', 'No customers saved yet',
          'Save customer addresses and billing information.', 'Add customer', 'newCustomer');
        return;
      }
      cBody.innerHTML = '<div class="card"><div class="tablewrap" tabindex="0" role="region" aria-label="Scrollable table"><table class="table"><thead><tr>' +
        '<th>Customer Name</th><th>Bill To</th><th>Ship To</th><th>Email</th></tr></thead><tbody>' +
        list.map(function (c) {
          return '<tr><td><strong>' + esc(c.name) + '</strong></td><td>' + esc((c.billTo || '').split('\n')[0] || '—') + '</td>' +
            '<td>' + esc((c.shipTo || '').split('\n')[0] || '—') + '</td><td>' + esc(c.email || '—') + '</td></tr>';
        }).join('') + '</tbody></table></div></div>';
    }).catch(function (err) { apiErrorState('#customerBody', err); });
  }

  function productDivisionFacilityFields(currentDivision, facilityName) {
    return field('facilityDisplay', 'Facility', { value: facilityName || '—', readonly: true }) +
      field('division', 'Division', {
        type: 'select', required: true,
        value: currentDivision || entity,
        options: [
          { value: 'recycling', label: 'Recycling' },
          { value: 'healthcare', label: 'Healthcare' }
        ]
      });
  }

  function openEditProductModal(mat) {
    var w = warehouseById(mat.warehouseId) || warehouse();
    openModal('Edit ' + (mat.division === 'healthcare' ? 'Product' : 'Material'),
      field('name', 'Product', { required: true, value: mat.name }) +
      field('category', 'Category', { value: mat.category || '' }) +
      productDivisionFacilityFields(mat.division, w ? w.name : (mat.warehouseId ? 'Unknown facility' : 'All facilities (shared)')) +
      field('description', 'Description (Optional)', { type: 'textarea', value: mat.description || '' }) +
      field('active', 'Status', {
        type: 'select',
        value: mat.active === false ? 'false' : 'true',
        options: [
          { value: 'true', label: 'Active' },
          { value: 'false', label: 'Inactive' }
        ]
      }),
      function (fd) {
        return Api.updateMaterial(mat.id, {
          name: fd.name, category: fd.category, description: fd.description,
          division: fd.division, active: fd.active === 'true'
        }).then(function () { toast('Catalog item updated.'); renderProducts(); });
      });
  }

  function openDeleteProductModal(mat) {
    var w = warehouseById(mat.warehouseId);
    var warehouseLabel = w ? w.name : 'All facilities (shared)';
    var divisionLabel = mat.division === 'healthcare' ? 'Healthcare' : 'Recycling';

    var bodyHtml =
      '<div class="delete-confirm">' +
        '<p class="delete-confirm-lead">This will permanently remove the product from the catalog. This cannot be undone.</p>' +
        '<dl class="delete-confirm-details">' +
          '<div><dt>Product</dt><dd>' + esc(mat.name) + '</dd></div>' +
          '<div><dt>Warehouse</dt><dd>' + esc(warehouseLabel) + '</dd></div>' +
          '<div><dt>Division</dt><dd>' + esc(divisionLabel) + '</dd></div>' +
        '</dl>' +
        '<div class="global-access-warning">' +
          '<svg style="width:14px;height:14px;flex:none"><use href="#i-alert"></use></svg>' +
          'This action permanently removes the product from the catalog.' +
        '</div>' +
      '</div>';

    openModal('Delete Product?', bodyHtml, function () {
      return Api.deleteMaterial(mat.id).then(function () {
        toast('Product deleted successfully.');
        renderProducts();
      });
    }, { okLabel: 'Delete Product', okClass: 'danger', savingLabel: 'Deleting…' });
  }

  function renderProducts() {
    var pTitle = $('#prodTitle');
    if (pTitle) pTitle.textContent = isRecycling() ? 'Materials Catalog' : 'Healthcare Products';
    var pSub = $('#prodSub');
    if (pSub) pSub.textContent = isRecycling() ? 'Recycling materials tracked for this facility.' : 'Healthcare products tracked for this facility.';
    loadingState('#productBody');
    var w = warehouse();
    if (!w) { var pBody0 = $('#productBody'); if (pBody0) pBody0.innerHTML = ''; return; }
    Api.listMaterials({ warehouseId: w.id, division: entity, includeInactive: true }).then(function (all) {
      var list = all;
      var pBody = $('#productBody');
      if (!pBody) return;
      if (!list.length) {
        pBody.innerHTML = emptyState('tag', 'No catalog items',
          'Add materials or products to track inventory.', 'Add material', 'newProduct');
        return;
      }
      pBody.innerHTML = '<div class="card"><div class="tablewrap" tabindex="0" role="region" aria-label="Scrollable table"><table class="table"><thead><tr>' +
        '<th>Product / Material</th><th>Category</th><th>Description</th><th>Division</th><th>Status</th><th>Actions</th></tr></thead><tbody>' +
        list.map(function (m) {
          var divLabel = m.division === 'healthcare' ? 'Healthcare' : 'Recycling';
          var statusLabel = m.active === false ? 'Inactive' : 'Active';
          var statusCls = m.active === false ? 'badge-inactive' : 'badge-active';
          return '<tr><td><strong>' + esc(m.name) + '</strong></td><td>' + esc(m.category || '—') + '</td>' +
            '<td style="color:var(--muted)">' + esc(m.description || '—') + '</td>' +
            '<td>' + esc(divLabel) + '</td>' +
            '<td><span class="badge ' + statusCls + '">' + statusLabel + '</span></td>' +
            '<td><div style="display:flex;gap:6px">' +
              '<button type="button" class="btn ghost btn-sm" data-edit-material="' + esc(m.id) + '">Edit</button>' +
              (isAdmin() ? '<button type="button" class="btn btn-sm danger" data-delete-material="' + esc(m.id) + '">Delete Product</button>' : '') +
            '</div></td></tr>';
        }).join('') + '</tbody></table></div></div>';

      $$('[data-edit-material]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var mat = list.filter(function (x) { return x.id === btn.dataset.editMaterial; })[0];
          if (mat) openEditProductModal(mat);
        });
      });

      $$('[data-delete-material]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var mat = list.filter(function (x) { return x.id === btn.dataset.deleteMaterial; })[0];
          if (mat) openDeleteProductModal(mat);
        });
      });
    }).catch(function (err) { apiErrorState('#productBody', err); });
  }

  function formatLastLogin(dateStr) {
    if (!dateStr) return '<span style="color:var(--muted)">Never</span>';
    try {
      var d = new Date(dateStr);
      var now = new Date();
      var diffMs = now - d;
      var diffMins = Math.floor(diffMs / (1000 * 60));
      if (diffMins < 1) return '<span style="color:var(--good)">Just now</span>';
      if (diffMins < 60) return diffMins + 'm ago';
      var diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return diffHours + 'h ago';
      var diffDays = Math.floor(diffHours / 24);
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return diffDays + 'd ago';
      return d.toLocaleDateString();
    } catch (e) {
      return String(dateStr).slice(0, 10);
    }
  }

  var staffSearchQuery = '';
  var staffRoleFilter = '';

  function renderStaff() {
    if (!isAdmin()) return;
    loadingState('#staffBody');
    Promise.all([
      Api.listUsers(),
      Api.listWarehouses(false)
    ]).then(function (res) {
      var users = res[0] || [];
      var allWhs = deduplicateWarehouses(res[1] || []);
      usersCache = users;
      var sBody = $('#staffBody');
      if (!sBody) return;

      var filteredUsers = users.slice();
      if (staffRoleFilter) {
        filteredUsers = filteredUsers.filter(function (u) { return (u.role || '').toLowerCase() === staffRoleFilter.toLowerCase(); });
      }
      if (staffSearchQuery) {
        var sq = staffSearchQuery.toLowerCase();
        filteredUsers = filteredUsers.filter(function (u) {
          return (u.name || u.fullName || '').toLowerCase().indexOf(sq) >= 0 ||
                 (u.email || '').toLowerCase().indexOf(sq) >= 0;
        });
      }

      var roleCounts = { admin: 0, manager: 0, staff: 0, driver: 0 };
      users.forEach(function (u) {
        var r = (u.role || 'staff').toLowerCase();
        if (roleCounts[r] !== undefined) roleCounts[r]++;
      });

      var toolbarHtml = '<div class="inven-toolbar" style="margin-bottom:14px">' +
        '<div class="inven-tabs" id="staffFilterTabs" role="tablist">' +
          '<button type="button" class="inven-tab ' + (!staffRoleFilter ? 'active' : '') + '" data-staff-filter="" role="tab">All Staff (' + users.length + ')</button>' +
          '<button type="button" class="inven-tab ' + (staffRoleFilter === 'admin' ? 'active' : '') + '" data-staff-filter="admin" role="tab">Admins (' + roleCounts.admin + ')</button>' +
          '<button type="button" class="inven-tab ' + (staffRoleFilter === 'manager' ? 'active' : '') + '" data-staff-filter="manager" role="tab">Managers (' + roleCounts.manager + ')</button>' +
          '<button type="button" class="inven-tab ' + (staffRoleFilter === 'staff' ? 'active' : '') + '" data-staff-filter="staff" role="tab">Staff (' + roleCounts.staff + ')</button>' +
          '<button type="button" class="inven-tab ' + (staffRoleFilter === 'driver' ? 'active' : '') + '" data-staff-filter="driver" role="tab">Drivers (' + roleCounts.driver + ')</button>' +
        '</div>' +
        '<div class="inven-filters">' +
          '<div class="search-wrap">' +
            '<svg class="search-ico"><use href="#i-search"></use></svg>' +
            '<input type="search" id="staffSearchInput" placeholder="Search staff by name or email..." value="' + esc(staffSearchQuery) + '">' +
          '</div>' +
        '</div>' +
      '</div>';

      var rowsHtml = filteredUsers.map(function (u) {
        var assignedWhNames = (u.warehouses && u.warehouses.length)
          ? deduplicateWarehouses(u.warehouses).map(function (w) {
              return '<span class="audit-wh-badge">' + esc(w.name) + '</span>';
            }).join(' ')
          : (u.role === 'admin' ? '<span class="perm-chip" style="background:#E0F2FE;color:#0369A1;border-color:#BAE6FD">🌐 All Facilities (Global Admin)</span>' : '<span style="color:var(--crit);font-size:12px;font-weight:600">No Facilities Assigned</span>');
        var createdDate = u.createdAt ? String(u.createdAt).slice(0, 10) : '—';
        var uStatus = (u.status || 'active').toLowerCase();
        var statusBadgeClass = uStatus === 'active' ? 'badge-active' : (uStatus === 'suspended' ? 'badge-failed' : 'badge-inactive');
        var statusLabel = uStatus.charAt(0).toUpperCase() + uStatus.slice(1);
        var lastLoginHtml = formatLastLogin(u.lastLoginAt);

        return '<tr data-user-id="' + esc(u.id) + '">' +
          '<td><strong>' + esc(u.name || u.fullName) + '</strong></td>' +
          '<td><span class="mono" style="font-size:13px">' + esc(u.email) + '</span></td>' +
          '<td><span class="badge ' + (u.role === 'admin' ? 'badge-in' : (u.role === 'manager' ? 'badge-transit' : 'badge-received')) + '">' + esc(u.role) + '</span></td>' +
          '<td><span class="badge ' + statusBadgeClass + '">' + statusLabel + '</span></td>' +
          '<td><div style="display:flex;flex-wrap:wrap;gap:4px">' + assignedWhNames + '</div></td>' +
          '<td class="mono" style="font-size:12.5px">' + esc(createdDate) + '</td>' +
          '<td class="mono" style="font-size:12.5px">' + lastLoginHtml + '</td>' +
          '<td><div style="display:flex;gap:6px">' +
            '<button type="button" class="btn ghost btn-sm btn-view-user" data-user-id="' + esc(u.id) + '" title="View user details & permissions">View</button>' +
            '<button type="button" class="btn ghost btn-sm btn-edit-user" data-user-id="' + esc(u.id) + '" title="Edit user role & facility permissions">Edit</button>' +
          '</div></td></tr>';
      }).join('');

      sBody.innerHTML = toolbarHtml + '<div class="card"><div class="tablewrap" tabindex="0" role="region" aria-label="Scrollable table"><table class="table"><thead><tr>' +
        '<th>User</th><th>Email</th><th>Role</th><th>Status</th><th>Warehouse Access</th><th>Created</th><th>Last Login</th><th>Actions</th></tr></thead><tbody>' +
        (rowsHtml || '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:30px">No matching staff accounts found.</td></tr>') +
        '</tbody></table></div></div>';

      var sInput = $('#staffSearchInput');
      if (sInput) {
        sInput.addEventListener('input', function () {
          staffSearchQuery = sInput.value.trim();
          renderStaff();
        });
      }

      $$('#staffFilterTabs button').forEach(function (tab) {
        tab.addEventListener('click', function () {
          staffRoleFilter = tab.dataset.staffFilter || '';
          renderStaff();
        });
      });

      $$('.btn-view-user').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var uid = Number(btn.dataset.userId);
          var targetUser = users.filter(function (x) { return x.id === uid; })[0];
          if (targetUser) openUserDetailModal(targetUser, allWhs);
        });
      });

      $$('.btn-edit-user').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var uid = Number(btn.dataset.userId);
          var targetUser = users.filter(function (x) { return x.id === uid; })[0];
          if (!targetUser) return;

          var isSelf = me && me.id === uid;
          var canGrantGlobal = me && (me.role === 'admin' || (me.permissions && me.permissions.indexOf('warehouses:global_access') >= 0));

          Api.getUserWarehouses(uid).then(function (userWhs) {
            var currentAssignedIds = (userWhs || []).map(function (w) { return w.id; });
            var checkboxesHtml = allWhs.map(function (w) {
              var isChecked = currentAssignedIds.indexOf(w.id) >= 0;
              return '<label style="display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer">' +
                '<input type="checkbox" name="wh_' + esc(w.id) + '" class="edit-wh-check" value="' + esc(w.id) + '"' + (isChecked ? ' checked' : '') + '> ' +
                '<span><strong>' + esc(w.name) + '</strong> (' + esc(w.code) + ')</span>' +
              '</label>';
            }).join('');

            var isAllChecked = allWhs.length > 0 && allWhs.every(function (w) { return currentAssignedIds.indexOf(w.id) >= 0; });

            openModal('Edit User: ' + (targetUser.name || targetUser.fullName || targetUser.email),
              field('fullName', 'Full Name', { required: true, value: targetUser.name || targetUser.fullName || '' }) +
              field('role', 'System Role', {
                type: 'select',
                value: targetUser.role,
                disabled: isSelf,
                help: isSelf ? 'You cannot alter your own role for security.' : '',
                options: [
                  { value: 'staff', label: 'Staff (Warehouse Operations)' },
                  { value: 'driver', label: 'Driver (Transit & Photos)' },
                  { value: 'manager', label: 'Manager (Invoices & Adjustments)' },
                  { value: 'admin', label: 'Administrator (Full Access)' }
                ]
              }) +
              '<div class="role-desc-box">' +
                '<strong>Role Permissions Guide:</strong><br>' +
                '• <b>ADMIN</b>: Full administrative access across all modules & security settings.<br>' +
                '• <b>MANAGER</b>: Operations, inventory adjustments & invoice management within assigned facilities.<br>' +
                '• <b>STAFF</b>: Standard warehouse operations (inbound/outbound stock) within assigned facility.<br>' +
                '• <b>DRIVER</b>: Transit logging and photo capture for assigned delivery routes.' +
              '</div>' +
              field('status', 'Account Status', {
                type: 'select',
                value: targetUser.status || 'active',
                disabled: isSelf,
                help: isSelf ? 'You cannot deactivate your own active session.' : '',
                options: [
                  { value: 'active', label: 'Active (Permitted to sign in)' },
                  { value: 'inactive', label: 'Inactive (Login disabled)' },
                  { value: 'suspended', label: 'Suspended (Locked)' }
                ]
              }) +
              '<div style="margin-top:16px"><label style="font-size:12px;font-weight:700;color:var(--muted)">WAREHOUSE FACILITY ACCESS</label>' +
              '<div style="background:var(--panel-2);border:1px solid var(--line-2);border-radius:var(--r);padding:12px 16px;margin-top:6px">' +
                '<label style="display:flex;align-items:center;gap:8px;padding:4px 0;margin-bottom:8px;border-bottom:1px solid var(--line-2);cursor:' + (canGrantGlobal ? 'pointer' : 'not-allowed') + ';font-weight:600">' +
                  '<input type="checkbox" id="editWhAllCheck"' + (isAllChecked ? ' checked' : '') + (canGrantGlobal ? '' : ' disabled') + '> ' +
                  '<span>All Facilities (Global Access)</span>' +
                '</label>' +
                (canGrantGlobal ? '<div class="global-access-warning"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg> Warning: All Facilities provides unrestricted access across all existing and future warehouses.</div>' : '<div style="font-size:11.5px;color:var(--muted);margin-bottom:6px">🔒 Requires warehouses:global_access permission to grant All Facilities.</div>') +
                '<div style="margin-top:8px">' + (checkboxesHtml || '<em style="color:var(--muted)">No facilities configured</em>') + '</div>' +
              '</div></div>',
              function (fd) {
                if (!fd.fullName) {
                  toast('Full name is required.');
                  return Promise.reject(new Error('Full name required'));
                }

                var selectedWhIds = [];
                allWhs.forEach(function (w) {
                  if (fd['wh_' + w.id]) selectedWhIds.push(w.id);
                });

                var updatePayload = {
                  fullName: fd.fullName.trim(),
                  role: isSelf ? targetUser.role : (fd.role || targetUser.role),
                  status: isSelf ? (targetUser.status || 'active') : (fd.status || 'active'),
                  warehouseIds: selectedWhIds
                };

                return Api.updateUser(uid, updatePayload).then(function () {
                  toast('User ' + (targetUser.name || targetUser.email) + ' updated successfully.');
                  renderStaff();
                });
              }
            );

            var editAllCheck = $('#editWhAllCheck');
            if (editAllCheck && canGrantGlobal) {
              editAllCheck.onchange = function () {
                $$('.edit-wh-check').forEach(function (cb) { cb.checked = editAllCheck.checked; });
              };
            }
          });
        });
      });
    }).catch(function (err) { apiErrorState('#staffBody', err); });
  }

  function openUserDetailModal(u, allWhs) {
    var assignedWhNames = (u.warehouses && u.warehouses.length)
      ? deduplicateWarehouses(u.warehouses).map(function (w) { return esc(w.name) + ' (' + esc(w.code) + ')'; }).join(', ')
      : (u.role === 'admin' ? 'All Facilities (Global Admin)' : 'None');
    var createdDate = u.createdAt ? String(u.createdAt).replace('T', ' ').slice(0, 19) : '—';
    var uStatus = (u.status || 'active').toLowerCase();
    var statusBadgeClass = uStatus === 'active' ? 'badge-active' : (uStatus === 'suspended' ? 'badge-failed' : 'badge-inactive');
    var statusLabel = uStatus.charAt(0).toUpperCase() + uStatus.slice(1);
    var lastLoginText = u.lastLoginAt ? String(u.lastLoginAt).replace('T', ' ').slice(0, 19) : 'Never';

    var roleDesc = '';
    if (u.role === 'admin') roleDesc = 'Full administrative access across all facilities, staff management, financial records, and system settings.';
    else if (u.role === 'manager') roleDesc = 'Operational management within assigned facilities, inventory recounts, adjustments, and invoice oversight.';
    else if (u.role === 'driver') roleDesc = 'Driver operational access, shipment transit logging, and photo capture for assigned delivery routes.';
    else roleDesc = 'Standard warehouse operational access for inbound and outbound stock recording within assigned facilities.';

    var perms = [];
    if (u.role === 'admin') {
      perms = ['warehouses:global_access', 'warehouses:manage', 'invoices:manage', 'payments:manage', 'payments:refund', 'staff:manage', 'inventory:write', 'photos:manage', 'audit:read'];
    } else if (u.role === 'manager') {
      perms = ['invoices:manage', 'payments:manage', 'inventory:write', 'photos:upload', 'audit:read'];
    } else if (u.role === 'driver') {
      perms = ['inventory:read', 'photos:upload', 'timesheets:write'];
    } else {
      perms = ['inventory:write', 'photos:upload', 'timesheets:write'];
    }

    var permChipsHtml = perms.map(function (p) {
      return '<span class="perm-chip">' + esc(p) + '</span>';
    }).join('');

    var contentHtml = '<div class="user-detail-wrap">' +
      '<div class="user-detail-header">' +
        '<div>' +
          '<h3 style="margin:0;font-size:18px">' + esc(u.name || u.fullName) + '</h3>' +
          '<span class="mono" style="font-size:13px;color:var(--muted)">' + esc(u.email) + '</span>' +
        '</div>' +
        '<div style="display:flex;gap:6px">' +
          '<span class="badge ' + (u.role === 'admin' ? 'badge-in' : (u.role === 'manager' ? 'badge-transit' : 'badge-received')) + '">' + esc(u.role) + '</span>' +
          '<span class="badge ' + statusBadgeClass + '">' + statusLabel + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="user-detail-grid">' +
        '<div class="user-detail-field"><span class="user-detail-label">Assigned Facilities</span><span class="user-detail-val">' + esc(assignedWhNames) + '</span></div>' +
        '<div class="user-detail-field"><span class="user-detail-label">Account Created</span><span class="user-detail-val mono">' + esc(createdDate) + '</span></div>' +
        '<div class="user-detail-field"><span class="user-detail-label">Last Login</span><span class="user-detail-val mono">' + esc(lastLoginText) + '</span></div>' +
      '</div>' +
      '<div class="role-desc-box">' +
        '<strong>Role Scope:</strong> ' + esc(roleDesc) +
      '</div>' +
      '<div>' +
        '<span class="user-detail-label">Effective Permission Keys</span>' +
        '<div class="perm-chips-wrap">' + permChipsHtml + '</div>' +
      '</div>' +
    '</div>';

    openModal('User Profile & Authorizations', contentHtml, function () { return Promise.resolve(); });
    var okBtn = $('#modalOk');
    if (okBtn) okBtn.textContent = 'Close';
  }

  function renderHistory() {
    var filtersEl = $('#historyFilters');
    if (filtersEl) filtersEl.hidden = histTab !== 'transactions';

    if (histTab === 'audit') {
      renderHistoryAuditLog();
      return;
    }
    renderHistoryTransactions();
  }

  function renderHistoryTransactions() {
    loadingState('#historyBody');

    var facEl = $('#histFacilityFilter');
    if (facEl && facEl.options.length <= 1) {
      facEl.innerHTML = '<option value="">All Facilities</option>' +
        warehouses.map(function (w) { return '<option value="' + esc(w.id) + '">' + esc(w.name) + '</option>'; }).join('');
      facEl.value = histFacilityFilter;
    }

    loadUsersCache().then(function (users) {
      var byEl = $('#histRecordedByFilter');
      if (byEl && byEl.options.length <= 1) {
        byEl.innerHTML = '<option value="">All Staff</option>' +
          (users || []).map(function (u) { return '<option value="' + esc(u.id) + '">' + esc(u.name || u.fullName || u.email) + '</option>'; }).join('');
        byEl.value = histRecordedByFilter;
      }
    });

    Promise.all([
      Api.listMaterials({ warehouseId: histFacilityFilter || undefined, division: histDivisionFilter || undefined, includeInactive: true }),
      Api.listInventoryTransactions({
        warehouseId: histFacilityFilter || undefined,
        division: histDivisionFilter || undefined,
        startDate: histStartDate || undefined,
        endDate: histEndDate || undefined
      })
    ]).then(function (res) {
      var materials = res[0];
      var transactions = res[1];

      var prodFilterEl = $('#histProductFilter');
      if (prodFilterEl) {
        var prevVal = prodFilterEl.value;
        prodFilterEl.innerHTML = '<option value="">All Products / Materials</option>' +
          materials.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>'; }).join('');
        prodFilterEl.value = prevVal || histProductFilter;
      }

      renderHistoryTransactionsTable(materials, transactions);
    }).catch(function (err) { apiErrorState('#historyBody', err); });
  }

  function renderHistoryAuditLog() {
    loadingState('#historyBody');
    Api.listAudit({ warehouseId: warehouseId }).then(function (logs) {
      var hBody = $('#historyBody');
      if (!hBody) return;
      if (!logs.length) {
        hBody.innerHTML = emptyState('history', 'No audit logs yet', 'Every sign-in, transaction, and update is logged here.');
        return;
      }

      hBody.innerHTML = '<div class="audit-list">' +
        logs.map(function (l) {
          var formattedTime = when(l.occurredAt);
          var actorName = userName(l.actorUserId);
          var roleTag = l.actorRole ? ' (' + l.actorRole + ')' : '';
          var whName = l.warehouseId ? (warehouseName(l.warehouseId) || 'Facility') : 'Global';

          return '<div class="audit-card">' +
            '<div class="audit-main">' +
              '<div class="audit-topline">' +
                '<span class="audit-who">' + esc(actorName) + '<span style="color:var(--muted);font-weight:400">' + esc(roleTag) + '</span></span>' +
                '<span class="audit-action-badge">' + esc(l.action) + '</span>' +
                '<span class="audit-wh-badge">' + esc(whName) + '</span>' +
              '</div>' +
              '<div class="audit-summary">' + esc(l.summary) + '</div>' +
              '<div class="audit-meta">' +
                '<span>Entity: <strong class="mono">' + esc(l.entityType || 'system') + (l.entityId ? (' #' + esc(String(l.entityId).slice(0, 8))) : '') + '</strong></span>' +
                '<span>•</span>' +
                '<span class="mono">' + esc(formattedTime) + '</span>' +
              '</div>' +
            '</div>' +
          '</div>';
        }).join('') + '</div>';
    }).catch(function (err) { apiErrorState('#historyBody', err); });
  }

  function renderSettings() {
    var co = db.company || {};
    var sBody = $('#settingsBody');
    if (!sBody) return;
    sBody.innerHTML = '<div class="card pad">' +
      '<h3>Company Details &amp; Letterhead</h3>' +
      '<form id="setForm" style="margin-top:14px">' +
        field('name', 'Company Name', { value: co.name || 'GreenWave Recycling Inc.' }) +
        field('line1', 'Address Line 1', { value: co.line1 || '456 Warehouse Rd' }) +
        field('line2', 'City, Province, Postal', { value: co.line2 || 'Calgary, AB T2P 1J9' }) +
        '<div class="grid g2">' +
          field('phone', 'Phone', { value: co.phone || '403-555-0199' }) +
          field('email', 'Billing Email', { value: co.email || 'billing@greenwaverecycling.ca' }) +
        '</div>' +
        '<div class="grid g2">' +
          field('bn', 'Business Number', { value: co.bn || '123456789RT0001' }) +
          field('gst', 'GST/HST Number', { value: co.gst || '123456789' }) +
        '</div>' +
        '<button type="submit" class="btn btn-primary" style="margin-top:10px">Save Settings</button>' +
      '</form></div>';

    var setForm = $('#setForm');
    if (setForm) {
      setForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var fName = $('[name="name"]', '#setForm');
        var fLine1 = $('[name="line1"]', '#setForm');
        var fLine2 = $('[name="line2"]', '#setForm');
        var fPhone = $('[name="phone"]', '#setForm');
        var fEmail = $('[name="email"]', '#setForm');
        var fBn = $('[name="bn"]', '#setForm');
        var fGst = $('[name="gst"]', '#setForm');
        db.company = {
          name: fName ? fName.value.trim() : '',
          line1: fLine1 ? fLine1.value.trim() : '',
          line2: fLine2 ? fLine2.value.trim() : '',
          phone: fPhone ? fPhone.value.trim() : '',
          email: fEmail ? fEmail.value.trim() : '',
          bn: fBn ? fBn.value.trim() : '',
          gst: fGst ? fGst.value.trim() : ''
        };
        S.save(db);
        toast('Company settings saved.');
      });
    }
  }

  var dialogOpenerEl = null;

  function getFocusable(container) {
    if (!container) return [];
    return $$('button, [href], input, select, textarea, [tabindex]', container).filter(function (el) {
      return !el.disabled && el.tabIndex !== -1 && el.offsetParent !== null;
    });
  }

  // Keeps Tab/Shift+Tab cycling inside an open dialog instead of leaking
  // focus to the (still-present, non-inert) page content behind it.
  function trapFocus(container, e) {
    var items = getFocusable(container);
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }

  function openModal(title, bodyHtml, onSave, opts) {
    opts = opts || {};
    var wrap = $('#modalWrap');
    if (!wrap) return;
    dialogOpenerEl = document.activeElement;
    var titleEl = $('#modalTitle');
    if (titleEl) titleEl.textContent = title;
    var formEl = $('#modalForm');
    if (formEl) formEl.innerHTML = bodyHtml;
    wrap.hidden = false;

    var okLabel = opts.okLabel || 'Save';
    var okBtn = $('#modalOk');
    if (okBtn) {
      okBtn.hidden = false;
      okBtn.textContent = okLabel;
      okBtn.className = 'btn ' + (opts.okClass || 'btn-primary');
    }
    var cancelBtn = $('#modalCancel'); if (cancelBtn) cancelBtn.textContent = opts.cancelLabel || 'Cancel';

    var close = function () {
      wrap.hidden = true;
      if (formEl) formEl.innerHTML = '';
      if (dialogOpenerEl && document.contains(dialogOpenerEl)) dialogOpenerEl.focus();
      dialogOpenerEl = null;
    };

    var firstField = formEl ? $('input, select, textarea', formEl) : null;
    (firstField || $('#modalClose')).focus();

    var closeBtn = $('#modalClose');
    if (closeBtn) closeBtn.onclick = close;
    var cancelBtnEl = $('#modalCancel');
    if (cancelBtnEl) cancelBtnEl.onclick = close;

    if (formEl) {
      formEl.onsubmit = function (e) {
        e.preventDefault();
        var fd = {};
        new FormData(formEl).forEach(function (v, k) { fd[k] = v; });
        if (typeof onSave === 'function') {
          if (okBtn) {
            okBtn.disabled = true;
            okBtn.dataset.origText = okLabel;
            okBtn.textContent = opts.savingLabel || 'Saving…';
          }
          var resetOkBtn = function () {
            if (okBtn) {
              okBtn.disabled = false;
              okBtn.textContent = okBtn.dataset.origText || okLabel;
            }
          };
          var res;
          try {
            res = onSave(fd);
          } catch (err) {
            resetOkBtn();
            toast(err.message || 'Action failed.');
            return;
          }
          if (res && typeof res.then === 'function') {
            res.then(function () {
              resetOkBtn();
              close();
            }).catch(function (err) {
              resetOkBtn();
              toast(err.message || 'Action failed.');
            });
          } else {
            resetOkBtn();
            close();
          }
        } else {
          close();
        }
      };
    }
  }

  function render() {
    syncChrome();
    if (view === 'dashboard') renderDashboard();
    else if (view === 'inventory') renderInventory();
    else if (view === 'chat') renderChat();
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

  function boot() {
    return Api.me().then(function (user) {
      me = {
        id: user.id,
        name: user.fullName || user.email,
        email: user.email,
        role: user.role
      };
      S.setServerSession(me);

      var gate = $('#gate');
      if (gate) gate.hidden = true;
      var app = $('#app');
      if (app) app.hidden = false;

      return Api.listWarehouses(false).then(function (whs) {
        warehouses = deduplicateWarehouses(whs || []);
        if (warehouses.length > 0) {
          if (!warehouseId || !warehouses.some(function (w) { return w.id === warehouseId; })) {
            warehouseId = warehouses[0].id;
            S.setWarehouse(warehouseId);
          }
        } else {
          warehouseId = '';
          S.setWarehouse('');
        }

        refreshShiftChip();
        refreshOnlineStaff();

        if (chatOnlineTimer) clearInterval(chatOnlineTimer);
        chatOnlineTimer = setInterval(refreshOnlineStaff, 30000);

        show(view);
      });
    }).catch(function (err) {
      console.error('Boot error:', err);
      if (err && err.status === 401) {
        showGate();
      }
    });
  }

  function attachEvents() {
    setupSignIn();
    setupChatComposer();

    var whEl = $('#wh');
    if (whEl) {
      whEl.addEventListener('change', function (e) {
        warehouseId = e.target.value;
        S.setWarehouse(warehouseId);
        var modalWrap = $('#modalWrap');
        if (modalWrap && !modalWrap.hidden) {
          modalWrap.hidden = true;
          var modalFormEl = $('#modalForm');
          if (modalFormEl) modalFormEl.innerHTML = '';
        }
        render();
      });
    }

    $$('.entsw button, .top-div-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        var newEntity = b.dataset.entity || b.dataset.div;
        if (!newEntity) return;
        entity = newEntity;
        db.entity = entity;
        S.save(db);
        if (view === 'invoices' && isHealthcare()) view = 'inventory';
        // Close any open form so a product/material selected under the
        // previous division can't linger after switching divisions.
        var modalWrap = $('#modalWrap');
        if (modalWrap && !modalWrap.hidden) {
          modalWrap.hidden = true;
          var modalFormEl = $('#modalForm');
          if (modalFormEl) modalFormEl.innerHTML = '';
        }
        syncChrome();
        render();
      });
    });

    $$('.navitem').forEach(function (b) {
      b.addEventListener('click', function () {
        var v = b.dataset.view;
        if (v === 'chat') {
          var badge = $('#chatNavBadge');
          if (badge) { badge.hidden = true; badge.textContent = '0'; }
        }
        show(v);
      });
    });

    var rxBtn = $('#btnReceiveStock');
    if (rxBtn) rxBtn.addEventListener('click', openReceiveModal);
    var shipBtn = $('#btnShipStock');
    if (shipBtn) shipBtn.addEventListener('click', openShipModal);
    var adjBtn = $('#btnAdjustStock');
    if (adjBtn) adjBtn.addEventListener('click', openAdjustModal);
    var expBtn = $('#btnExportInventory');
    if (expBtn) expBtn.addEventListener('click', exportInventoryCsv);

    $$('#v-inventory .inven-tab[data-tab]').forEach(function (tab) {
      tab.addEventListener('click', function () {
        $$('#v-inventory .inven-tab[data-tab]').forEach(function (t) { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        invenTab = tab.dataset.tab;
        renderInventory();
      });
    });

    $$('#v-history .inven-tab[data-hist-tab]').forEach(function (tab) {
      tab.addEventListener('click', function () {
        $$('#v-history .inven-tab[data-hist-tab]').forEach(function (t) { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        histTab = tab.dataset.histTab;
        renderHistory();
      });
    });

    var searchInput = $('#invenSearch');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        invenSearchQuery = searchInput.value.trim();
        renderInventory();
      });
    }
    var prodFilter = $('#invenProductFilter');
    if (prodFilter) {
      prodFilter.addEventListener('change', function () {
        invenProductFilter = prodFilter.value;
        renderInventory();
      });
    }
    [
      ['#histSearch', 'input', function (v) { histSearchQuery = v.trim(); }],
      ['#histFacilityFilter', 'change', function (v) { histFacilityFilter = v; }],
      ['#histDivisionFilter', 'change', function (v) { histDivisionFilter = v; }],
      ['#histTypeFilter', 'change', function (v) { histTypeFilter = v; }],
      ['#histProductFilter', 'change', function (v) { histProductFilter = v; }],
      ['#histRecordedByFilter', 'change', function (v) { histRecordedByFilter = v; }],
      ['#histStartDate', 'change', function (v) { histStartDate = v; }],
      ['#histEndDate', 'change', function (v) { histEndDate = v; }]
    ].forEach(function (cfg) {
      var el = $(cfg[0]);
      if (el) el.addEventListener(cfg[1], function () { cfg[2](el.value); renderHistory(); });
    });

    var addPhotoBtn = $('#addPhoto');
    if (addPhotoBtn) addPhotoBtn.addEventListener('click', function () { var pf = $('#photoFile'); if (pf) pf.click(); });
    var photoFileEl = $('#photoFile');
    if (photoFileEl) photoFileEl.addEventListener('change', function (e) { addPhotos(e.target.files); });
    var lbCloseBtn = $('#lbClose');
    if (lbCloseBtn) lbCloseBtn.addEventListener('click', closeLightbox);

    document.addEventListener('keydown', function (e) {
      var lb = $('#lightbox');
      var modalWrap = $('#modalWrap');
      var lbOpen = lb && !lb.hidden;
      var modalOpen = modalWrap && !modalWrap.hidden;
      if (!lbOpen && !modalOpen) return;

      if (e.key === 'Escape') {
        if (lbOpen) { closeLightbox(); return; }
        var modalCloseBtn = $('#modalClose'); if (modalCloseBtn) modalCloseBtn.click();
        return;
      }
      if (e.key === 'Tab') {
        trapFocus(lbOpen ? lb : modalWrap, e);
      }
    });

    var newInvoiceBtn = $('#newInvoice');
    if (newInvoiceBtn) newInvoiceBtn.addEventListener('click', function () { draft = newDraft(); editorViewMode = false; show('editor'); });
    var newCustomerBtn = $('#newCustomer');
    if (newCustomerBtn) {
      newCustomerBtn.addEventListener('click', function () {
        openModal('Add Customer',
          field('name', 'Customer / Company Name', { required: true }) +
          field('billTo', 'Billing Address', { type: 'textarea', required: true }) +
          field('shipTo', 'Shipping Address', { type: 'textarea' }) +
          field('email', 'Email Address', { type: 'email' }),
          function (fd) {
            return Api.createCustomer({
              name: fd.name, billTo: fd.billTo, shipTo: fd.shipTo, email: fd.email, warehouseId: warehouseId
            }).then(function () { toast('Customer added.'); renderCustomers(); });
          });
      });
    }

    var newProductBtn = $('#newProduct');
    if (newProductBtn) {
      newProductBtn.addEventListener('click', function () {
        var w = warehouse();
        if (!w) { toast('Please select a warehouse first.'); return; }
        openModal('Add ' + (isRecycling() ? 'Material' : 'Product'),
          field('name', 'Product', { required: true, placeholder: isRecycling() ? 'e.g. Mixed Electronics' : 'e.g. Synguard 100 Nitrile Gloves' }) +
          field('category', 'Category', { placeholder: isRecycling() ? 'e.g. Electronics / Plastics' : 'e.g. PPE / Gloves' }) +
          productDivisionFacilityFields(entity, w.name) +
          field('description', 'Description (Optional)', { type: 'textarea' }),
          function (fd) {
            return Api.createMaterial({
              name: fd.name, category: fd.category, description: fd.description,
              division: fd.division, warehouseId: w.id,
              unit: fd.division === 'recycling' ? 'pallet' : 'box'
            }).then(function () { toast('Catalog item added.'); renderProducts(); });
          });
      });
    }

    var newStaffBtn = $('#newStaff');
    if (newStaffBtn) {
      newStaffBtn.addEventListener('click', function () {
        Api.listWarehouses(false).then(function (whs) {
          var allWhs = deduplicateWarehouses(whs || []);
          var whCheckboxes = allWhs.map(function (w) {
            return '<label style="display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer">' +
              '<input type="checkbox" name="wh_' + esc(w.id) + '" class="staff-wh-check" value="' + esc(w.id) + '"> ' +
              '<span><strong>' + esc(w.name) + '</strong> (' + esc(w.code) + ')</span>' +
            '</label>';
          }).join('');

          openModal('Create Application User',
            field('fullName', 'Full Name', { required: true, placeholder: 'e.g. John Smith' }) +
            field('email', 'Work Email', { type: 'email', required: true, placeholder: 'john@greenwaverecycling.ca' }) +
            field('password', 'Initial Password', { type: 'password', required: true, help: 'Min 8 chars with uppercase, lowercase, and number' }) +
            field('role', 'Role', {
              type: 'select',
              options: [
                { value: 'staff', label: 'Staff (Warehouse / Ops)' },
                { value: 'driver', label: 'Driver (Transit & Photos)' },
                { value: 'manager', label: 'Manager (Invoices & Adjustments)' },
                { value: 'admin', label: 'Administrator (Full Access)' }
              ]
            }) +
            '<div style="margin-top:12px"><label style="font-size:12px;font-weight:700;color:var(--muted)">FACILITY ACCESS</label>' +
            '<div style="background:var(--panel-2);border:1px solid var(--line-2);border-radius:var(--r);padding:10px 14px;margin-top:4px">' +
              '<label style="display:flex;align-items:center;gap:8px;padding:4px 0;margin-bottom:6px;border-bottom:1px solid var(--line-2);cursor:pointer;font-weight:600">' +
                '<input type="checkbox" id="whAllCheck"> <span>All Facilities</span>' +
              '</label>' +
              (whCheckboxes || '<em style="color:var(--muted)">No facilities available</em>') +
            '</div></div>',
            function (fd) {
              if (!fd.fullName || !fd.email || !fd.password) {
                toast('Please fill in all required user fields.');
                return Promise.reject(new Error('Required fields missing'));
              }
              if (fd.password.length < 8 || !/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(fd.password)) {
                toast('Password must contain at least 8 characters with 1 uppercase, 1 lowercase, and 1 number.');
                return Promise.reject(new Error('Password complexity requirements not met'));
              }

              var selectedWhIds = [];
              allWhs.forEach(function (w) {
                if (fd['wh_' + w.id]) selectedWhIds.push(w.id);
              });

              return Api.createUser({
                fullName: fd.fullName.trim(),
                email: fd.email.trim(),
                password: fd.password,
                role: fd.role,
                warehouseIds: selectedWhIds
              }).then(function () {
                toast('User account created successfully.');
                renderStaff();
              });
            });

          var allCheck = $('#whAllCheck');
          if (allCheck) {
            allCheck.onchange = function () {
              $$('.staff-wh-check').forEach(function (cb) { cb.checked = allCheck.checked; });
            };
          }
        });
      });
    }

    var menuBtnEl = $('#menuBtn');
    if (menuBtnEl) menuBtnEl.addEventListener('click', function () { var a = $('#app'); if (a) a.classList.toggle('menu-open'); });
    var signOutBtn = $('#signOut');
    if (signOutBtn) signOutBtn.addEventListener('click', signOut);

    document.addEventListener('click', function (e) {
      var goto = e.target.closest('[data-goto]');
      if (goto) { e.preventDefault(); show(goto.dataset.goto); }
      var act = e.target.closest('[data-action]');
      if (act) {
        var a = act.dataset.action;
        if (a === 'goProducts') show('products');
        else if (a === 'addPhoto') { var ap = $('#addPhoto'); if (ap) ap.click(); }
        else if (a === 'newInvoice') { var ni = $('#newInvoice'); if (ni) ni.click(); }
      }
    });

    setupInvoiceFilters();
  }

  function checkPublicPaymentRoute() {
    var path = window.location.pathname;
    var hash = window.location.hash;
    var token = null;

    if (path.indexOf('/pay/') === 0) {
      token = path.replace('/pay/', '').split('/')[0];
    } else if (hash.indexOf('#pay/') === 0) {
      token = hash.replace('#pay/', '').split('?')[0];
    }

    if (!token) return false;

    // Render Public Customer Payment Portal
    var gate = $('#gate'); if (gate) gate.hidden = true;
    var app = $('#app'); if (app) app.hidden = true;
    var portal = $('#payPortal'); if (portal) portal.hidden = false;

    renderPublicPaymentPortal(token);
    return true;
  }

  function renderPublicPaymentPortal(token) {
    var pBody = $('#payPortalBody');
    if (!pBody) return;
    pBody.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--muted)"><div class="spin" style="margin:0 auto 14px"></div>Loading invoice payment details…</div>';

    Api.getPublicInvoice(token).then(function (inv) {
      var isPaid = inv.paymentStatus === 'paid';
      var isFailed = inv.paymentStatus === 'failed';
      var isRefunded = inv.paymentStatus === 'refunded';

      var itemsHtml = (inv.items || []).map(function (item) {
        return '<tr>' +
          '<td><strong>' + esc(item.description) + '</strong></td>' +
          '<td class="mono" style="text-align:center">' + esc(item.quantity) + ' ' + esc(item.unit || '') + '</td>' +
          '<td class="mono" style="text-align:right">' + moneyDollars(item.unitPrice) + '</td>' +
          '<td class="mono" style="text-align:right;font-weight:600">' + moneyDollars(item.lineTotal) + '</td>' +
        '</tr>';
      }).join('');

      var actionHtml = '';
      if (isPaid) {
        actionHtml = '<div class="payportal-paid-banner">' +
          '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>' +
          '<span>PAID IN FULL · Thank you for your payment</span>' +
        '</div>';
      } else if (isRefunded) {
        actionHtml = '<div class="payportal-paid-banner" style="background:#EDE9FE;border-color:#DDD6FE;color:#5B21B6">' +
          '<span>REFUNDED · This invoice transaction has been refunded</span>' +
        '</div>';
      } else {
        actionHtml = '<div class="payportal-actions">' +
          '<button type="button" class="payportal-pay-btn" id="btnCustomerPayNow">' +
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>' +
            '<span>PAY INVOICE · ' + moneyDollars(inv.total) + ' ' + esc(inv.currency) + '</span>' +
          '</button>' +
          '<div style="font-size:12.5px;color:var(--muted)">Instant receipt &amp; automated processing via GreenWave Secure Gateway</div>' +
        '</div>';
      }

      pBody.innerHTML =
        '<div class="payportal-title-bar">' +
          '<div>' +
            '<div class="payportal-inv-num">Invoice #' + esc(inv.invoiceNumber) + '</div>' +
            '<div style="color:var(--muted);font-size:13px;margin-top:2px">Issued: ' + esc(inv.invoiceDate) + (inv.dueDate ? ' · Due: ' + esc(inv.dueDate) : '') + '</div>' +
          '</div>' +
          '<div>' +
            '<span class="badge ' + (isPaid ? 'badge-paid' : (isRefunded ? 'badge-refunded' : (isFailed ? 'badge-failed' : 'badge-unpaid'))) + '" style="font-size:13px;padding:4px 10px">' +
              (isPaid ? 'PAID' : (isRefunded ? 'REFUNDED' : (isFailed ? 'FAILED' : 'AMOUNT DUE'))) +
            '</span>' +
          '</div>' +
        '</div>' +

        '<div class="payportal-meta-grid">' +
          '<div class="payportal-meta-item">' +
            '<label>BILLED TO</label>' +
            '<span>' + esc((inv.billTo || '').split('\n')[0] || '—') + '</span>' +
          '</div>' +
          (inv.poReference ? '<div class="payportal-meta-item"><label>PO REFERENCE</label><span>' + esc(inv.poReference) + '</span></div>' : '') +
          '<div class="payportal-meta-item">' +
            '<label>PAYMENT METHOD</label>' +
            '<span>Online Card / Interac</span>' +
          '</div>' +
          '<div class="payportal-meta-item">' +
            '<label>CURRENCY</label>' +
            '<span>' + esc(inv.currency || 'CAD') + '</span>' +
          '</div>' +
        '</div>' +

        '<div class="payportal-table-wrap">' +
          '<table class="payportal-table">' +
            '<thead><tr><th>Item &amp; Description</th><th style="text-align:center">Quantity</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr></thead>' +
            '<tbody>' + (itemsHtml || '<tr><td colspan="4" style="text-align:center;color:var(--muted)">No line items</td></tr>') + '</tbody>' +
          '</table>' +
        '</div>' +

        '<div class="payportal-totals-box">' +
          '<div class="payportal-total-row"><span>Subtotal</span><span class="mono">' + moneyDollars(inv.subtotal) + '</span></div>' +
          (inv.discountTotal && Number(inv.discountTotal) > 0 ? '<div class="payportal-total-row" style="color:var(--good)"><span>Discount</span><span class="mono">-' + moneyDollars(inv.discountTotal) + '</span></div>' : '') +
          '<div class="payportal-total-row"><span>' + esc(inv.taxLabel || 'GST @ 5%') + '</span><span class="mono">' + moneyDollars(inv.taxTotal) + '</span></div>' +
          '<div class="payportal-total-row payportal-grand-total"><span>Total (' + esc(inv.currency) + ')</span><span class="mono">' + moneyDollars(inv.total) + '</span></div>' +
        '</div>' +

        actionHtml;

      var payBtn = $('#btnCustomerPayNow');
      if (payBtn) {
        payBtn.onclick = function () {
          payBtn.disabled = true;
          payBtn.innerHTML = '<span class="spin" style="margin-right:8px"></span>Initiating Secure Checkout…';

          Api.createCheckoutSession(token).then(function (session) {
            openModal('Checkout: Invoice #' + inv.invoiceNumber,
              '<div style="text-align:center;padding:10px 0">' +
                '<p style="font-size:15px;color:var(--ink);margin-bottom:14px">Total Amount: <strong>' + moneyDollars(session.amount) + ' ' + esc(session.currency) + '</strong></p>' +
                '<div style="background:var(--panel-2);border:1px solid var(--line-2);border-radius:var(--r);padding:14px;margin-bottom:16px;text-align:left;font-size:13px">' +
                  '<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span>Session ID:</span><span class="mono">' + esc(session.sessionId) + '</span></div>' +
                  '<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span>Provider:</span><span>Stripe Gateway</span></div>' +
                  '<div style="display:flex;justify-content:space-between"><span>Status:</span><span class="badge badge-pending">Checkout Pending</span></div>' +
                '</div>' +
                '<p style="font-size:12.5px;color:var(--muted);margin-bottom:16px">In test environment, you can complete test authorization or simulate webhook confirmation.</p>' +
                '<button type="button" class="btn btn-primary btn-block" id="btnSimulateCompletePay" style="background:#0F7A4C;font-size:15px;padding:12px">Simulate Successful Payment ($' + session.amount + ')</button>' +
              '</div>',
              function () { return Promise.resolve(); }
            );

            var simPayBtn = $('#btnSimulateCompletePay');
            if (simPayBtn) {
              simPayBtn.onclick = function () {
                simPayBtn.disabled = true;
                simPayBtn.textContent = 'Processing Payment…';

                var testPayload = {
                  type: 'checkout.session.completed',
                  data: {
                    object: {
                      id: session.sessionId,
                      payment_intent: 'pi_test_' + Date.now(),
                      amount_total: Math.round(Number(session.amount) * 100),
                      currency: session.currency.toLowerCase(),
                      metadata: {
                        invoiceNumber: inv.invoiceNumber,
                        paymentToken: token
                      }
                    }
                  }
                };

                fetch(Api.getBaseUrl() + '/pay/webhook', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(testPayload)
                }).then(function () {
                  toast('Payment processed successfully!');
                  closeModal();
                  renderPublicPaymentPortal(token);
                }).catch(function (err) {
                  toast('Payment processed: ' + (err.message || 'Complete'));
                  closeModal();
                  renderPublicPaymentPortal(token);
                });
              };
            }
          }).catch(function (err) {
            payBtn.disabled = false;
            payBtn.innerHTML = 'PAY INVOICE · ' + moneyDollars(inv.total) + ' ' + esc(inv.currency);
            toast(err.message || 'Could not initiate checkout session.');
          });
        };
      }
    }).catch(function (err) {
      pBody.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--crit)">' +
        '<div style="font-size:18px;font-weight:700;margin-bottom:8px">Unable to load invoice</div>' +
        '<div>' + esc(err.message || 'Invalid or expired payment link.') + '</div>' +
      '</div>';
    });
  }

  window.addEventListener('hashchange', function () {
    if (!checkPublicPaymentRoute() && Api.isAuthenticated()) {
      var view = window.location.hash.replace(/^#/, '');
      if (view && $('#v-' + view)) show(view);
    }
  });

  document.addEventListener('DOMContentLoaded', function () {
    attachEvents();
    if (checkPublicPaymentRoute()) {
      return;
    }
    if (Api.isAuthenticated()) {
      boot();
    } else {
      showGate();
    }
  });

})(window);
