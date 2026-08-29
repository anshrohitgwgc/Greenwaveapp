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
    admin:   { label: 'Administrator', sees: ['inventory','intake','photos','timeclock','chat','invoices','editor','customers','products','staff','history','settings'] },
    manager: { label: 'Manager',       sees: ['inventory','intake','photos','timeclock','chat','invoices','editor','customers','products','history'] },
    staff:   { label: 'Staff',         sees: ['inventory','intake','photos','timeclock','chat'] },
    driver:  { label: 'Driver',        sees: ['inventory','intake','photos','timeclock','chat'] }
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
  function bytes(n) {
    if (n > 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n > 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
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
    if (o.type === 'select') {
      input = '<select name="' + name + '"' + (o.required ? ' required' : '') + (o.disabled ? ' disabled' : '') + '>' + o.options.map(function (x) {
        return '<option value="' + esc(x.value) + '"' + (String(x.value) === String(v) ? ' selected' : '') + '>' + esc(x.label) + '</option>';
      }).join('') + '</select>';
    } else if (o.type === 'textarea') {
      input = '<textarea name="' + name + '" rows="' + (o.rows || 3) + '"' + (o.required ? ' required' : '') + ' placeholder="' + esc(o.placeholder || '') + '">' + esc(v) + '</textarea>';
    } else {
      input = '<input type="' + (o.type || 'text') + '" name="' + name + '" value="' + esc(v) + '"' +
        (o.required ? ' required' : '') + (o.step ? ' step="' + o.step + '"' : '') +
        (o.min != null ? ' min="' + o.min + '"' : '') + (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') +
        (o.autocomplete ? ' autocomplete="' + esc(o.autocomplete) + '"' : '') + (o.readonly ? ' readonly' : '') + '>';
    }
    return '<div class="field"><label>' + esc(label) + (o.help ? ' <span style="font-weight:400;color:var(--muted)">(' + esc(o.help) + ')</span>' : '') + '</label>' + input + '</div>';
  }

  var db = S.get();
  var me = null;
  var view = 'inventory';
  var entity = db.entity || 'recycling';
  var warehouseId = S.getWarehouse();
  var warehouses = [];
  var usersCache = null;
  var currentShiftCache = null;
  var clockTimer = null;
  var draft = null;
  var invoiceListCache = [];

  var chatMessages = [];
  var chatSseSource = null;
  var chatPollTimer = null;
  var chatOnlineTimer = null;

  var invenTab = 'balances';
  var invenSearchQuery = '';
  var invenProductFilter = '';
  var invenTypeFilter = '';
  var inventoryBalancesCache = [];
  var inventoryTransactionsCache = [];
  var inventoryContainersCache = [];

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

  function visibleMaterials(all) {
    return (all || []).filter(function (m) {
      if (!m.active) return false;
      var c = (m.category || '').toLowerCase();
      return isRecycling() ? c !== 'healthcare' : (c === 'healthcare' || c === 'ppe' || c === 'gloves' || c === 'cases');
    });
  }

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
    msgEl.innerHTML = '<div class="gateerr"><svg><use href="#i-alert"></use></svg><div>' + text + '</div></div>';
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
    $('#app').hidden = true;
    $('#gate').hidden = false;
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
    if (sel && warehouses.length) {
      sel.innerHTML = warehouses.map(function (w) {
        return '<option value="' + esc(w.id) + '">' + esc(w.name) + '</option>';
      }).join('');
      sel.value = warehouseId;
    }

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
      { v: 'chat',      i: 'chat',  l: 'Chat' },
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
    if (!can(next) && next !== 'editor') next = 'inventory';
    if (next === 'editor' && !can('invoices')) next = 'inventory';

    view = next;
    $$('.view').forEach(function (v) { v.classList.remove('active'); });
    var el = $('#v-' + view);
    if (el) el.classList.add('active');

    $$('.navitem').forEach(function (b) {
      var on = b.dataset.view === view || (view === 'editor' && b.dataset.view === 'invoices');
      if (on) b.classList.add('active'); else b.classList.remove('active');
    });
    $('#app').classList.remove('menu-open');
    $('#scroll').scrollTop = 0;
    renderTabbar();
    render();
  }

  function renderInventory() {
    var w = warehouse();
    $('#invenSub').textContent = w ? 'Live balances & transactions at ' + w.name + ' (PostgreSQL ledger).' : '';
    if (!w) { $('#invenBody').innerHTML = ''; return; }

    loadingState('#invenBody');

    Promise.all([
      Api.listMaterials(),
      Api.getInventoryBalances(w.id),
      Api.listInventoryTransactions({ warehouseId: w.id }),
      Api.listContainers({ warehouseId: w.id })
    ]).then(function (res) {
      var allMaterials = res[0];
      var balances = res[1];
      var transactions = res[2];
      var containers = res[3];

      var visibleMats = visibleMaterials(allMaterials);
      inventoryBalancesCache = balances;
      inventoryTransactionsCache = transactions;
      inventoryContainersCache = containers;

      var prodFilterEl = $('#invenProductFilter');
      if (prodFilterEl) {
        var prevVal = prodFilterEl.value;
        prodFilterEl.innerHTML = '<option value="">All Products / Materials</option>' +
          visibleMats.map(function (m) {
            return '<option value="' + esc(m.id) + '">' + esc(m.name) + ' (' + esc(m.unit) + ')</option>';
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

      $('#kpiCurrentStock').textContent = num(grandCurrent);
      $('#kpiInboundTotal').textContent = num(grandInbound);
      $('#kpiOutboundTotal').textContent = num(grandOutbound);
      $('#kpiAdjustmentTotal').textContent = (grandAdj >= 0 ? '+' : '') + num(grandAdj);

      if (invenTab === 'balances') {
        renderBalancesTab(visibleMats, balances, transactions);
      } else if (invenTab === 'transactions') {
        renderTransactionsTab(visibleMats, transactions);
      } else if (invenTab === 'containers') {
        renderContainersTab(containers);
      }
    }).catch(function (err) {
      apiErrorState('#invenBody', err);
    });
  }

  function renderBalancesTab(materials, balances, transactions) {
    if (!materials.length) {
      $('#invenBody').innerHTML = emptyState('tag', isRecycling() ? 'No materials cataloged' : 'No products cataloged',
        'Add what you handle in Materials first to track stock balances.',
        can('products') ? 'Add catalog item' : null, 'goProducts');
      return;
    }

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
        SIZE_KEYS.forEach(function (k) { row[k] += sign * (Number(t[k]) || 0); });
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

    var head = '<tr>' +
      '<th>Product / Material</th>' +
      '<th>Category</th>' +
      '<th class="num">XL</th>' +
      '<th class="num">L</th>' +
      '<th class="num">M</th>' +
      '<th class="num">S</th>' +
      '<th class="num" style="background:var(--acc-soft);color:var(--acc)">Current Stock</th>' +
      '<th class="num">Inbound</th>' +
      '<th class="num">Outbound</th>' +
      '<th class="num">Net Adj</th>' +
      '<th>Unit</th>' +
      '</tr>';

    var body = rows.map(function (r) {
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
        '<td style="color:var(--muted)">' + esc(r.material.unit) + '</td>' +
        '</tr>';
    }).join('');

    var totXL = rows.reduce(function (a, r) { return a + r.xl; }, 0);
    var totL  = rows.reduce(function (a, r) { return a + r.l; }, 0);
    var totM  = rows.reduce(function (a, r) { return a + r.m; }, 0);
    var totS  = rows.reduce(function (a, r) { return a + r.s; }, 0);
    var totStock = rows.reduce(function (a, r) { return a + r.total; }, 0);
    var totIn = rows.reduce(function (a, r) { return a + r.inbound; }, 0);
    var totOut = rows.reduce(function (a, r) { return a + r.outbound; }, 0);
    var totAdj = rows.reduce(function (a, r) { return a + r.adj; }, 0);

    var foot = '<tfoot><tr style="font-weight:700">' +
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

    $('#invenBody').innerHTML = '<div class="card">' +
      '<div class="tablewrap"><table class="table">' +
      '<thead>' + head + '</thead>' +
      '<tbody>' + (body || '<tr><td colspan="11" style="text-align:center;color:var(--muted);padding:30px">No matching stock balances found.</td></tr>') + '</tbody>' +
      foot +
      '</table></div></div>';
  }

  function renderTransactionsTab(materials, transactions) {
    var matById = {};
    materials.forEach(function (m) { matById[m.id] = m; });

    var rows = transactions.slice();

    if (invenProductFilter) {
      rows = rows.filter(function (t) { return t.materialId === invenProductFilter; });
    }
    if (invenTypeFilter) {
      rows = rows.filter(function (t) { return t.type === invenTypeFilter; });
    }
    if (invenSearchQuery) {
      var q = invenSearchQuery.toLowerCase();
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
      '<th>Order / Ref #</th>' +
      '<th>Type</th>' +
      '<th>Product</th>' +
      '<th>Container No.</th>' +
      '<th>Seal No.</th>' +
      '<th class="num">XL</th>' +
      '<th class="num">L</th>' +
      '<th class="num">M</th>' +
      '<th class="num">S</th>' +
      '<th class="num">Total</th>' +
      '<th>Recorded By</th>' +
      '<th>Notes / Reason</th>' +
      '</tr>';

    var body = rows.map(function (t) {
      var m = matById[t.materialId] || { name: 'Item', unit: 'cases' };
      var badgeClass = t.type === 'inbound' ? 'badge-in' : t.type === 'outbound' ? 'badge-out' : 'badge-adj';
      var typeLabel = t.type === 'inbound' ? 'IN' : t.type === 'outbound' ? 'OUT' : 'ADJ';
      var by = (me && t.createdBy === me.id) ? me.name : (usersCache ? userName(t.createdBy) : ('Staff #' + t.createdBy));

      return '<tr>' +
        '<td class="mono" style="font-size:12.5px">' + esc(when(t.createdAt).split(' ')[0]) + '</td>' +
        '<td class="mono"><strong>' + esc(t.orderNumber || t.reference || '—') + '</strong></td>' +
        '<td><span class="badge ' + badgeClass + '">' + typeLabel + '</span></td>' +
        '<td>' + esc(m.name) + '</td>' +
        '<td class="mono">' + esc(t.containerNumber || '—') + '</td>' +
        '<td class="mono">' + esc(t.sealNumber || '—') + '</td>' +
        '<td class="num">' + num(t.xl) + '</td>' +
        '<td class="num">' + num(t.l) + '</td>' +
        '<td class="num">' + num(t.m) + '</td>' +
        '<td class="num">' + num(t.s) + '</td>' +
        '<td class="num"><strong>' + num(t.total) + '</strong></td>' +
        '<td style="color:var(--ink-2)">' + esc(by) + '</td>' +
        '<td style="color:var(--muted);font-size:12.5px">' + esc(t.reason || t.notes || '—') + '</td>' +
        '</tr>';
    }).join('');

    $('#invenBody').innerHTML = '<div class="card">' +
      '<div class="tablewrap"><table class="table">' +
      '<thead>' + head + '</thead>' +
      '<tbody>' + (body || '<tr><td colspan="13" style="text-align:center;color:var(--muted);padding:30px">No matching transactions found.</td></tr>') + '</tbody>' +
      '</table></div></div>';
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

    $('#invenBody').innerHTML = '<div class="card">' +
      '<div class="tablewrap"><table class="table">' +
      '<thead>' + head + '</thead>' +
      '<tbody>' + (body || '<tr><td colspan="13" style="text-align:center;color:var(--muted);padding:30px">No container records found.</td></tr>') + '</tbody>' +
      '</table></div></div>';
  }

  function openReceiveModal() {
    var w = warehouse();
    if (!w) { toast('Please select a warehouse first.'); return; }

    Api.listMaterials().then(function (all) {
      var mats = visibleMaterials(all);
      if (!mats.length) { toast('Please create materials in the catalog first.'); return; }

      var formHtml =
        '<div class="field"><label>Warehouse Location</label><input type="text" value="' + esc(w.name) + '" readonly style="background:var(--panel-2)"></div>' +
        '<div class="grid g2">' +
          '<div class="field"><label>Date</label><input type="date" name="date" value="' + today() + '" required></div>' +
          '<div class="field"><label>Order Number (e.g. Jul20-DIVESTPC-AB38A)</label><input type="text" name="orderNumber" placeholder="Order / PO #" required></div>' +
        '</div>' +
        '<div class="field"><label>Product / Material</label><select name="materialId" required>' +
          mats.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + ' (' + esc(m.unit) + ')</option>'; }).join('') +
        '</select></div>' +
        '<div class="grid g2">' +
          '<div class="field"><label>Container Number (e.g. MSMU 6896930)</label><input type="text" name="containerNumber" placeholder="MSMU 6896930"></div>' +
          '<div class="field"><label>Seal Number (e.g. 0336695)</label><input type="text" name="sealNumber" placeholder="0336695"></div>' +
        '</div>' +
        '<label style="font-size:13px;font-weight:600;margin-top:10px;display:block">Quantities by Size</label>' +
        '<div class="sizes-grid">' +
          '<div class="field"><label>XL</label><input type="number" name="xl" min="0" step="any" placeholder="0" class="size-input"></div>' +
          '<div class="field"><label>L</label><input type="number" name="l" min="0" step="any" placeholder="0" class="size-input"></div>' +
          '<div class="field"><label>M</label><input type="number" name="m" min="0" step="any" placeholder="0" class="size-input"></div>' +
          '<div class="field"><label>S</label><input type="number" name="s" min="0" step="any" placeholder="0" class="size-input"></div>' +
        '</div>' +
        '<div class="total-preview-box">' +
          '<span class="total-preview-label">Calculated Total (XL + L + M + S):</span>' +
          '<span class="total-preview-val" id="modalAutoTotal">0</span>' +
        '</div>' +
        '<div class="field"><label>Notes / Comments (optional)</label><input type="text" name="notes" placeholder="e.g. SI SENT, cross dock"></div>';

      openModal('Receive Inbound Stock', formHtml, function (fd) {
        var xl = parseQty(fd.xl), l = parseQty(fd.l), m = parseQty(fd.m), s = parseQty(fd.s);
        var total = xl + l + m + s;
        if (total <= 0) { toast('Please enter a quantity for at least one size.'); return; }

        var payload = {
          warehouseId: w.id,
          materialId: fd.materialId,
          type: 'inbound',
          orderNumber: fd.orderNumber,
          reference: fd.orderNumber,
          containerNumber: fd.containerNumber || undefined,
          sealNumber: fd.sealNumber || undefined,
          xl: xl, l: l, m: m, s: s,
          notes: fd.notes || undefined
        };

        return Api.createInventoryTransaction(payload).then(function () {
          toast('Inbound shipment received and stock updated.');
          renderInventory();
        });
      });

      $$('.size-input').forEach(function (inp) {
        inp.addEventListener('input', function () {
          var t = 0;
          $$('.size-input').forEach(function (x) { t += parseQty(x.value); });
          var totEl = $('#modalAutoTotal');
          if (totEl) totEl.textContent = num(t);
        });
      });
    });
  }

  function openShipModal() {
    var w = warehouse();
    if (!w) { toast('Please select a warehouse first.'); return; }

    Api.listMaterials().then(function (all) {
      var mats = visibleMaterials(all);
      if (!mats.length) { toast('Please create materials in the catalog first.'); return; }

      var formHtml =
        '<div class="field"><label>Warehouse Location</label><input type="text" value="' + esc(w.name) + '" readonly style="background:var(--panel-2)"></div>' +
        '<div class="grid g2">' +
          '<div class="field"><label>Date</label><input type="date" name="date" value="' + today() + '" required></div>' +
          '<div class="field"><label>Order / Reference #</label><input type="text" name="orderNumber" placeholder="Order / BOL #" required></div>' +
        '</div>' +
        '<div class="field"><label>Product / Material</label><select name="materialId" required>' +
          mats.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + ' (' + esc(m.unit) + ')</option>'; }).join('') +
        '</select></div>' +
        '<div class="grid g2">' +
          '<div class="field"><label>Container Number (optional)</label><input type="text" name="containerNumber" placeholder="MSMU 6896930 / Trailer"></div>' +
          '<div class="field"><label>Seal Number (optional)</label><input type="text" name="sealNumber" placeholder="0336695"></div>' +
        '</div>' +
        '<label style="font-size:13px;font-weight:600;margin-top:10px;display:block">Quantities to Dispatch</label>' +
        '<div class="sizes-grid">' +
          '<div class="field"><label>XL</label><input type="number" name="xl" min="0" step="any" placeholder="0" class="size-input"></div>' +
          '<div class="field"><label>L</label><input type="number" name="l" min="0" step="any" placeholder="0" class="size-input"></div>' +
          '<div class="field"><label>M</label><input type="number" name="m" min="0" step="any" placeholder="0" class="size-input"></div>' +
          '<div class="field"><label>S</label><input type="number" name="s" min="0" step="any" placeholder="0" class="size-input"></div>' +
        '</div>' +
        '<div class="total-preview-box">' +
          '<span class="total-preview-label">Calculated Outbound Total:</span>' +
          '<span class="total-preview-val text-warning" id="modalAutoTotal">0</span>' +
        '</div>' +
        '<div class="field"><label>Notes / Outbound Details</label><input type="text" name="notes" placeholder="e.g. shipped via Trailer 12345"></div>';

      openModal('Ship Outbound Stock', formHtml, function (fd) {
        var xl = parseQty(fd.xl), l = parseQty(fd.l), m = parseQty(fd.m), s = parseQty(fd.s);
        var total = xl + l + m + s;
        if (total <= 0) { toast('Please enter a quantity for at least one size.'); return; }

        var payload = {
          warehouseId: w.id,
          materialId: fd.materialId,
          type: 'outbound',
          orderNumber: fd.orderNumber,
          reference: fd.orderNumber,
          containerNumber: fd.containerNumber || undefined,
          sealNumber: fd.sealNumber || undefined,
          xl: xl, l: l, m: m, s: s,
          notes: fd.notes || undefined
        };

        return Api.createInventoryTransaction(payload).then(function () {
          toast('Outbound shipment recorded and stock reduced.');
          renderInventory();
        });
      });

      $$('.size-input').forEach(function (inp) {
        inp.addEventListener('input', function () {
          var t = 0;
          $$('.size-input').forEach(function (x) { t += parseQty(x.value); });
          var totEl = $('#modalAutoTotal');
          if (totEl) totEl.textContent = num(t);
        });
      });
    });
  }

  function openAdjustModal() {
    var w = warehouse();
    if (!w) { toast('Please select a warehouse first.'); return; }

    Api.listMaterials().then(function (all) {
      var mats = visibleMaterials(all);
      if (!mats.length) { toast('Please create materials in the catalog first.'); return; }

      var formHtml =
        '<div class="field"><label>Warehouse Location</label><input type="text" value="' + esc(w.name) + '" readonly style="background:var(--panel-2)"></div>' +
        '<div class="field"><label>Product / Material</label><select name="materialId" required>' +
          mats.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + ' (' + esc(m.unit) + ')</option>'; }).join('') +
        '</select></div>' +
        '<div class="field"><label>Reason for Adjustment (Required)</label><input type="text" name="reason" placeholder="e.g. physical recount, adjusted 5 cases to match count" required></div>' +
        '<label style="font-size:13px;font-weight:600;margin-top:10px;display:block">Adjustment Quantities (can be positive or negative)</label>' +
        '<div class="sizes-grid">' +
          '<div class="field"><label>XL</label><input type="number" name="xl" step="any" placeholder="0" class="size-input"></div>' +
          '<div class="field"><label>L</label><input type="number" name="l" step="any" placeholder="0" class="size-input"></div>' +
          '<div class="field"><label>M</label><input type="number" name="m" step="any" placeholder="0" class="size-input"></div>' +
          '<div class="field"><label>S</label><input type="number" name="s" step="any" placeholder="0" class="size-input"></div>' +
        '</div>' +
        '<div class="total-preview-box">' +
          '<span class="total-preview-label">Net Adjustment Total:</span>' +
          '<span class="total-preview-val text-accent" id="modalAutoTotal">0</span>' +
        '</div>';

      openModal('Adjust Stock Balance', formHtml, function (fd) {
        var reason = (fd.reason || '').trim();
        if (!reason) { toast('Adjustment reason is required.'); return; }

        var xl = parseQty(fd.xl), l = parseQty(fd.l), m = parseQty(fd.m), s = parseQty(fd.s);
        var total = xl + l + m + s;
        if (total === 0 && !xl && !l && !m && !s) { toast('Enter adjustment values.'); return; }

        var payload = {
          warehouseId: w.id,
          materialId: fd.materialId,
          type: 'adjustment',
          reason: reason,
          xl: xl, l: l, m: m, s: s
        };

        return Api.createInventoryTransaction(payload).then(function () {
          toast('Stock adjustment recorded.');
          renderInventory();
        });
      });

      $$('.size-input').forEach(function (inp) {
        inp.addEventListener('input', function () {
          var t = 0;
          $$('.size-input').forEach(function (x) { t += parseQty(x.value); });
          var totEl = $('#modalAutoTotal');
          if (totEl) totEl.textContent = (t >= 0 ? '+' : '') + num(t);
        });
      });
    });
  }

  function exportInventoryCsv() {
    var w = warehouse();
    if (!w) return;

    var csvContent = '';
    var filename = 'greenwave-inventory-' + (w.code || 'wh') + '-' + today() + '.csv';

    if (invenTab === 'transactions') {
      csvContent = 'Date,Order Number,Type,Product ID,Container Number,Seal Number,XL,L,M,S,Total,Created By,Notes\n';
      inventoryTransactionsCache.forEach(function (t) {
        csvContent += [
          when(t.createdAt),
          '"' + (t.orderNumber || t.reference || '').replace(/"/g, '""') + '"',
          t.type,
          t.materialId,
          '"' + (t.containerNumber || '').replace(/"/g, '""') + '"',
          '"' + (t.sealNumber || '').replace(/"/g, '""') + '"',
          t.xl || 0,
          t.l || 0,
          t.m || 0,
          t.s || 0,
          t.total || 0,
          t.createdBy,
          '"' + (t.reason || t.notes || '').replace(/"/g, '""') + '"'
        ].join(',') + '\n';
      });
    } else {
      csvContent = 'Warehouse,Product ID,XL Balance,L Balance,M Balance,S Balance,Current Stock,Inbound Total,Outbound Total,Net Adjustment\n';
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
    }

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
          'Add what you handle in Materials first.',
          can('products') ? 'Add material' : null, 'goProducts');
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
          '<div class="field"><label>Reference</label><input type="text" id="tkRef" placeholder="Order #, container # or BOL"></div>' +
        '</div><div id="tkReasonWrap" hidden style="margin-top:16px">' + field('reason', 'Reason for adjustment', { required: true }) + '</div>' +
        '<div id="tkQty" style="margin-top:16px"></div>' +
        '<div id="tkContainer" style="margin-top:16px"></div>' +
        '<button type="button" class="btn btn-primary" id="tkPost" style="margin-top:18px"><svg><use href="#i-check"></use></svg>Post ticket</button>' +
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
        '<div class="tablewrap"><table class="table"><thead><tr><th>Date</th><th>Item</th><th>Reference</th><th>By</th><th>Type</th><th class="num">Qty</th></tr></thead><tbody>' +
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
    $('#photoSub').textContent = isAdmin
      ? 'Every photo uploaded across warehouses, newest first.'
      : 'Photos you have taken. Administrators can view all.';

    loadingState('#photoBody');
    loadUsersCache();
    var w = warehouse();
    Api.listPhotos({ warehouseId: w ? w.id : undefined }).then(function (all) {
      photoCache = all;
      var used = photoCache.reduce(function (a, p) { return a + (p.sizeBytes || 0); }, 0);

      if (!photoCache.length) {
        $('#photoBody').innerHTML = emptyState('cam', 'No photos yet',
          'Take a picture of a load, a seal, or an arrival. Photos are persisted in MinIO with GPS EXIF stripped.',
          'Add photo', 'addPhoto');
        return;
      }

      $('#photoBody').innerHTML = '<div class="card">' +
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

  function openLightbox(i) {
    var p = photoCache[i]; if (!p) return;
    $('#lbImg').src = p.url;
    $('#lbMeta').innerHTML = esc(userName(p.takenBy)) + ' · ' + esc(when(p.takenAt)) +
      ' · ' + bytes(p.sizeBytes) +
      (p.jobReference ? '<br>' + esc(p.jobReference) : '') +
      (me && me.role === 'admin' ? '<br><button type="button" class="btn danger" id="lbDel" style="margin-top:12px">Delete this photo</button>' : '');
    $('#lightbox').hidden = false;

    var del = $('#lbDel');
    if (del) del.addEventListener('click', function () {
      if (!confirm('Delete this photo permanently?')) return;
      Api.deletePhoto(p.id).then(function () {
        $('#lightbox').hidden = true;
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
      var open = r[0], mine = r[1];
      currentShiftCache = open;
      renderShiftChip();

      var weekAgo = Date.now() - 7 * 864e5;
      var weekMs = (mine || []).reduce(function (a, s) {
        var st = new Date(s.clockIn).getTime();
        if (st < weekAgo) return a;
        return a + ((s.clockOut ? new Date(s.clockOut).getTime() : Date.now()) - st);
      }, 0);

      $('#clockBody').innerHTML =
        '<div class="card"><div class="pad" style="text-align:center">' +
          '<div style="font-size:14px;color:var(--muted)">' + (open ? 'On shift since ' + new Date(open.clockIn).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' }) : 'Clocked out') + '</div>' +
          '<div style="font-size:36px;font-weight:700;font-family:var(--f-mono);margin:10px 0;' + (open ? 'color:var(--acc)' : 'color:var(--muted)') + '" id="clockTime">' +
            (open ? hm(Date.now() - new Date(open.clockIn).getTime()) : '—') + '</div>' +
          '<div style="font-size:13px;color:var(--muted);margin-bottom:16px">' + hm(weekMs) + ' logged in the last 7 days</div>' +
          '<button type="button" class="btn btn-primary" id="clockBtn">' +
            '<svg><use href="#i-' + (open ? 'stop' : 'play') + '"></use></svg>' + (open ? 'Clock out' : 'Clock in') + '</button>' +
        '</div></div>' +

        ((mine && mine.length) ? '<div class="card"><div class="pad"><h3>Your shift history</h3></div>' +
          '<div class="tablewrap"><table class="table"><thead><tr><th>Started</th><th>Ended</th><th class="num">Duration</th></tr></thead><tbody>' +
          mine.slice(0, 30).map(function (s) {
            return '<tr><td class="mono" style="font-size:13px">' + esc(when(s.clockIn)) + '</td>' +
              '<td class="mono" style="font-size:13px">' + (s.clockOut ? esc(when(s.clockOut)) : '<span class="badge badge-in">open</span>') + '</td>' +
              '<td class="num"><strong>' + (s.clockOut ? hm(new Date(s.clockOut) - new Date(s.clockIn)) : hm(Date.now() - new Date(s.clockIn))) + '</strong></td></tr>';
          }).join('') + '</tbody></table></div></div>' : '') +
        '<div id="teamClockCard"></div>';

      $('#clockBtn').addEventListener('click', toggleClock);

      if (isAdminOrManager()) {
        Api.teamShifts().then(function (rows) {
          var host = $('#teamClockCard'); if (!host) return;
          if (!rows || !rows.length) { host.innerHTML = ''; return; }
          host.innerHTML = '<div class="card"><div class="pad"><h3>Team members on shift right now</h3></div>' +
            '<div class="tablewrap"><table class="table"><thead><tr><th>Staff Name</th><th>Warehouse</th><th class="num">Clock In Time</th></tr></thead><tbody>' +
            rows.map(function (s) {
              return '<tr><td><strong>' + esc(userName(s.userId)) + '</strong></td>' +
                '<td style="color:var(--muted)">' + esc(warehouseName(s.warehouseId)) + '</td>' +
                '<td class="num">' + esc(when(s.clockIn)) + '</td></tr>';
            }).join('') + '</tbody></table></div></div>';
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
      toast(err.status === 409 ? 'You are already clocked in.' : (err.message || 'Could not update shift.'));
    });
  }

  function newDraft() {
    var w = warehouse(), co = db.company || {}, t = taxFor(w ? w.province : 'BC');
    return {
      id: null,
      invoiceNumber: null,
      customerId: '',
      billTo: 'gwgc',
      shipTo: '10828',
      reference: '',
      poReference: '',
      fromLocation: (w && w.name) || 'Maple Ridge, BC',
      warehouseId: w ? w.id : null,
      province: w ? w.province : 'BC',
      termsDays: 15,
      invoiceDate: today(),
      dueDate: new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10),
      taxLabel: t.label || 'GST @ 5%',
      taxRatePct: (t.rate || 0.05) * 100,
      companyInfo: {
        name: co.name || 'Greenwave Recycling Inc.',
        bn: co.bn || 'BN 751161951BC0001',
        gst: co.gst || 'GST/HST Registration No. 751161951RT0001',
        line1: co.line1 || '23394 Fisherman Rd,',
        line2: co.line2 || 'Maple Ridge, BC V2W 1B9',
        email: co.email || 'sales@greenwaverecycling.ca',
        phone: co.phone || '6724720423'
      },
      paymentInstructions: 'sales@greenwaverecycling.ca\n6724720423',
      notes: '',
      status: 'draft',
      items: [
        { description: 'sgfs', unit: '10', quantity: 1, unitPrice: 10000, discount: 1.00, isRebate: false }
      ]
    };
  }

  function blankLine() {
    return { description: '', unit: '', quantity: 1, unitPrice: 0, discount: 0, isRebate: false };
  }

  function invoiceToDraft(inv) {
    var termsDays = 15;
    if (inv.dueDate && inv.invoiceDate) {
      termsDays = Math.max(0, Math.round((new Date(inv.dueDate) - new Date(inv.invoiceDate)) / 864e5));
    }
    var items = (inv.items || []).map(function (it) {
      return {
        description: it.description || '',
        unit: it.unit || '',
        quantity: Number(it.quantity) || 0,
        unitPrice: Number(it.unitPrice) || 0,
        discount: Number(it.discount) || 0,
        isRebate: !!it.isRebate
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
        gst: co.gst || 'GST/HST Registration No. 751161951RT0001',
        line1: co.line1 || '23394 Fisherman Rd,',
        line2: co.line2 || 'Maple Ridge, BC V2W 1B9',
        email: co.email || 'sales@greenwaverecycling.ca',
        phone: co.phone || '6724720423'
      },
      paymentInstructions: inv.paymentInstructions || 'sales@greenwaverecycling.ca\n6724720423',
      notes: inv.notes || '',
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
    var rate = (Number(inv.taxRatePct) || 0) / 100;
    var tax = Math.round(sub * rate * 100) / 100;
    return { subtotal: sub, tax: tax, total: Math.round((sub + tax) * 100) / 100 };
  }

  function renderInvoiceList() {
    loadingState('#invoiceList');
    Api.listInvoices({ warehouseId: warehouseId }).then(function (list) {
      invoiceListCache = list;
      if (!list.length) {
        $('#invoiceList').innerHTML = emptyState('doc', 'No invoices yet',
          'Create professional invoices with rebate lines, tax calculation, and free text fields matching the Greenwave Ops reference.',
          'New invoice', 'newInvoice');
        return;
      }
      $('#invoiceList').innerHTML = '<div class="card"><div class="tablewrap"><table class="table"><thead><tr>' +
        '<th>Invoice #</th><th>Bill To</th><th>Date</th><th>Due Date</th><th class="num">Total</th><th>Status</th><th>Actions</th></tr></thead><tbody>' +
        list.slice().sort(function (a, b) { return String(b.invoiceNumber).localeCompare(String(a.invoiceNumber), undefined, { numeric: true }); })
        .map(function (inv) {
          var due = inv.dueDate || '', late = due && due < today();
          return '<tr class="click" data-invoice="' + esc(inv.id) + '">' +
            '<td class="mono"><strong>' + esc(inv.invoiceNumber) + '</strong></td>' +
            '<td>' + esc((inv.billTo || '').split('\n')[0] || '—') + '</td>' +
            '<td class="mono" style="font-size:13px">' + esc(inv.invoiceDate) + '</td>' +
            '<td class="mono" style="font-size:13px">' + esc(due || '—') + '</td>' +
            '<td class="num"><strong>' + moneyDollars(inv.total) + '</strong></td>' +
            '<td><span class="badge ' + (late ? 'badge-out' : (inv.status === 'draft' ? 'badge-transit' : 'badge-received')) + '">' + (late ? 'Overdue' : (inv.status === 'draft' ? 'Draft' : 'Open')) + '</span></td>' +
            '<td><button type="button" class="btn ghost btn-sm" data-dupe="' + esc(inv.id) + '">Duplicate</button></td></tr>';
        }).join('') + '</tbody></table></div></div>';

      $$('[data-invoice]').forEach(function (row) {
        row.addEventListener('click', function () {
          var inv = invoiceListCache.filter(function (x) { return x.id === row.dataset.invoice; })[0];
          if (inv) {
            draft = invoiceToDraft(inv);
            show('editor');
          }
        });
      });

      $$('[data-dupe]').forEach(function (b) {
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          Api.duplicateInvoice(b.dataset.dupe).then(function (saved) {
            draft = invoiceToDraft(saved);
            toast('Duplicated as invoice ' + saved.invoiceNumber + '.');
            show('editor');
          }).catch(function (err) { toast(err.message || 'Could not duplicate invoice.'); });
        });
      });
    }).catch(function (err) { apiErrorState('#invoiceList', err); });
  }

  /* ==========================================================================
     Authoritative Invoice Editor & Print Layout (Aligned with Greenwave Ops.pdf)
     ========================================================================== */
  function renderEditor() {
    if (!draft) draft = newDraft();
    $('#edTitle').textContent = draft.invoiceNumber ? 'Invoice ' + draft.invoiceNumber : 'New Invoice';

    var co = draft.companyInfo || {};
    var tot = totalsLocal(draft);

    var html =
      '<div class="invoice-doc-container">' +

        /* PAGE 1: INVOICE HEADER, COMPANY DETAILS, LOGO, BILL TO, SHIP TO, REFERENCE */
        '<div class="invoice-page invoice-page-1">' +
          '<div class="inv-doc-top-bar noprint">' +
            '<span class="inv-page-tag">PAGE 1 / 3 — COMPANY &amp; RECIPIENT</span>' +
          '</div>' +
          '<div class="inv-main-heading">INVOICE</div>' +

          '<div class="inv-company-block">' +
            '<div class="inv-box inv-box-strong"><input type="text" id="edCoName" class="inv-bare-input" value="' + esc(co.name || 'Greenwave Recycling Inc.') + '" placeholder="Company Name"></div>' +
            '<div class="inv-box"><input type="text" id="edCoBn" class="inv-bare-input" value="' + esc(co.bn || 'BN 751161951BC0001') + '" placeholder="BN Number"></div>' +
            '<div class="inv-box"><input type="text" id="edCoGst" class="inv-bare-input" value="' + esc(co.gst || 'GST/HST Registration No. 751161951RT0001') + '" placeholder="GST/HST Registration"></div>' +
            '<div style="height:12px"></div>' +
            '<div class="inv-box"><input type="text" id="edCoLine1" class="inv-bare-input" value="' + esc(co.line1 || '23394 Fisherman Rd,') + '" placeholder="Address Line 1"></div>' +
            '<div class="inv-box"><input type="text" id="edCoLine2" class="inv-bare-input" value="' + esc(co.line2 || 'Maple Ridge, BC V2W 1B9') + '" placeholder="City, Province, Postal"></div>' +
            '<div class="inv-box"><input type="text" id="edCoEmail" class="inv-bare-input" value="' + esc(co.email || 'sales@greenwaverecycling.ca') + '" placeholder="Sales Email"></div>' +
            '<div class="inv-box"><input type="text" id="edCoPhone" class="inv-bare-input" value="' + esc(co.phone || '6724720423') + '" placeholder="Phone Number"></div>' +
          '</div>' +

          '<div class="inv-logo-wrap">' +
            '<img src="assets/logo.png" alt="Greenwave Recycling Inc." class="inv-brand-logo">' +
          '</div>' +

          '<div class="inv-recipient-section">' +
            '<div class="inv-field-group">' +
              '<label class="inv-label">BILL TO</label>' +
              '<textarea id="edBill" class="inv-textarea-box" rows="4" placeholder="Enter recipient billing name and address">' + esc(draft.billTo) + '</textarea>' +
            '</div>' +

            '<div class="inv-field-group">' +
              '<label class="inv-label">SHIP TO</label>' +
              '<textarea id="edShip" class="inv-textarea-box" rows="4" placeholder="Enter recipient shipping address">' + esc(draft.shipTo) + '</textarea>' +
            '</div>' +
          '</div>' +

          '<div class="inv-dashed-divider"></div>' +

          '<div class="inv-ref-section">' +
            '<div class="inv-field-group">' +
              '<label class="inv-label">REFERENCE</label>' +
              '<input type="text" id="edRef" class="inv-input-box" value="' + esc(draft.reference || '') + '" placeholder="Reference details (e.g. sd)">' +
            '</div>' +
            '<div class="inv-field-group">' +
              '<label class="inv-label">PO REFERENCE</label>' +
              '<input type="text" id="edPo" class="inv-input-box" value="' + esc(draft.poReference || '') + '" placeholder="PO Number">' +
            '</div>' +
          '</div>' +

          '<div class="inv-page-footer">' +
            '<span>https://gwgc.cloud</span>' +
            '<span>1/3</span>' +
          '</div>' +
        '</div>' +

        /* PAGE 2: FROM, INVOICE DETAILS, LINE ITEMS, WAYS TO PAY, SUBTOTAL */
        '<div class="invoice-page invoice-page-2">' +
          '<div class="inv-doc-top-bar noprint">' +
            '<span class="inv-page-tag">PAGE 2 / 3 — INVOICE DETAILS &amp; LINE ITEMS</span>' +
          '</div>' +

          '<div class="inv-field-group" style="margin-top:10px">' +
            '<label class="inv-label">FROM</label>' +
            '<input type="text" id="edFrom" class="inv-input-box" value="' + esc(draft.fromLocation || 'Maple Ridge, BC') + '" placeholder="Origin facility">' +
          '</div>' +

          '<div class="inv-sec-title">INVOICE DETAILS</div>' +

          '<div class="inv-field-group">' +
            '<label class="inv-label">INVOICE NO.</label>' +
            '<div class="inv-input-box mono" id="edInvNoDisplay" style="background:var(--panel-2);color:var(--ink-2)">' + esc(draft.invoiceNumber || 'assigned on save') + '</div>' +
          '</div>' +

          '<div class="inv-field-group">' +
            '<label class="inv-label">INVOICE DATE</label>' +
            '<input type="date" id="edDate" class="inv-input-box" value="' + esc(draft.invoiceDate) + '">' +
          '</div>' +

          '<div class="inv-field-group">' +
            '<label class="inv-label">DUE DATE</label>' +
            '<input type="date" id="edDueDate" class="inv-input-box" value="' + esc(draft.dueDate) + '">' +
          '</div>' +

          /* LINE ITEMS AREA */
          '<div class="inv-lines-container" id="edLinesWrap">' +
            draft.items.map(function (it, idx) {
              return '<div class="inv-line-card" data-line="' + idx + '">' +
                '<div class="inv-line-header">' +
                  '<span class="inv-line-num">#</span>' +
                  '<span class="inv-line-idx">' + (idx + 1) + '.</span>' +
                  (draft.items.length > 1 ? '<button type="button" class="btn ghost btn-sm text-crit ed-del-line noprint" title="Remove line item" style="margin-left:auto"><svg><use href="#i-trash"></use></svg> Remove</button>' : '') +
                '</div>' +

                '<div class="inv-field-group">' +
                  '<label class="inv-label">DESCRIPTION</label>' +
                  '<input type="text" class="inv-input-box ed-desc" value="' + esc(it.description) + '" placeholder="Line item description (e.g. sgfs)">' +
                '</div>' +

                '<div class="grid g2" style="gap:12px">' +
                  '<div class="inv-field-group">' +
                    '<label class="inv-label">UNIT</label>' +
                    '<input type="text" class="inv-input-box ed-unit" value="' + esc(it.unit) + '" placeholder="e.g. 10, kg, cases">' +
                  '</div>' +
                  '<div class="inv-field-group">' +
                    '<label class="inv-label">QTY</label>' +
                    '<input type="number" step="any" class="inv-input-box ed-qty" value="' + (it.quantity != null ? it.quantity : '') + '" placeholder="0">' +
                  '</div>' +
                '</div>' +

                '<div class="grid g2" style="gap:12px">' +
                  '<div class="inv-field-group">' +
                    '<label class="inv-label">RATE</label>' +
                    '<input type="number" step="any" class="inv-input-box ed-price" value="' + (it.unitPrice != null ? it.unitPrice : '') + '" placeholder="0.00">' +
                  '</div>' +
                  '<div class="inv-field-group">' +
                    '<label class="inv-label">DISCOUNT</label>' +
                    '<input type="number" step="any" class="inv-input-box ed-disc" value="' + (it.discount != null ? it.discount : '') + '" placeholder="0.00">' +
                  '</div>' +
                '</div>' +

                '<div class="inv-amount-direction-row">' +
                  '<div>' +
                    '<label class="inv-label">AMOUNT</label>' +
                    '<div class="inv-line-amount-val mono">' + moneyDollars(lineAmountDollars(it)) + '</div>' +
                  '</div>' +
                  '<div style="text-align:right">' +
                    '<label class="inv-label">DIRECTION</label>' +
                    '<button type="button" class="inv-direction-pill ' + (it.isRebate ? 'pill-rebate' : 'pill-charge') + ' ed-toggle-rebate">' +
                      (it.isRebate ? 'REBATE' : 'CHARGE') +
                    '</button>' +
                  '</div>' +
                '</div>' +
              '</div>';
            }).join('') +
          '</div>' +

          '<button type="button" class="btn ghost btn-sm noprint" id="edAddLine" style="margin:16px 0">' +
            '<svg><use href="#i-plus"></use></svg> Add Line Item' +
          '</button>' +

          '<div class="inv-field-group" style="margin-top:20px">' +
            '<label class="inv-label">WAYS TO PAY</label>' +
            '<textarea id="edWaysToPay" class="inv-textarea-box" rows="2" placeholder="Payment instructions">' + esc(draft.paymentInstructions || 'sales@greenwaverecycling.ca\n6724720423') + '</textarea>' +
          '</div>' +

          '<div class="inv-subtotal-row">' +
            '<span class="inv-summary-label">Subtotal</span>' +
            '<span class="inv-summary-val mono" id="edSubtotalVal">' + moneyDollars(tot.subtotal) + '</span>' +
          '</div>' +

          '<div class="inv-page-footer">' +
            '<span>https://gwgc.cloud</span>' +
            '<span>2/3</span>' +
          '</div>' +
        '</div>' +

        /* PAGE 3: TAX CALCULATION (GST @ 5%), GRAND TOTAL */
        '<div class="invoice-page invoice-page-3">' +
          '<div class="inv-doc-top-bar noprint">' +
            '<span class="inv-page-tag">PAGE 3 / 3 — TAX &amp; GRAND TOTAL</span>' +
          '</div>' +

          '<div class="inv-tax-row">' +
            '<div class="inv-tax-label-box">' +
              '<input type="text" id="edTaxLabel" class="inv-bare-input" value="' + esc(draft.taxLabel || 'GST @ 5%') + '" placeholder="Tax Label">' +
            '</div>' +
            '<div class="inv-tax-rate-box">' +
              '<input type="number" step="any" id="edTaxRate" class="inv-bare-input" value="' + esc(draft.taxRatePct != null ? draft.taxRatePct : 5) + '" style="width:50px;text-align:center"> %' +
            '</div>' +
            '<div class="inv-tax-val mono" id="edTaxVal">' + moneyDollars(tot.tax) + '</div>' +
          '</div>' +

          '<div class="inv-grand-total-row">' +
            '<span class="inv-grand-label">Total</span>' +
            '<span class="inv-grand-val mono" id="edTotalVal">' + moneyDollars(tot.total) + '</span>' +
          '</div>' +

          '<div class="inv-editor-actions noprint" style="margin-top:40px;display:flex;gap:12px;justify-content:flex-end">' +
            '<button type="button" class="btn ghost" id="edPrintBottom"><svg><use href="#i-print"></use></svg> Print / PDF</button>' +
            '<button type="button" class="btn btn-primary" id="edSaveBottom"><svg><use href="#i-check"></use></svg> Save Invoice</button>' +
          '</div>' +

          '<div class="inv-page-footer">' +
            '<span>https://gwgc.cloud</span>' +
            '<span>3/3</span>' +
          '</div>' +
        '</div>' +

      '</div>';

    $('#editorBody').innerHTML = html;

    // Real-time calculation updater across all fields
    var syncDraftValues = function () {
      draft.billTo = ($('#edBill') || {}).value || '';
      draft.shipTo = ($('#edShip') || {}).value || '';
      draft.reference = ($('#edRef') || {}).value || '';
      draft.poReference = ($('#edPo') || {}).value || '';
      draft.fromLocation = ($('#edFrom') || {}).value || '';
      draft.invoiceDate = ($('#edDate') || {}).value || today();
      draft.dueDate = ($('#edDueDate') || {}).value || today();
      draft.taxLabel = ($('#edTaxLabel') || {}).value || 'GST @ 5%';
      draft.taxRatePct = parseQty(($('#edTaxRate') || {}).value);
      draft.paymentInstructions = ($('#edWaysToPay') || {}).value || '';

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
        gst: coGst || 'GST/HST Registration No. 751161951RT0001',
        line1: coLine1 || '23394 Fisherman Rd,',
        line2: coLine2 || 'Maple Ridge, BC V2W 1B9',
        email: coEmail || 'sales@greenwaverecycling.ca',
        phone: coPhone || '6724720423'
      };

      $$('#edLinesWrap .inv-line-card').forEach(function (card) {
        var idx = Number(card.dataset.line);
        if (draft.items[idx]) {
          draft.items[idx].description = (card.querySelector('.ed-desc') || {}).value || '';
          draft.items[idx].unit = (card.querySelector('.ed-unit') || {}).value || '';
          draft.items[idx].quantity = parseQty((card.querySelector('.ed-qty') || {}).value);
          draft.items[idx].unitPrice = parseQty((card.querySelector('.ed-price') || {}).value);
          draft.items[idx].discount = parseQty((card.querySelector('.ed-disc') || {}).value);

          var amtEl = card.querySelector('.inv-line-amount-val');
          if (amtEl) amtEl.textContent = moneyDollars(lineAmountDollars(draft.items[idx]));
        }
      });

      var currentTot = totalsLocal(draft);
      var subEl = $('#edSubtotalVal');
      if (subEl) subEl.textContent = moneyDollars(currentTot.subtotal);
      var taxEl = $('#edTaxVal');
      if (taxEl) taxEl.textContent = moneyDollars(currentTot.tax);
      var totEl = $('#edTotalVal');
      if (totEl) totEl.textContent = moneyDollars(currentTot.total);
    };

    $$('#editorBody input, #editorBody textarea').forEach(function (inp) {
      inp.addEventListener('input', syncDraftValues);
    });

    $('#edAddLine').addEventListener('click', function () {
      draft.items.push(blankLine());
      renderEditor();
    });

    $$('.ed-del-line').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        var card = btn.closest('.inv-line-card');
        var idx = Number(card.dataset.line);
        draft.items.splice(idx, 1);
        if (!draft.items.length) draft.items.push(blankLine());
        renderEditor();
      });
    });

    $$('.ed-toggle-rebate').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var card = btn.closest('.inv-line-card');
        var idx = Number(card.dataset.line);
        draft.items[idx].isRebate = !draft.items[idx].isRebate;
        btn.classList.toggle('pill-rebate', draft.items[idx].isRebate);
        btn.classList.toggle('pill-charge', !draft.items[idx].isRebate);
        btn.textContent = draft.items[idx].isRebate ? 'REBATE' : 'CHARGE';
        syncDraftValues();
      });
    });

    var doPrint = function () { window.print(); };
    $('#edPrint').onclick = doPrint;
    var printBottom = $('#edPrintBottom');
    if (printBottom) printBottom.onclick = doPrint;

    var doSave = function () {
      syncDraftValues();

      var payload = {
        warehouseId: draft.warehouseId || warehouseId,
        invoiceDate: draft.invoiceDate || today(),
        dueDate: draft.dueDate || today(),
        billTo: draft.billTo || '',
        shipTo: draft.shipTo || '',
        poReference: draft.poReference || '',
        paymentTerms: String(draft.termsDays || 15) + ' days',
        companyInfo: draft.companyInfo,
        paymentInstructions: draft.paymentInstructions,
        notes: draft.reference || '',
        taxLabel: draft.taxLabel || 'GST @ 5%',
        taxRate: Number(draft.taxRatePct) || 5,
        items: draft.items.map(function (it) {
          return {
            description: it.description || 'General Service',
            unit: it.unit || '',
            quantity: Number(it.quantity) || 1,
            unitPrice: Number(it.unitPrice) || 0,
            discount: Number(it.discount) || 0,
            isRebate: !!it.isRebate
          };
        })
      };

      var btnTop = $('#edSave'); if (btnTop) btnTop.disabled = true;
      var btnBottom = $('#edSaveBottom'); if (btnBottom) btnBottom.disabled = true;

      var req = draft.id ? Api.updateInvoice(draft.id, payload) : Api.createInvoice(payload);
      req.then(function (res) {
        toast('Invoice saved (#' + res.invoiceNumber + ').');
        draft = null;
        show('invoices');
      }).catch(function (err) {
        if (btnTop) btnTop.disabled = false;
        if (btnBottom) btnBottom.disabled = false;
        toast(err.message || 'Could not save invoice.');
      });
    };

    $('#edSave').onclick = doSave;
    var saveBottom = $('#edSaveBottom');
    if (saveBottom) saveBottom.onclick = doSave;
  }

  function renderCustomers() {
    loadingState('#customerBody');
    Api.listCustomers(warehouseId).then(function (list) {
      if (!list.length) {
        $('#customerBody').innerHTML = emptyState('users', 'No customers saved yet',
          'Save customer addresses and billing information.', 'Add customer', 'newCustomer');
        return;
      }
      $('#customerBody').innerHTML = '<div class="card"><div class="tablewrap"><table class="table"><thead><tr>' +
        '<th>Customer Name</th><th>Bill To</th><th>Ship To</th><th>Email</th></tr></thead><tbody>' +
        list.map(function (c) {
          return '<tr><td><strong>' + esc(c.name) + '</strong></td><td>' + esc((c.billTo || '').split('\n')[0] || '—') + '</td>' +
            '<td>' + esc((c.shipTo || '').split('\n')[0] || '—') + '</td><td>' + esc(c.email || '—') + '</td></tr>';
        }).join('') + '</tbody></table></div></div>';
    }).catch(function (err) { apiErrorState('#customerBody', err); });
  }

  function renderProducts() {
    $('#prodTitle').textContent = isRecycling() ? 'Materials Catalog' : 'Healthcare Products';
    loadingState('#productBody');
    Api.listMaterials().then(function (all) {
      var list = visibleMaterials(all);
      if (!list.length) {
        $('#productBody').innerHTML = emptyState('tag', 'No catalog items',
          'Add materials or products to track inventory and prices.', 'Add material', 'newProduct');
        return;
      }
      $('#productBody').innerHTML = '<div class="card"><div class="tablewrap"><table class="table"><thead><tr>' +
        '<th>Name</th><th>Category</th><th>Unit</th><th class="num">Default Price</th></tr></thead><tbody>' +
        list.map(function (m) {
          return '<tr><td><strong>' + esc(m.name) + '</strong></td><td>' + esc(m.category || '—') + '</td>' +
            '<td>' + esc(m.unit) + '</td><td class="num">' + (m.defaultPrice ? moneyDollars(m.defaultPrice) : '—') + '</td></tr>';
        }).join('') + '</tbody></table></div></div>';
    }).catch(function (err) { apiErrorState('#productBody', err); });
  }

  function renderStaff() {
    if (!isAdmin()) return;
    loadingState('#staffBody');
    Api.listUsers().then(function (users) {
      usersCache = users;
      $('#staffBody').innerHTML = '<div class="card"><div class="tablewrap"><table class="table"><thead><tr>' +
        '<th>Staff Name</th><th>Email</th><th>Role</th><th>Created</th></tr></thead><tbody>' +
        users.map(function (u) {
          return '<tr><td><strong>' + esc(u.name || u.fullName) + '</strong></td><td>' + esc(u.email) + '</td>' +
            '<td><span class="badge ' + (u.role === 'admin' ? 'badge-in' : 'badge-transit') + '">' + esc(u.role) + '</span></td>' +
            '<td class="mono" style="font-size:12.5px">' + esc(when(u.createdAt).split(' ')[0]) + '</td></tr>';
        }).join('') + '</tbody></table></div></div>';
    }).catch(function (err) { apiErrorState('#staffBody', err); });
  }

  function renderHistory() {
    loadingState('#historyBody');
    Api.listAudit({ warehouseId: warehouseId }).then(function (logs) {
      if (!logs.length) {
        $('#historyBody').innerHTML = emptyState('history', 'No audit logs yet', 'Every sign-in, transaction, and update is logged here.');
        return;
      }
      $('#historyBody').innerHTML = '<div class="card"><div class="tablewrap"><table class="table"><thead><tr>' +
        '<th>Timestamp</th><th>Action</th><th>Summary</th><th>Actor</th></tr></thead><tbody>' +
        logs.map(function (l) {
          return '<tr><td class="mono" style="font-size:12.5px">' + esc(when(l.occurredAt)) + '</td>' +
            '<td><span class="badge badge-transit">' + esc(l.action) + '</span></td>' +
            '<td>' + esc(l.summary) + '</td>' +
            '<td style="color:var(--muted)">' + esc(userName(l.actorUserId)) + ' (' + esc(l.actorRole || '') + ')</td></tr>';
        }).join('') + '</tbody></table></div></div>';
    }).catch(function (err) { apiErrorState('#historyBody', err); });
  }

  function renderSettings() {
    var co = db.company || {};
    $('#settingsBody').innerHTML = '<div class="card pad">' +
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

    $('#setForm').addEventListener('submit', function (e) {
      e.preventDefault();
      db.company = {
        name: $('[name="name"]', '#setForm').value.trim(),
        line1: $('[name="line1"]', '#setForm').value.trim(),
        line2: $('[name="line2"]', '#setForm').value.trim(),
        phone: $('[name="phone"]', '#setForm').value.trim(),
        email: $('[name="email"]', '#setForm').value.trim(),
        bn: $('[name="bn"]', '#setForm').value.trim(),
        gst: $('[name="gst"]', '#setForm').value.trim()
      };
      S.save(db);
      toast('Company settings saved.');
    });
  }

  function openModal(title, bodyHtml, onSave) {
    var wrap = $('#modalWrap');
    $('#modalTitle').textContent = title;
    $('#modalForm').innerHTML = bodyHtml;
    wrap.hidden = false;

    var close = function () { wrap.hidden = true; };
    $('#modalClose').onclick = close;
    $('#modalCancel').onclick = close;

    $('#modalForm').onsubmit = function (e) {
      e.preventDefault();
      var fd = {};
      new FormData($('#modalForm')).forEach(function (v, k) { fd[k] = v; });
      var res = onSave(fd);
      if (res && typeof res.then === 'function') {
        res.then(close).catch(function (err) { toast(err.message || 'Action failed.'); });
      } else {
        close();
      }
    };
  }

  function render() {
    syncChrome();
    if (view === 'inventory') renderInventory();
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
    Api.me().then(function (user) {
      me = {
        id: user.id,
        name: user.fullName || user.email,
        email: user.email,
        role: user.role
      };
      S.setServerSession(me);

      $('#gate').hidden = true;
      $('#app').hidden = false;

      return Api.listWarehouses(false).then(function (whs) {
        warehouses = whs || [];
        if (!warehouses.length) {
          warehouses = [
            { id: '22222222-2222-4222-8222-222222222222', name: 'Calgary, AB', code: 'CGY', province: 'AB' },
            { id: '33333333-3333-4333-8333-333333333333', name: 'Ontario', code: 'ON', province: 'ON' },
            { id: '11111111-1111-4111-8111-111111111111', name: 'Maple Ridge, BC', code: 'MR', province: 'BC' }
          ];
        }

        if (!warehouseId || !warehouses.some(function (w) { return w.id === warehouseId; })) {
          warehouseId = warehouses[0].id;
          S.setWarehouse(warehouseId);
        }

        refreshShiftChip();
        refreshOnlineStaff();

        if (chatOnlineTimer) clearInterval(chatOnlineTimer);
        chatOnlineTimer = setInterval(refreshOnlineStaff, 30000);

        show(view);
      });
    }).catch(function (err) {
      showGate();
    });
  }

  function attachEvents() {
    setupSignIn();
    setupChatComposer();

    $('#wh').addEventListener('change', function (e) {
      warehouseId = e.target.value;
      S.setWarehouse(warehouseId);
      render();
    });

    $$('.entsw button').forEach(function (b) {
      b.addEventListener('click', function () {
        entity = b.dataset.entity;
        db.entity = entity;
        S.save(db);
        if (view === 'invoices' && isHealthcare()) view = 'inventory';
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

    $('#btnReceiveStock').addEventListener('click', openReceiveModal);
    $('#btnShipStock').addEventListener('click', openShipModal);
    var adjBtn = $('#btnAdjustStock');
    if (adjBtn) adjBtn.addEventListener('click', openAdjustModal);
    $('#btnExportInventory').addEventListener('click', exportInventoryCsv);

    $$('.inven-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        $$('.inven-tab').forEach(function (t) { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        invenTab = tab.dataset.tab;
        renderInventory();
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
    var typeFilter = $('#invenTypeFilter');
    if (typeFilter) {
      typeFilter.addEventListener('change', function () {
        invenTypeFilter = typeFilter.value;
        renderInventory();
      });
    }

    $('#addPhoto').addEventListener('click', function () { $('#photoFile').click(); });
    $('#photoFile').addEventListener('change', function (e) { addPhotos(e.target.files); });
    $('#lbClose').addEventListener('click', function () { $('#lightbox').hidden = true; });

    $('#newInvoice').addEventListener('click', function () { draft = newDraft(); show('editor'); });
    $('#newCustomer').addEventListener('click', function () {
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

    $('#newProduct').addEventListener('click', function () {
      openModal('Add ' + (isRecycling() ? 'Material' : 'Product'),
        field('name', 'Name', { required: true, placeholder: isRecycling() ? 'e.g. Mixed Electronics' : 'e.g. Synguard 100' }) +
        field('category', 'Category', { placeholder: isRecycling() ? 'e.g. electronics / metal' : 'e.g. healthcare / ppe' }) +
        field('unit', 'Unit of measure', { value: isRecycling() ? 'kg' : 'cases', required: true }) +
        field('defaultPrice', 'Default Price ($)', { type: 'number', step: '0.01', placeholder: '0.00' }),
        function (fd) {
          return Api.createMaterial({
            name: fd.name, category: fd.category, unit: fd.unit, defaultPrice: parseQty(fd.defaultPrice)
          }).then(function () { toast('Catalog item added.'); renderProducts(); });
        });
    });

    $('#newStaff').addEventListener('click', function () {
      openModal('Add Staff Member',
        field('fullName', 'Full Name', { required: true }) +
        field('email', 'Work Email', { type: 'email', required: true }) +
        field('password', 'Temporary Password', { type: 'password', required: true, help: 'Min 8 chars' }) +
        field('role', 'Role', {
          type: 'select',
          options: [
            { value: 'staff', label: 'Staff (Warehouse / Ops)' },
            { value: 'manager', label: 'Manager (Invoices & Adjustments)' },
            { value: 'admin', label: 'Administrator (Full Access)' }
          ]
        }),
        function (fd) {
          return Api.createUser({
            fullName: fd.fullName, email: fd.email, password: fd.password, role: fd.role
          }).then(function () { toast('Staff account created.'); renderStaff(); });
        });
    });

    $('#menuBtn').addEventListener('click', function () { $('#app').classList.toggle('menu-open'); });
    $('#signOut').addEventListener('click', signOut);

    document.addEventListener('click', function (e) {
      var goto = e.target.closest('[data-goto]');
      if (goto) { e.preventDefault(); show(goto.dataset.goto); }
      var act = e.target.closest('[data-action]');
      if (act) {
        var a = act.dataset.action;
        if (a === 'goProducts') show('products');
        else if (a === 'addPhoto') $('#addPhoto').click();
        else if (a === 'newInvoice') $('#newInvoice').click();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    attachEvents();
    if (Api.isAuthenticated()) {
      boot();
    } else {
      showGate();
    }
  });

})(window);
