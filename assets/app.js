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

    $$('[data-only], [data-role]').forEach(function (el) {
      var okEntity = !el.dataset.only || el.dataset.only === entity;
      var okRole = !el.dataset.role || (me && el.dataset.role.split(',').indexOf(me.role) >= 0);
      el.hidden = !(okEntity && okRole);
    });

    var prodEl = $('#productsNav');
    if (prodEl) prodEl.textContent = isRecycling() ? 'Materials' : 'Products';

    var inBtn = $('#btnReceiveStock');
    if (inBtn) inBtn.innerHTML = '<svg><use href="#i-plus"></use></svg>' + (isRecycling() ? 'Receive Pallets' : 'Receive Boxes');
    var outBtn = $('#btnShipStock');
    if (outBtn) outBtn.innerHTML = '<svg><use href="#i-truck"></use></svg>' + (isRecycling() ? 'Ship Pallets' : 'Ship Boxes');
    var invSub = $('#invenSub');
    if (invSub) invSub.textContent = isRecycling() ? 'Recycling Division — Pallet inventory balances, container tracking, and transaction ledger.' : 'Healthcare Division — Box inventory balances, container tracking, and transaction ledger.';
    var prodTitle = $('#prodTitle');
    if (prodTitle) prodTitle.textContent = isRecycling() ? 'Materials Catalog' : 'Healthcare Products Catalog';

    var meInitialsEl = $('#meInitials');
    if (meInitialsEl) meInitialsEl.textContent = me ? initials(me.name) : '';
    var meNameEl = $('#meName');
    if (meNameEl) meNameEl.textContent = me ? me.name : '';
    var meRoleEl = $('#meRole');
    if (meRoleEl) meRoleEl.textContent = me ? ((ROLES[me.role] || {}).label || me.role) : '';

    var whWrap = $('.wh');
    if (whWrap) {
      if (!warehouses || warehouses.length === 0) {
        whWrap.innerHTML = '<label>FACILITY</label><div class="wh-readonly-chip wh-unassigned" title="No assigned warehouse"><span class="wh-pin">⚠️</span> No warehouse assigned. Contact administrator.</div>';
      } else if (warehouses.length === 1) {
        warehouseId = warehouses[0].id;
        S.setWarehouse(warehouseId);
        whWrap.innerHTML = '<label>FACILITY (ASSIGNED)</label><div class="wh-readonly-chip" title="Assigned Facility"><span class="wh-pin">📍</span> ' + esc(warehouses[0].name) + '</div>';
      } else {
        whWrap.innerHTML = '<label for="wh">FACILITY</label><div class="wh-select-wrap"><select id="wh" aria-label="Selected Warehouse">' +
          warehouses.map(function (w) {
            return '<option value="' + esc(w.id) + '"' + (w.id === warehouseId ? ' selected' : '') + '>' + esc(w.name) + '</option>';
          }).join('') +
          '</select></div>';
        var sel = $('#wh');
        if (sel) {
          sel.value = warehouseId;
          sel.onchange = function (e) {
            warehouseId = e.target.value;
            S.setWarehouse(warehouseId);
            render();
          };
        }
      }
    }

    var w = warehouse();
    var prov = (w && w.province) || 'BC';
    var taxNoteEl = $('#taxNote');
    if (taxNoteEl) taxNoteEl.textContent = w ? prov + ' · ' + taxFor(prov).label : '';

    renderTabbar();
    renderShiftChip();
  }

  function renderTabbar() {
    var items = [
      { v: 'inventory', i: 'box',   l: isRecycling() ? 'Pallets' : 'Boxes' },
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
    var app = $('#app');
    if (app) app.classList.remove('menu-open');
    var scroll = $('#scroll');
    if (scroll) scroll.scrollTop = 0;
    renderTabbar();
    render();
  }

  function renderInventory() {
    var w = warehouse();
    var invSub = $('#invenSub');
    if (invSub) invSub.textContent = w ? 'Live balances & transactions at ' + w.name + ' (PostgreSQL ledger).' : '';
    var invBody = $('#invenBody');
    if (!w) { if (invBody) invBody.innerHTML = ''; return; }

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

      var elCur = $('#kpiCurrentStock'); if (elCur) elCur.textContent = num(grandCurrent);
      var elIn = $('#kpiInboundTotal'); if (elIn) elIn.textContent = num(grandInbound);
      var elOut = $('#kpiOutboundTotal'); if (elOut) elOut.textContent = num(grandOutbound);
      var elAdj = $('#kpiAdjustmentTotal'); if (elAdj) elAdj.textContent = (grandAdj >= 0 ? '+' : '') + num(grandAdj);

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
    var invBody = $('#invenBody');
    if (!invBody) return;
    if (!materials.length) {
      invBody.innerHTML = emptyState('tag', isRecycling() ? 'No materials cataloged' : 'No products cataloged',
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

    var invBody = $('#invenBody');
    if (invBody) {
      invBody.innerHTML = '<div class="card">' +
        '<div class="tablewrap"><table class="table">' +
        '<thead>' + head + '</thead>' +
        '<tbody>' + (body || '<tr><td colspan="11" style="text-align:center;color:var(--muted);padding:30px">No matching stock balances found.</td></tr>') + '</tbody>' +
        foot +
        '</table></div></div>';
    }
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
      '<th>Unit</th>' +
      '<th>Weight</th>' +
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
      var unitStr = (t.unitType || (isRecycling() ? 'pallet' : 'box')).toUpperCase();
      var weightStr = (t.weightValue != null && Number(t.weightValue) > 0) ? (num(t.weightValue) + ' ' + (t.weightUnit || 'kg').toUpperCase()) : '—';

      return '<tr class="clickable-row" data-tx="' + esc(t.id) + '" title="Click to view full transaction details and photos">' +
        '<td class="mono" style="font-size:12.5px">' + esc(when(t.createdAt).split(' ')[0]) + '</td>' +
        '<td class="mono"><strong>' + esc(t.orderNumber || t.reference || '—') + '</strong></td>' +
        '<td><span class="badge ' + badgeClass + '">' + typeLabel + '</span></td>' +
        '<td>' + esc(m.name) + '</td>' +
        '<td><span class="mono" style="font-size:11.5px;font-weight:700">' + esc(unitStr) + '</span></td>' +
        '<td class="mono" style="font-size:12px">' + esc(weightStr) + '</td>' +
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

    var invBody = $('#invenBody');
    if (invBody) {
      invBody.innerHTML = '<div class="card">' +
        '<div class="tablewrap"><table class="table">' +
        '<thead>' + head + '</thead>' +
        '<tbody>' + (body || '<tr><td colspan="15" style="text-align:center;color:var(--muted);padding:30px">No matching transactions found.</td></tr>') + '</tbody>' +
        '</table></div></div>';
    }

    $$('.clickable-row[data-tx]').forEach(function (row) {
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
            return '<div class="tx-photo-card" data-url="' + esc(p.url) + '" data-meta="' + esc(p.filename || 'Photo') + '">' +
              '<img src="' + esc(p.url) + '" alt="Photo" class="tx-photo-img">' +
              '<div class="tx-photo-meta">' + esc(p.filename || 'Photo') + '</div>' +
              '</div>';
          }).join('') +
          '</div></div>';
      } else {
        photoHtml = '<div class="tx-detail-item" style="grid-column: 1 / -1;margin-top:8px"><span class="tx-detail-label">Associated Photos</span><span class="tx-detail-val" style="color:var(--muted)">— None attached</span></div>';
      }

      var weightStr = (tx.weightValue != null && Number(tx.weightValue) > 0) ? (num(tx.weightValue) + ' ' + (tx.weightUnit || 'KG').toUpperCase()) : '—';
      var typeLabel = tx.type === 'inbound' ? 'Inbound (IN)' : tx.type === 'outbound' ? 'Outbound (OUT)' : 'Adjustment (ADJ)';
      var divLabel = tx.division === 'recycling' ? 'Recycling (Pallets)' : (tx.division === 'healthcare' ? 'Healthcare (Boxes)' : (tx.division || '—'));
      var unitLabel = tx.unitType ? tx.unitType.toUpperCase() : '—';

      var bodyHtml =
        '<div class="tx-detail-card">' +
          '<div class="tx-detail-grid">' +
            '<div class="tx-detail-item"><span class="tx-detail-label">Transaction ID</span><span class="tx-detail-val mono" style="font-size:12px">' + esc(tx.id) + '</span></div>' +
            '<div class="tx-detail-item"><span class="tx-detail-label">Recorded At</span><span class="tx-detail-val mono">' + esc(when(tx.createdAt)) + '</span></div>' +
            '<div class="tx-detail-item"><span class="tx-detail-label">Facility / Warehouse</span><span class="tx-detail-val">📍 ' + esc(tx.warehouseName || 'Assigned Facility') + (tx.warehouseCode ? ' (' + esc(tx.warehouseCode) + ')' : '') + '</span></div>' +
            '<div class="tx-detail-item"><span class="tx-detail-label">Division</span><span class="tx-detail-val">🏢 ' + esc(divLabel) + '</span></div>' +
            '<div class="tx-detail-item"><span class="tx-detail-label">Transaction Type</span><span class="tx-detail-val"><strong>' + esc(typeLabel) + '</strong></span></div>' +
            '<div class="tx-detail-item"><span class="tx-detail-label">Order / Reference #</span><span class="tx-detail-val mono"><strong>' + esc(tx.orderNumber || tx.reference || '—') + '</strong></span></div>' +
            '<div class="tx-detail-item"><span class="tx-detail-label">Product / Material</span><span class="tx-detail-val"><strong>' + esc(tx.materialName || '—') + '</strong></span></div>' +
            '<div class="tx-detail-item"><span class="tx-detail-label">Unit Type</span><span class="tx-detail-val">' + esc(unitLabel) + '</span></div>' +
            '<div class="tx-detail-item"><span class="tx-detail-label">Recorded Weight</span><span class="tx-detail-val mono">⚖️ ' + esc(weightStr) + '</span></div>' +
            '<div class="tx-detail-item"><span class="tx-detail-label">Total Unit Quantity</span><span class="tx-detail-val mono text-success" style="font-size:16px"><strong>' + num(tx.total) + '</strong></span></div>' +
            '<div class="tx-detail-item" style="grid-column: 1 / -1"><span class="tx-detail-label">Size Breakdown (XL / L / M / S)</span><span class="tx-detail-val mono">XL: ' + num(tx.xl) + '  |  L: ' + num(tx.l) + '  |  M: ' + num(tx.m) + '  |  S: ' + num(tx.s) + '</span></div>' +
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
        '<div class="tablewrap"><table class="table">' +
        '<thead>' + head + '</thead>' +
        '<tbody>' + (body || '<tr><td colspan="13" style="text-align:center;color:var(--muted);padding:30px">No container records found.</td></tr>') + '</tbody>' +
        '</table></div></div>';
    }
  }

  function openReceiveModal() {
    var w = warehouse();
    if (!w) { toast('Please select a warehouse first.'); return; }

    Api.listMaterials().then(function (all) {
      var mats = visibleMaterials(all);
      if (!mats.length) { toast('Please create materials in the catalog first.'); return; }

      var isRec = isRecycling();
      var unitType = isRec ? 'pallet' : 'box';
      var unitLabel = isRec ? 'PALLET' : 'BOX';
      var divName = isRec ? 'recycling' : 'healthcare';

      var formHtml =
        '<div class="grid g2">' +
          '<div class="field"><label>Warehouse Location</label><input type="text" value="' + esc(w.name) + '" readonly style="background:var(--panel-2)"></div>' +
          '<div class="field"><label>Division &amp; Packaging</label><div class="division-chip ' + (isRec ? '' : 'healthcare') + '">' + (isRec ? '♻️ Recycling — PALLETS' : '🏥 Healthcare — BOXES') + '</div></div>' +
        '</div>' +
        '<div class="grid g2">' +
          '<div class="field"><label>Date</label><input type="date" name="date" value="' + today() + '" required></div>' +
          '<div class="field"><label>Order Number (e.g. Jul20-DIVESTPC-AB38A)</label><input type="text" name="orderNumber" placeholder="Order / PO #" required></div>' +
        '</div>' +
        '<div class="field"><label>' + (isRec ? 'Material' : 'Product') + '</label><select name="materialId" required>' +
          mats.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + ' (' + esc(m.unit) + ')</option>'; }).join('') +
        '</select></div>' +
        '<div class="grid g2">' +
          '<div class="field"><label>Dedicated Weight</label>' +
            '<div class="weight-input-group">' +
              '<input type="number" name="weightValue" step="any" min="0" placeholder="e.g. 3658">' +
              '<select name="weightUnit" class="weight-unit-select"><option value="kg" selected>KG</option><option value="lb">LB</option></select>' +
            '</div>' +
          '</div>' +
          '<div class="field"><label>Container Number (e.g. MSMU 6896930)</label><input type="text" name="containerNumber" placeholder="MSMU 6896930"></div>' +
        '</div>' +
        '<div class="field"><label>Seal Number (e.g. 0336695)</label><input type="text" name="sealNumber" placeholder="0336695"></div>' +
        '<label style="font-size:13px;font-weight:600;margin-top:10px;display:block">Quantities by Size (Whole ' + unitLabel + ' counts only)</label>' +
        '<div class="sizes-grid">' +
          '<div class="field"><label>XL</label><input type="number" name="xl" min="0" step="1" placeholder="0" class="size-input"></div>' +
          '<div class="field"><label>L</label><input type="number" name="l" min="0" step="1" placeholder="0" class="size-input"></div>' +
          '<div class="field"><label>M</label><input type="number" name="m" min="0" step="1" placeholder="0" class="size-input"></div>' +
          '<div class="field"><label>S</label><input type="number" name="s" min="0" step="1" placeholder="0" class="size-input"></div>' +
        '</div>' +
        '<div class="total-preview-box">' +
          '<span class="total-preview-label">Calculated Total (' + unitLabel + 'S = XL + L + M + S):</span>' +
          '<span class="total-preview-val" id="modalAutoTotal">0</span>' +
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

      var selectedPhotoFile = null;

      openModal('Receive Inbound (' + unitLabel + 'S)', formHtml, function (fd) {
        var parseWhole = function (val) {
          if (!val || val === '') return 0;
          var n = Number(val);
          if (isNaN(n) || !Number.isInteger(n) || n < 0) {
            throw new Error('Quantity counts must be non-negative whole integers (received ' + val + ').');
          }
          return n;
        };

        var xl, l, m, s;
        try {
          xl = parseWhole(fd.xl);
          l = parseWhole(fd.l);
          m = parseWhole(fd.m);
          s = parseWhole(fd.s);
        } catch (e) {
          toast(e.message);
          return Promise.reject(e);
        }

        var total = xl + l + m + s;
        if (total <= 0) { toast('Please enter a quantity for at least one size.'); return Promise.reject(new Error('Zero quantity')); }

        var weightVal = fd.weightValue ? Number(fd.weightValue) : undefined;
        if (weightVal !== undefined && (isNaN(weightVal) || weightVal < 0)) {
          toast('Weight value must be a positive number.');
          return Promise.reject(new Error('Invalid weight'));
        }

        var doSubmit = function (photoId) {
          var payload = {
            warehouseId: w.id,
            materialId: fd.materialId,
            type: 'inbound',
            division: divName,
            unitType: unitType,
            weightValue: weightVal,
            weightUnit: fd.weightUnit || 'kg',
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
          return Api.uploadPhoto(selectedPhotoFile, {
            warehouseId: w.id,
            photoType: 'inventory_inbound',
            jobReference: fd.orderNumber
          }).then(function (res) {
            return doSubmit(res.id);
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

      $$('.size-input').forEach(function (inp) {
        inp.addEventListener('input', function () {
          var t = 0;
          $$('.size-input').forEach(function (x) { t += Math.floor(Number(x.value) || 0); });
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

      var isRec = isRecycling();
      var unitType = isRec ? 'pallet' : 'box';
      var unitLabel = isRec ? 'PALLET' : 'BOX';
      var divName = isRec ? 'recycling' : 'healthcare';

      var formHtml =
        '<div class="grid g2">' +
          '<div class="field"><label>Warehouse Location</label><input type="text" value="' + esc(w.name) + '" readonly style="background:var(--panel-2)"></div>' +
          '<div class="field"><label>Division &amp; Packaging</label><div class="division-chip ' + (isRec ? '' : 'healthcare') + '">' + (isRec ? '♻️ Recycling — PALLETS' : '🏥 Healthcare — BOXES') + '</div></div>' +
        '</div>' +
        '<div class="grid g2">' +
          '<div class="field"><label>Date</label><input type="date" name="date" value="' + today() + '" required></div>' +
          '<div class="field"><label>Order / Reference #</label><input type="text" name="orderNumber" placeholder="Order / BOL #" required></div>' +
        '</div>' +
        '<div class="field"><label>' + (isRec ? 'Material' : 'Product') + '</label><select name="materialId" required>' +
          mats.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + ' (' + esc(m.unit) + ')</option>'; }).join('') +
        '</select></div>' +
        '<div class="grid g2">' +
          '<div class="field"><label>Container Number (optional)</label><input type="text" name="containerNumber" placeholder="MSMU 6896930 / Trailer"></div>' +
          '<div class="field"><label>Seal Number (optional)</label><input type="text" name="sealNumber" placeholder="0336695"></div>' +
        '</div>' +
        '<label style="font-size:13px;font-weight:600;margin-top:10px;display:block">Quantities to Dispatch (Whole ' + unitLabel + ' counts only)</label>' +
        '<div class="sizes-grid">' +
          '<div class="field"><label>XL</label><input type="number" name="xl" min="0" step="1" placeholder="0" class="size-input"></div>' +
          '<div class="field"><label>L</label><input type="number" name="l" min="0" step="1" placeholder="0" class="size-input"></div>' +
          '<div class="field"><label>M</label><input type="number" name="m" min="0" step="1" placeholder="0" class="size-input"></div>' +
          '<div class="field"><label>S</label><input type="number" name="s" min="0" step="1" placeholder="0" class="size-input"></div>' +
        '</div>' +
        '<div class="total-preview-box">' +
          '<span class="total-preview-label">Calculated Outbound Total:</span>' +
          '<span class="total-preview-val text-warning" id="modalAutoTotal">0</span>' +
        '</div>' +
        '<div class="field"><label>Notes / Outbound Details</label><input type="text" name="notes" placeholder="e.g. shipped via Trailer 12345"></div>';

      openModal('Ship Outbound (' + unitLabel + 'S)', formHtml, function (fd) {
        var parseWhole = function (val) {
          if (!val || val === '') return 0;
          var n = Number(val);
          if (isNaN(n) || !Number.isInteger(n) || n < 0) {
            throw new Error('Quantity counts must be non-negative whole integers (received ' + val + ').');
          }
          return n;
        };

        var xl, l, m, s;
        try {
          xl = parseWhole(fd.xl);
          l = parseWhole(fd.l);
          m = parseWhole(fd.m);
          s = parseWhole(fd.s);
        } catch (e) {
          toast(e.message);
          return Promise.reject(e);
        }

        var total = xl + l + m + s;
        if (total <= 0) { toast('Please enter a quantity for at least one size.'); return Promise.reject(new Error('Zero quantity')); }

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

      $$('.size-input').forEach(function (inp) {
        inp.addEventListener('input', function () {
          var t = 0;
          $$('.size-input').forEach(function (x) { t += Math.floor(Number(x.value) || 0); });
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

      var isRec = isRecycling();
      var unitType = isRec ? 'pallet' : 'box';
      var unitLabel = isRec ? 'PALLET' : 'BOX';
      var divName = isRec ? 'recycling' : 'healthcare';

      var formHtml =
        '<div class="grid g2">' +
          '<div class="field"><label>Warehouse Location</label><input type="text" value="' + esc(w.name) + '" readonly style="background:var(--panel-2)"></div>' +
          '<div class="field"><label>Division &amp; Packaging</label><div class="division-chip ' + (isRec ? '' : 'healthcare') + '">' + (isRec ? '♻️ Recycling — PALLETS' : '🏥 Healthcare — BOXES') + '</div></div>' +
        '</div>' +
        '<div class="field"><label>' + (isRec ? 'Material' : 'Product') + '</label><select name="materialId" required>' +
          mats.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + ' (' + esc(m.unit) + ')</option>'; }).join('') +
        '</select></div>' +
        '<div class="field"><label>Reason for Adjustment (Required)</label><input type="text" name="reason" placeholder="e.g. physical recount, adjusted 5 units to match count" required></div>' +
        '<label style="font-size:13px;font-weight:600;margin-top:10px;display:block">Adjustment Quantities (Whole ' + unitLabel + ' counts only)</label>' +
        '<div class="sizes-grid">' +
          '<div class="field"><label>XL</label><input type="number" name="xl" step="1" placeholder="0" class="size-input"></div>' +
          '<div class="field"><label>L</label><input type="number" name="l" step="1" placeholder="0" class="size-input"></div>' +
          '<div class="field"><label>M</label><input type="number" name="m" step="1" placeholder="0" class="size-input"></div>' +
          '<div class="field"><label>S</label><input type="number" name="s" step="1" placeholder="0" class="size-input"></div>' +
        '</div>' +
        '<div class="total-preview-box">' +
          '<span class="total-preview-label">Net Adjustment Total:</span>' +
          '<span class="total-preview-val text-accent" id="modalAutoTotal">0</span>' +
        '</div>';

      openModal('Adjust Stock Balance (' + unitLabel + 'S)', formHtml, function (fd) {
        var reason = (fd.reason || '').trim();
        if (!reason) { toast('Adjustment reason is required.'); return Promise.reject(new Error('Reason required')); }

        var parseWholeAdj = function (val) {
          if (!val || val === '') return 0;
          var n = Number(val);
          if (isNaN(n) || !Number.isInteger(n)) {
            throw new Error('Quantity counts must be whole integers (received ' + val + ').');
          }
          return n;
        };

        var xl, l, m, s;
        try {
          xl = parseWholeAdj(fd.xl);
          l = parseWholeAdj(fd.l);
          m = parseWholeAdj(fd.m);
          s = parseWholeAdj(fd.s);
        } catch (e) {
          toast(e.message);
          return Promise.reject(e);
        }

        var total = xl + l + m + s;
        if (total === 0 && !xl && !l && !m && !s) { toast('Enter adjustment values.'); return Promise.reject(new Error('Zero adjustment')); }

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

      $$('.size-input').forEach(function (inp) {
        inp.addEventListener('input', function () {
          var t = 0;
          $$('.size-input').forEach(function (x) { t += Math.floor(Number(x.value) || 0); });
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
    var titleEl = $('#intakeTitle');
    if (titleEl) titleEl.textContent = isRecycling() ? 'Weigh-in' : 'Receive stock';
    var subEl = $('#intakeSub');
    if (subEl) subEl.textContent = isRecycling()
      ? 'Gross less tare gives net. It posts to ' + (w ? w.name : 'the warehouse') + '.'
      : 'Count what arrived. It posts to ' + (w ? w.name : 'the warehouse') + '.';
    var body = $('#intakeBody');
    if (!w) { if (body) body.innerHTML = ''; return; }

    loadingState('#intakeBody');
    Api.listMaterials().then(function (all) {
      var list = visibleMaterials(all);
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

  function openLightbox(i) {
    var p = photoCache[i]; if (!p) return;
    var lbImg = $('#lbImg'); if (lbImg) lbImg.src = p.url;
    var lbMeta = $('#lbMeta');
    if (lbMeta) {
      lbMeta.innerHTML = esc(userName(p.takenBy)) + ' · ' + esc(when(p.takenAt)) +
        ' · ' + bytes(p.sizeBytes) +
        (p.jobReference ? '<br>' + esc(p.jobReference) : '') +
        (me && me.role === 'admin' ? '<br><button type="button" class="btn danger" id="lbDel" style="margin-top:12px">Delete this photo</button>' : '');
    }
    var lb = $('#lightbox');
    if (lb) lb.hidden = false;

    var del = $('#lbDel');
    if (del) del.addEventListener('click', function () {
      if (!confirm('Delete this photo permanently?')) return;
      Api.deletePhoto(p.id).then(function () {
        if (lb) lb.hidden = true;
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

      var clockBody = $('#clockBody');
      if (clockBody) {
        clockBody.innerHTML =
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
      }

      var clockBtn = $('#clockBtn');
      if (clockBtn) clockBtn.addEventListener('click', toggleClock);

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
    var w = warehouse();
    var t = w ? taxRule(w.province) : { label: 'GST @ 5%', rate: 0.05 };
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
        line1: co.line1 || '23394 Fisherman Rd,',
        line2: co.line2 || 'Maple Ridge, BC V2W 1B9',
        email: co.email || 'sales@greenwaverecycling.ca',
        phone: co.phone || '6724720423'
      },
      paymentInstructions: 'sales@greenwaverecycling.ca\n6724720423',
      notes: '',
      status: 'draft',
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
      var invList = $('#invoiceList');
      if (!invList) return;
      if (!list.length) {
        invList.innerHTML = emptyState('doc', 'No invoices yet',
          'Create professional invoices with rebate lines, tax calculation, and free text fields matching the Invoice 1114 reference.',
          'New invoice', 'newInvoice');
        return;
      }
      invList.innerHTML = '<div class="card"><div class="tablewrap"><table class="table"><thead><tr>' +
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
     Authoritative Invoice Editor & Print Layout (Aligned with Invoice 1114.pdf)
     ========================================================================== */
  function renderEditor() {
    if (!draft) draft = newDraft();
    var edTitle = $('#edTitle');
    if (edTitle) edTitle.textContent = draft.invoiceNumber ? 'Invoice ' + draft.invoiceNumber : 'New Invoice';

    var co = draft.companyInfo || {};
    var tot = totalsLocal(draft);

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
              '<input type="text" id="edCoLine1" class="inv-bare-input" value="' + esc(co.line1 || '23394 Fisherman Rd,') + '" placeholder="Address Line 1">' +
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
                  '<th style="width:60px">Unit.</th>' +
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

          /* 6. BOTTOM ACTIONS (Save, Print, Back) */
          '<div class="inv-1114-actions-bar noprint">' +
            '<button type="button" class="btn ghost" id="edPrintBottom"><svg><use href="#i-print"></use></svg>Print / Save PDF</button>' +
            '<button type="button" class="btn btn-primary" id="edSaveBottom"><svg><use href="#i-check"></use></svg>Save Invoice</button>' +
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
        line1: coLine1 || '23394 Fisherman Rd,',
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

    var doPrint = function () { window.print(); };
    var edPrint = $('#edPrint'); if (edPrint) edPrint.onclick = doPrint;
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

    var edSave = $('#edSave'); if (edSave) edSave.onclick = doSave;
    var saveBottom = $('#edSaveBottom');
    if (saveBottom) saveBottom.onclick = doSave;
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
      cBody.innerHTML = '<div class="card"><div class="tablewrap"><table class="table"><thead><tr>' +
        '<th>Customer Name</th><th>Bill To</th><th>Ship To</th><th>Email</th></tr></thead><tbody>' +
        list.map(function (c) {
          return '<tr><td><strong>' + esc(c.name) + '</strong></td><td>' + esc((c.billTo || '').split('\n')[0] || '—') + '</td>' +
            '<td>' + esc((c.shipTo || '').split('\n')[0] || '—') + '</td><td>' + esc(c.email || '—') + '</td></tr>';
        }).join('') + '</tbody></table></div></div>';
    }).catch(function (err) { apiErrorState('#customerBody', err); });
  }

  function renderProducts() {
    var pTitle = $('#prodTitle');
    if (pTitle) pTitle.textContent = isRecycling() ? 'Materials Catalog' : 'Healthcare Products';
    loadingState('#productBody');
    Api.listMaterials().then(function (all) {
      var list = visibleMaterials(all);
      var pBody = $('#productBody');
      if (!pBody) return;
      if (!list.length) {
        pBody.innerHTML = emptyState('tag', 'No catalog items',
          'Add materials or products to track inventory and prices.', 'Add material', 'newProduct');
        return;
      }
      pBody.innerHTML = '<div class="card"><div class="tablewrap"><table class="table"><thead><tr>' +
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
    Promise.all([
      Api.listUsers(),
      Api.listWarehouses(false)
    ]).then(function (res) {
      var users = res[0] || [];
      var allWhs = res[1] || [];
      usersCache = users;
      var sBody = $('#staffBody');
      if (!sBody) return;

      sBody.innerHTML = '<div class="card"><div class="tablewrap"><table class="table"><thead><tr>' +
        '<th>Staff Name</th><th>Email</th><th>Role</th><th>Assigned Facilities</th><th>Actions</th></tr></thead><tbody>' +
        users.map(function (u) {
          var assignedWhNames = (u.warehouses && u.warehouses.length)
            ? u.warehouses.map(function (w) { return esc(w.name); }).join(', ')
            : (u.role === 'admin' ? '<em style="color:var(--muted)">All Facilities (Admin)</em>' : '<span style="color:var(--crit)">None</span>');

          return '<tr data-user-id="' + esc(u.id) + '"><td><strong>' + esc(u.name || u.fullName) + '</strong></td><td>' + esc(u.email) + '</td>' +
            '<td><span class="badge ' + (u.role === 'admin' ? 'badge-in' : 'badge-transit') + '">' + esc(u.role) + '</span></td>' +
            '<td>' + assignedWhNames + '</td>' +
            '<td><button type="button" class="btn ghost btn-sm btn-edit-user-access" data-user-id="' + esc(u.id) + '">Edit Facilities</button></td></tr>';
        }).join('') + '</tbody></table></div></div>';

      $$('.btn-edit-user-access').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var uid = Number(btn.dataset.userId);
          var targetUser = users.filter(function (x) { return x.id === uid; })[0];
          if (!targetUser) return;

          Api.getUserWarehouses(uid).then(function (userWhs) {
            var currentAssignedIds = (userWhs || []).map(function (w) { return w.id; });
            var checkboxesHtml = allWhs.map(function (w) {
              var isChecked = currentAssignedIds.indexOf(w.id) >= 0;
              return '<label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer">' +
                '<input type="checkbox" name="wh_' + esc(w.id) + '" value="' + esc(w.id) + '"' + (isChecked ? ' checked' : '') + '> ' +
                '<span><strong>' + esc(w.name) + '</strong> (' + esc(w.code) + ' · ' + esc(w.province || '') + ')</span>' +
              '</label>';
            }).join('');

            openModal('Assign Facilities: ' + (targetUser.name || targetUser.fullName || targetUser.email),
              '<p style="color:var(--ink-2);margin-bottom:12px">Select the warehouse facilities this user is authorized to access:</p>' +
              '<div style="background:var(--panel-2);border:1px solid var(--line-2);border-radius:var(--r);padding:10px 14px">' +
                checkboxesHtml +
              '</div>',
              function (fd) {
                var selectedIds = [];
                allWhs.forEach(function (w) {
                  if (fd['wh_' + w.id]) selectedIds.push(w.id);
                });
                return Api.assignUserWarehouses(uid, selectedIds).then(function () {
                  toast('Warehouse assignments updated for ' + (targetUser.name || targetUser.email));
                  renderStaff();
                });
              }
            );
          });
        });
      });
    }).catch(function (err) { apiErrorState('#staffBody', err); });
  }

  function renderHistory() {
    loadingState('#historyBody');
    Api.listAudit({ warehouseId: warehouseId }).then(function (logs) {
      var hBody = $('#historyBody');
      if (!hBody) return;
      if (!logs.length) {
        hBody.innerHTML = emptyState('history', 'No audit logs yet', 'Every sign-in, transaction, and update is logged here.');
        return;
      }
      hBody.innerHTML = '<div class="card"><div class="tablewrap"><table class="table"><thead><tr>' +
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

  function openModal(title, bodyHtml, onSave) {
    var wrap = $('#modalWrap');
    if (!wrap) return;
    var titleEl = $('#modalTitle');
    if (titleEl) titleEl.textContent = title;
    var formEl = $('#modalForm');
    if (formEl) formEl.innerHTML = bodyHtml;
    wrap.hidden = false;

    var okBtn = $('#modalOk'); if (okBtn) okBtn.hidden = false;
    var cancelBtn = $('#modalCancel'); if (cancelBtn) cancelBtn.textContent = 'Cancel';

    var close = function () {
      wrap.hidden = true;
      if (formEl) formEl.innerHTML = '';
    };

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
          var res = onSave(fd);
          if (res && typeof res.then === 'function') {
            res.then(close).catch(function (err) { toast(err.message || 'Action failed.'); });
          } else {
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
        warehouses = whs || [];
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
        render();
      });
    }

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

    var rxBtn = $('#btnReceiveStock');
    if (rxBtn) rxBtn.addEventListener('click', openReceiveModal);
    var shipBtn = $('#btnShipStock');
    if (shipBtn) shipBtn.addEventListener('click', openShipModal);
    var adjBtn = $('#btnAdjustStock');
    if (adjBtn) adjBtn.addEventListener('click', openAdjustModal);
    var expBtn = $('#btnExportInventory');
    if (expBtn) expBtn.addEventListener('click', exportInventoryCsv);

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

    var addPhotoBtn = $('#addPhoto');
    if (addPhotoBtn) addPhotoBtn.addEventListener('click', function () { var pf = $('#photoFile'); if (pf) pf.click(); });
    var photoFileEl = $('#photoFile');
    if (photoFileEl) photoFileEl.addEventListener('change', function (e) { addPhotos(e.target.files); });
    var lbCloseBtn = $('#lbClose');
    if (lbCloseBtn) lbCloseBtn.addEventListener('click', function () { var lb = $('#lightbox'); if (lb) lb.hidden = true; });

    var newInvoiceBtn = $('#newInvoice');
    if (newInvoiceBtn) newInvoiceBtn.addEventListener('click', function () { draft = newDraft(); show('editor'); });
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
    }

    var newStaffBtn = $('#newStaff');
    if (newStaffBtn) {
      newStaffBtn.addEventListener('click', function () {
        Api.listWarehouses(false).then(function (allWhs) {
          var whCheckboxes = (allWhs || []).map(function (w) {
            return '<label style="display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer">' +
              '<input type="checkbox" name="wh_' + esc(w.id) + '" value="' + esc(w.id) + '"> ' +
              '<span><strong>' + esc(w.name) + '</strong> (' + esc(w.code) + ')</span>' +
            '</label>';
          }).join('');

          openModal('Add Staff Member',
            field('fullName', 'Full Name', { required: true }) +
            field('email', 'Work Email', { type: 'email', required: true }) +
            field('password', 'Temporary Password', { type: 'password', required: true, help: 'Min 8 chars' }) +
            field('role', 'Role', {
              type: 'select',
              options: [
                { value: 'staff', label: 'Staff (Warehouse / Ops)' },
                { value: 'driver', label: 'Driver (Transit & Photos)' },
                { value: 'manager', label: 'Manager (Invoices & Adjustments)' },
                { value: 'admin', label: 'Administrator (Full Access)' }
              ]
            }) +
            '<div style="margin-top:10px"><label style="font-size:12px;font-weight:700;color:var(--muted)">ASSIGN INITIAL FACILITIES</label>' +
            '<div style="background:var(--panel-2);border:1px solid var(--line-2);border-radius:var(--r);padding:8px 12px;margin-top:4px">' +
              (whCheckboxes || '<em style="color:var(--muted)">No facilities available</em>') +
            '</div></div>',
            function (fd) {
              var selectedWhIds = [];
              (allWhs || []).forEach(function (w) {
                if (fd['wh_' + w.id]) selectedWhIds.push(w.id);
              });

              return Api.createUser({
                fullName: fd.fullName,
                email: fd.email,
                password: fd.password,
                role: fd.role,
                warehouseIds: selectedWhIds
              }).then(function () {
                toast('Staff account created.');
                renderStaff();
              });
            });
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
