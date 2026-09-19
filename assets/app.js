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

  // `settings` is available to every role: it is where a user reads back
  // their own role, division access and warehouse access. The admin-only part
  // of that screen (company details) is gated inside renderSettings(), not by
  // withholding the whole view — otherwise a manager or staff member has no
  // way to see what they have been granted.
  var ROLES = {
    /* `purchaseorders` / `poeditor` are admin-only, matching @Roles('admin')
       on PurchaseOrdersController. Leaving them off the manager row is the
       point: managers may work invoices but not purchase orders. */
    admin:   { label: 'Administrator', sees: ['dashboard','inventory','photos','timeclock','chat','proformas','proformaeditor','invoices','editor','payments','araging','purchaseorders','poeditor','banking','reconciliation','payables','chartofaccounts','generalledger','profitloss','balancesheet','employees','attendance','leaverequests','customers','products','staff','history','settings'] },
    manager: { label: 'Manager',       sees: ['dashboard','inventory','photos','timeclock','chat','proformas','proformaeditor','invoices','editor','payments','araging','banking','reconciliation','payables','chartofaccounts','generalledger','profitloss','balancesheet','employees','attendance','leaverequests','customers','products','history','settings'] },
    staff:   { label: 'Staff',         sees: ['dashboard','inventory','photos','timeclock','chat','attendance','leaverequests','settings'] },
    driver:  { label: 'Driver',        sees: ['dashboard','inventory','photos','timeclock','chat','attendance','leaverequests','settings'] }
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
  /* A unit rate keeps up to four decimals (per-kg / per-lb pricing), so a
     printed rate x quantity reproduces the printed amount. */
  function moneyRate(d) {
    var n = Number(d) || 0;
    return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
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

  /* ----------------------------------------------------------------------
     Division / business-unit state.

     `myDivisions` is filled from GET /divisions and is the ONLY thing that
     decides which divisions this session may touch. It is never derived from
     the role, from localStorage, or from anything else the client can see or
     edit — the API is authoritative and the UI renders what it is told.

     `entity` is the *active* division in the client's own vocabulary
     ('recycling' | 'healthcare'). The API's canonical key for the recycling
     business is 'greenwave'; DIVISION_KEY_MAP translates. A stored preference
     is only honoured if the server still grants it.
     ---------------------------------------------------------------------- */
  var DIVISION_LABELS = { recycling: 'GreenWave Recycling', healthcare: 'Healthcare' };
  /* The staff table gives division access its own narrow column. The full
     label does not fit there, and truncating it mid-word ("GreenWave
     Recyclin…") is worse than naming the division shortly and exactly. */
  var DIVISION_LABELS_SHORT = { recycling: 'GreenWave', healthcare: 'Healthcare' };
  var myDivisions = [];

  function apiDivisionKey(ent) { return ent === 'healthcare' ? 'healthcare' : 'greenwave'; }
  function entityFromApiKey(key) { return key === 'healthcare' ? 'healthcare' : 'recycling'; }
  function divisionLabel(ent) { return DIVISION_LABELS[ent] || 'Unassigned'; }

  /** True only when the server has granted this division to this session. */
  function hasDivision(ent) { return myDivisions.indexOf(ent) >= 0; }
  function hasAnyDivision() { return myDivisions.length > 0; }

  var entity = 'recycling';
  var warehouseId = S.getWarehouse();
  var warehouses = [];
  var usersCache = null;
  var currentShiftCache = null;
  var clockTimer = null;
  var draft = null;
  var editorViewMode = false;
  var invoiceListCache = [];

  /* Purchase orders. Mirrors the invoice editor's shape -- one draft object
     rendered either as an editable form or as the read-only document. */
  var poDraft = null;
  var poViewMode = false;
  var poListCache = [];
  var poFilter = 'all';
  var poSearchQuery = '';
  var nextPoNumberHint = null;

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

  /**
   * Renders a user's division grants as chips.
   *
   * "No division access" is shown deliberately and prominently rather than
   * being left blank: an unassigned account is a real state an administrator
   * needs to notice and act on, not an empty cell.
   */
  function divisionChips(divisions, compact) {
    var list = (divisions || []).map(function (d) {
      return typeof d === 'string' ? d : entityFromApiKey(d.key);
    });
    if (list.length === 0) {
      return '<span class="division-badge none">No division access</span>';
    }
    return '<span class="division-badge-group">' + list.map(function (ent) {
      var cls = ent === 'healthcare' ? 'division-badge healthcare' : 'division-badge';
      var text = compact ? (DIVISION_LABELS_SHORT[ent] || divisionLabel(ent)) : divisionLabel(ent);
      // The full division name stays available on hover even when compact.
      return '<span class="' + cls + '" title="' + esc(divisionLabel(ent)) + '"><span class="dot"></span>' + esc(text) + '</span>';
    }).join('') + '</span>';
  }

  /**
   * The DIVISION ACCESS control for the create/edit staff forms.
   *
   * Only divisions the acting administrator holds are offered — the API
   * enforces the same rule, so offering more would just produce a 403. A
   * division the admin cannot grant is rendered disabled with the reason,
   * which is clearer than omitting it silently.
   */
  function divisionAccessSection(currentDivisions) {
    var current = (currentDivisions || []).map(function (d) {
      return typeof d === 'string' ? d : entityFromApiKey(d.key);
    });
    var rows = ['recycling', 'healthcare'].map(function (ent) {
      var checked = current.indexOf(ent) >= 0;
      var grantable = hasDivision(ent);
      return '<label class="check-row">' +
        '<input type="checkbox" name="div_' + esc(ent) + '" value="' + esc(ent) + '"' +
          (checked ? ' checked' : '') + (grantable ? '' : ' disabled') + '>' +
        '<span>' +
          '<span class="check-label">' + esc(divisionLabel(ent)) + '</span>' +
          '<span class="check-help">' + (grantable
            ? (ent === 'healthcare'
                ? 'Healthcare inventory, products, customers and invoices.'
                : 'Recycling inventory, materials, customers and invoices.')
            : 'You cannot grant a division you do not have access to yourself.') +
          '</span>' +
        '</span>' +
      '</label>';
    }).join('');

    return '<div class="form-section">' +
      '<span class="form-section-title">Division access</span>' +
      '<span class="form-section-help">Which business unit\u2019s data this account can reach. ' +
        'Separate from facility access \u2014 a user needs both. Leave both unchecked for no access.</span>' +
      rows +
    '</div>';
  }

  /** Reads the DIVISION ACCESS checkboxes out of a submitted modal form. */
  function selectedDivisionsFrom(fd) {
    var out = [];
    ['recycling', 'healthcare'].forEach(function (ent) {
      if (fd['div_' + ent]) out.push(apiDivisionKey(ent));
    });
    return out;
  }

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
    Api.logout();
    Api.clearSession();
    S.clearSession();
    me = null;
    if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
    showGate();
  }

  /**
   * Renders the division chrome from `myDivisions`.
   *
   * Two shapes, never both:
   *   - more than one division -> a real switcher, listing only granted ones.
   *   - exactly one            -> a plain statement of the active business
   *                               unit, so a single-division user is never
   *                               shown a control for something unreachable.
   * A user with no divisions gets neither, and render() shows the
   * "no business unit assigned" state instead of fetching anything.
   */
  function syncDivisionChrome() {
    var multi = myDivisions.length > 1;

    var railSwitcher = $('#railDivisionSwitcher');
    var railStatic = $('#railDivisionStatic');
    var topToggle = $('#topDivisionToggle');
    var topStatic = $('#topDivisionStatic');
    var topWrap = $('#topDivisionWrap');

    if (topWrap) topWrap.hidden = !hasAnyDivision();

    if (railSwitcher) railSwitcher.hidden = !multi;
    if (topToggle) topToggle.hidden = !multi;
    if (railStatic) railStatic.hidden = multi || !hasAnyDivision();
    if (topStatic) topStatic.hidden = multi || !hasAnyDivision();

    // Any button for a division this session was not granted is removed from
    // the tab order and hidden outright — hiding alone is not the control,
    // but there is no reason to render an affordance that would 403.
    $$('.entsw button, .top-div-btn').forEach(function (b) {
      var ent = b.dataset.entity || b.dataset.div;
      var granted = hasDivision(ent);
      b.hidden = !granted;
      b.disabled = !granted;
    });

    var label = divisionLabel(entity);
    var railLabel = $('#railDivisionLabel');
    if (railLabel) railLabel.textContent = label;
    var topStaticLabel = $('#topDivisionStaticLabel');
    if (topStaticLabel) topStaticLabel.textContent = label;
  }

  function syncChrome() {
    if (global.Api && global.Api.setDivision) {
      global.Api.setDivision(apiDivisionKey(entity));
    }
    document.documentElement.setAttribute('data-entity', entity);
    syncDivisionChrome();
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

    // Navigation reflects both role and division authorization. `data-only`
    // marks an item that belongs to one division; it is shown only when that
    // division is BOTH the active one and one this session actually holds, so
    // a Healthcare-only user never sees GreenWave-specific navigation (and
    // vice versa) — and render() never fetches behind a hidden item.
    $$('[data-only], [data-role]').forEach(function (el) {
      var okEntity = !el.dataset.only ||
        (el.dataset.only === entity && hasDivision(el.dataset.only));
      var okRole = !el.dataset.role || (me && el.dataset.role.split(',').indexOf(me.role) >= 0);
      el.hidden = !hasAnyDivision() || !okEntity || !okRole;
    });

    // With no division granted there is nothing operational to navigate to,
    // so those entries are hidden rather than left as links into an empty
    // state. Settings and Staff stay available: an administrator must still
    // be able to reach Staff Management to grant themselves or others access.
    var DIVISION_SCOPED_VIEWS = [
      'dashboard', 'inventory', 'photos', 'timeclock', 'chat',
      'invoices', 'payments', 'araging', 'purchaseorders', 'customers', 'products', 'history'
    ];
    if (!hasAnyDivision()) {
      $$('.navitem').forEach(function (b) {
        if (DIVISION_SCOPED_VIEWS.indexOf(b.dataset.view) >= 0) b.hidden = true;
      });
      $$('.navlabel').forEach(function (l) {
        // Hide a section heading once every item under it is hidden.
        var next = l.nextElementSibling;
        var anyVisible = false;
        while (next && !next.classList.contains('navlabel')) {
          if (next.classList.contains('navitem') && !next.hidden) anyVisible = true;
          next = next.nextElementSibling;
        }
        l.hidden = !anyVisible;
      });
    }

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
    /* A shift without a usable clockIn renders as "NaNh NaNm"; treat it as
       no open shift rather than showing that. */
    var startedAt = open && open.clockIn ? new Date(open.clockIn).getTime() : NaN;
    var valid = !isNaN(startedAt);
    chip.hidden = !valid;
    if (valid) {
      chip.innerHTML = '<span class="dot"></span>On shift · ' + hm(Date.now() - startedAt);
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
    // Every Recycling-only financial screen (ledger, banking, payables...)
    // falls back to Inventory outside Recycling, so switching division never
    // leaves a stale finance screen on display.
    if (!isRecycling() && RECYCLING_ONLY_FINANCIAL_VIEWS.indexOf(next) >= 0) next = 'inventory';
    if (next === 'invoices' && !isRecycling()) next = 'inventory';
    if (next === 'proformas' && !isRecycling()) next = 'inventory';
    if (next === 'payments' && !isRecycling()) next = 'inventory';
    if (next === 'araging' && !isRecycling()) next = 'inventory';
    if (next === 'purchaseorders' && !isRecycling()) next = 'inventory';
    if (!can(next) && next !== 'editor' && next !== 'proformaeditor') next = 'dashboard';
    if (next === 'editor' && !can('invoices')) next = 'inventory';
    if (next === 'proformaeditor' && !(can('proformas') && isRecycling())) {
      next = can('proformas') ? 'proformas' : 'inventory';
    }
    // The PO editor is reachable only by someone who may see purchase orders
    // at all, so a non-admin deep-linking to it lands somewhere they can use.
    if (next === 'poeditor' && !(can('purchaseorders') && isRecycling())) {
      next = can('invoices') ? 'invoices' : 'dashboard';
    }
    // A session with no division has no operational views to land on; keep it
    // on the administrative ones rather than bouncing to a dashboard that
    // would render empty.
    var nonDivisionViews = [
      'settings', 'staff', 'banking', 'reconciliation', 'payables',
      'chartofaccounts', 'generalledger', 'profitloss', 'balancesheet',
      'employees', 'attendance', 'leaverequests'
    ];
    if (!hasAnyDivision() && nonDivisionViews.indexOf(next) < 0) {
      next = isAdmin() ? 'staff' : (can('attendance') ? 'attendance' : 'dashboard');
    }

    view = next;
    $$('.view').forEach(function (v) { v.classList.remove('active'); });
    var el = $('#v-' + view);
    if (el) el.classList.add('active');

    $$('.navitem').forEach(function (b) {
      var on = b.dataset.view === view ||
        (view === 'editor' && b.dataset.view === 'invoices') ||
        (view === 'poeditor' && b.dataset.view === 'purchaseorders') ||
        (view === 'proformaeditor' && b.dataset.view === 'proformas');
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
              return '<tr class="clickable-row" data-tx="' + esc(t.id) + '" title="Click to view full transaction details and photos" style="cursor:pointer"><td class="mono" style="font-size:13px" title="' + esc(when(t.createdAt)) + '">' + esc(friendlyTime(t.createdAt)) + '</td>' +
                '<td><span class="badge ' + typeBadge + '">' + typeLabel + '</span></td>' +
                '<td>' + esc(m.name) + '</td>' +
                '<td class="num">' + num(Number(t.total) || 0) + '</td>' +
                '<td style="color:var(--muted)">' + esc((me && t.createdBy === me.id) ? me.name : userName(t.createdBy)) + '</td></tr>';
            }).join('') + '</tbody></table></div>';

          $$('#dashRecentActivity .clickable-row[data-tx]').forEach(function (row) {
            row.addEventListener('click', function () {
              openTransactionDetailModal(row.dataset.tx);
            });
          });
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
      var photoCount = (tx.photos && tx.photos.length) || 0;
      var photoMax = inventoryPhotoMax();
      var canAddPhotos = photoCount < photoMax;
      /* Camera and library are separate inputs for the same reason as the
         inbound picker: `capture` opens the camera directly and hides the
         photo library, so one input cannot serve both. */
      var addPhotoBtnHtml = canAddPhotos
        ? '<div class="tx-photo-add">' +
            '<input type="file" id="txAddPhotoCamera" accept="image/*" capture="environment" multiple hidden>' +
            '<input type="file" id="txAddPhotoLibrary" accept="image/*" multiple hidden>' +
            '<button type="button" class="btn ghost btn-sm photo-add-btn" id="txAddPhotoCameraBtn"><svg><use href="#i-cam"></use></svg>Take photo</button>' +
            '<button type="button" class="btn ghost btn-sm photo-add-btn" id="txAddPhotoLibraryBtn"><svg><use href="#i-plus"></use></svg>Add photos</button>' +
          '</div>'
        : '<span class="tx-photo-full">Maximum reached (' + photoMax + ' / ' + photoMax + ')</span>';
      var photoHeadHtml = '<div class="tx-photos-head">' +
          '<span class="tx-detail-label">Photos <span class="photo-counter' + (canAddPhotos ? '' : ' is-full') + '">' + photoCount + ' / ' + photoMax + '</span></span>' +
          addPhotoBtnHtml +
        '</div>';

      var photoHtml = '';
      if (photoCount > 0) {
        photoHtml = '<div class="tx-photos-section" style="margin-top:16px">' +
          photoHeadHtml +
          '<div class="tx-photos-grid">' +
          tx.photos.map(function (p, idx) {
            var fileName = p.originalFilename || p.filename || ('Photo #' + (idx + 1));
            var thumbUrl = (p.id ? Api.photoThumbnailUrl(p.id) : (p.thumbnailUrl ? Api.photoThumbnailUrl(p.thumbnailUrl) : (p.url || '')));
            return '<div class="tx-photo-card" data-idx="' + idx + '" role="button" tabindex="0" aria-label="Open photo ' + (idx + 1) + ' of ' + photoCount + '" style="cursor:pointer;position:relative">' +
              '<button type="button" class="tx-photo-del-btn" data-photo-id="' + esc(p.id) + '" title="Remove photo from this record" aria-label="Remove photo ' + (idx + 1) + ' from this record">&times;</button>' +
              '<div class="photo-thumb-wrap" style="height:110px">' +
                '<img src="' + esc(thumbUrl) + '" alt="' + esc(fileName) + '" class="tx-photo-img" loading="lazy" onerror="this.style.display=\'none\';if(this.nextElementSibling)this.nextElementSibling.style.display=\'flex\';">' +
                '<div class="photo-error-placeholder" style="display:none">' +
                  '<span>⚠️ Photo unavailable</span>' +
                '</div>' +
              '</div>' +
              '<div class="tx-photo-meta">' + esc(fileName) + '</div>' +
              '</div>';
          }).join('') +
          '</div></div>';
      } else {
        photoHtml = '<div class="tx-photos-section" style="margin-top:16px">' +
          photoHeadHtml +
          '<div class="tx-detail-val" style="color:var(--muted)">No photos attached yet.</div>' +
        '</div>';
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

      var displayDate = '—';
      var displayTime = '—';
      if (tx.createdAt) {
        var d = new Date(tx.createdAt);
        if (!isNaN(d.getTime())) {
          displayDate = tx.date || d.toISOString().split('T')[0];
          displayTime = tx.time || d.toTimeString().split(' ')[0];
        }
      } else if (tx.date) {
        displayDate = tx.date;
        displayTime = tx.time || '—';
      }

      var bodyHtml =
        '<div class="tx-detail-card">' +
          '<div class="tx-detail-grid">' +
            '<div class="tx-detail-item"><span class="tx-detail-label">Inventory / Record ID</span><span class="tx-detail-val mono" style="font-size:12px">' + esc(tx.id) + '</span></div>' +
            '<div class="tx-detail-item"><span class="tx-detail-label">Date</span><span class="tx-detail-val mono">📅 ' + esc(displayDate) + '</span></div>' +
            '<div class="tx-detail-item"><span class="tx-detail-label">Time</span><span class="tx-detail-val mono">⏰ ' + esc(displayTime) + '</span></div>' +
            '<div class="tx-detail-item"><span class="tx-detail-label">Facility / Warehouse</span><span class="tx-detail-val">📍 ' + esc(tx.warehouseName || 'Assigned Facility') + (tx.warehouseCode ? ' (' + esc(tx.warehouseCode) + ')' : '') + '</span></div>' +
            '<div class="tx-detail-item"><span class="tx-detail-label">Division</span><span class="tx-detail-val">🏢 ' + esc(divLabel) + '</span></div>' +
            '<div class="tx-detail-item"><span class="tx-detail-label">Transaction Type</span><span class="tx-detail-val"><strong>' + esc(typeLabel) + '</strong></span></div>' +
            '<div class="tx-detail-item"><span class="tx-detail-label">Order / Reference #</span><span class="tx-detail-val mono"><strong>' + esc(tx.orderNumber || tx.reference || '—') + '</strong></span></div>' +
            '<div class="tx-detail-item"><span class="tx-detail-label">' + (txIsRec ? 'Material' : 'Product') + '</span><span class="tx-detail-val"><strong>' + esc(tx.materialName || '—') + '</strong></span></div>' +
            '<div class="tx-detail-item"><span class="tx-detail-label">Unit Type</span><span class="tx-detail-val">' + esc(unitLabel) + '</span></div>' +
            divisionSpecificFields +
            '<div class="tx-detail-item"><span class="tx-detail-label">Container Number</span><span class="tx-detail-val mono"><strong>' + esc(tx.containerNumber || '—') + '</strong></span></div>' +
            '<div class="tx-detail-item"><span class="tx-detail-label">Seal Number</span><span class="tx-detail-val mono"><strong>' + esc(tx.sealNumber || '—') + '</strong></span></div>' +
            '<div class="tx-detail-item"><span class="tx-detail-label">BL / Tracking Number</span><span class="tx-detail-val mono">' + esc(tx.blNumber || '—') + '</span></div>' +
            '<div class="tx-detail-item"><span class="tx-detail-label">Shipping Line / Carrier</span><span class="tx-detail-val">' + esc(tx.shippingLine || '—') + '</span></div>' +
            '<div class="tx-detail-item"><span class="tx-detail-label">ETA / Expected Date</span><span class="tx-detail-val mono">' + esc(tx.eta || '—') + '</span></div>' +
            '<div class="tx-detail-item"><span class="tx-detail-label">Recorded By</span><span class="tx-detail-val">👤 ' + esc(tx.creatorName || (tx.createdBy ? ('Staff #' + tx.createdBy) : 'Staff')) + '</span></div>' +
            '<div class="tx-detail-item" style="grid-column: 1 / -1"><span class="tx-detail-label">Notes / Reason</span><span class="tx-detail-val">' + esc(tx.reason || tx.notes || '—') + '</span></div>' +
          '</div>' +
          photoHtml +
        '</div>';

      openModal('Transaction Details · ' + (tx.orderNumber || tx.reference || tx.id.slice(0, 8)), bodyHtml, null);
      var okBtn = $('#modalOk'); if (okBtn) okBtn.hidden = true;
      var cancelBtn = $('#modalCancel'); if (cancelBtn) cancelBtn.textContent = 'Close';

      /* Appends to the existing set -- never replaces it. The same
         downscale/EXIF-strip and batch endpoint as the inbound picker, then
         an explicit attach to this transaction. */
      function addPhotosToTx(fileList) {
        var files = Array.prototype.slice.call(fileList || []).filter(function (f) {
          return !f.type || f.type.indexOf('image/') === 0;
        });
        if (!files.length) return;
        var room = photoMax - photoCount;
        if (files.length > room) {
          toast('This record already has ' + photoCount + ' of ' + photoMax + ' photos. You can add ' + room + ' more.');
          return;
        }
        toast('Uploading ' + files.length + (files.length === 1 ? ' photo…' : ' photos…'));
        uploadInventoryPhotos(files, {
          warehouseId: tx.warehouseId,
          photoType: tx.type === 'outbound' ? 'inventory_outbound' : 'inventory_inbound',
          jobReference: tx.orderNumber || tx.reference || undefined
        }).then(function (ids) {
          return Api.attachTransactionPhotos(tx.id, ids).catch(function (err) {
            return discardIfRejected(ids, err);
          });
        }).then(function () {
          toast(files.length === 1 ? 'Photo added.' : files.length + ' photos added.');
          openTransactionDetailModal(txId);
        }).catch(function (err) {
          toast('Could not add photos: ' + (err.message || err));
        });
      }
      [['#txAddPhotoCameraBtn', '#txAddPhotoCamera'], ['#txAddPhotoLibraryBtn', '#txAddPhotoLibrary']].forEach(function (pair) {
        var btn = $(pair[0]), input = $(pair[1]);
        if (!btn || !input) return;
        btn.addEventListener('click', function () { input.click(); });
        input.addEventListener('change', function () {
          addPhotosToTx(input.files);
          input.value = '';
        });
      });

      $$('.tx-photo-del-btn').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var photoId = btn.dataset.photoId;
          if (!photoId) return;
          if (!confirm('Remove this photo from the transaction?')) return;
          Api.detachTransactionPhoto(tx.id, photoId).then(function () {
            toast('Photo removed');
            openTransactionDetailModal(txId);
          }).catch(function (err) {
            toast('Failed to remove photo: ' + (err.message || err));
          });
        });
      });

      $$('.tx-photo-card').forEach(function (card) {
        card.addEventListener('click', function (e) {
          if (e.target.closest('.tx-photo-del-btn')) return;
          var idx = Number(card.dataset.idx);
          openLightbox(idx, tx.photos);
        });
        card.addEventListener('keydown', function (e) {
          if (e.target !== card || (e.key !== 'Enter' && e.key !== ' ')) return;
          e.preventDefault();
          openLightbox(Number(card.dataset.idx), tx.photos);
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
      return '<tr class="clickable-row" data-container-no="' + esc(c.containerNumber || '') + '" data-order-no="' + esc(c.orderNumber || '') + '" title="Click to view transaction details">' +
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

      $$('#invenBody .clickable-row[data-container-no]').forEach(function (row) {
        row.addEventListener('click', function () {
          var cNo = row.dataset.containerNo;
          var oNo = row.dataset.orderNo;
          var query = cNo || oNo;
          if (!query) return;
          Api.listInventoryTransactions({ search: query, limit: 1 }).then(function (res) {
            var list = (res && res.items) || (Array.isArray(res) ? res : []);
            if (list && list.length > 0) {
              openTransactionDetailModal(list[0].id);
            } else {
              toast('No matching transaction record found for ' + query);
            }
          }).catch(function (err) {
            toast('Could not load record: ' + (err.message || err));
          });
        });
      });
    }
  }

  /* ==========================================================================
     Inventory photo picker (up to Photos.MAX_PHOTOS per entry).

     Replaces a single-file control that kept only `input.files[0]`, so every
     photo after the first was discarded before it ever reached FormData.

     Two separate file inputs on purpose. `capture="environment"` is a strong
     hint on mobile: an input carrying it opens the camera directly and gives
     no way to reach the camera roll. The old markup pointed both the "Take
     Photo" and "Upload Photo" buttons at one capture input, so on a phone
     "Upload" also opened the camera and existing photos were unreachable.
     The library input deliberately omits `capture`.
     ========================================================================== */
  /* ==========================================================================
     Responsive data tables.

     GreenWave renders 27 operational tables as HTML strings across this file.
     Three of them opted into the `.stack-mobile` card layout by hand-writing a
     `data-label` on every cell; the other 24 fell through to
     `.tablewrap { overflow-x: auto }`, which on a 390px phone means an eight
     column table is read two columns at a time by swiping sideways -- the
     single worst thing about the operational screens on a phone.

     Rather than hand-edit two dozen renderers (and every future one), the
     labels are derived at runtime from the header row the table already has.
     A table is left alone when it has no <thead> -- the P&L and balance sheet
     are laid out as label/amount pairs and already read correctly narrow --
     or when it is marked `.no-stack`, or when its column count is low enough
     to fit a phone unaided.
     ========================================================================== */
  var MOBILE_STACK_MIN_COLUMNS = 4;

  function enhanceTablesForMobile(root) {
    $$('table.table', root || document).forEach(function (table) {
      if (table.dataset.mobileEnhanced === '1') return;
      if (table.classList.contains('no-stack')) return;
      if (table.closest('.no-stack')) return;

      var heads = $$('thead th', table);
      if (heads.length < MOBILE_STACK_MIN_COLUMNS) return;

      var labels = heads.map(function (th) {
        return (th.textContent || '').replace(/\s+/g, ' ').trim();
      });

      $$('tbody tr, tfoot tr', table).forEach(function (tr) {
        var cells = Array.prototype.slice.call(tr.children);
        /* Empty-state and group rows span the table; they read fine as-is and
           must not be given a column label. */
        if (cells.length === 1 && cells[0].colSpan > 1) return;
        cells.forEach(function (td, i) {
          /* A card row reading "Description —" is noise on a phone; blank
             cells are marked so the stacked layout can drop them. */
          if (i > 0 && !td.querySelector('button, a, input, select') && /^[\s—–-]*$/.test(td.textContent || '')) {
            td.classList.add('stack-empty');
          }
          if (td.hasAttribute('data-label')) return;
          if (labels[i]) td.setAttribute('data-label', labels[i]);
        });
      });

      table.classList.add('stack-mobile');
      table.dataset.mobileEnhanced = '1';
    });
  }

  /* Views here re-render by assigning innerHTML at many call sites, including
     asynchronously once an API call resolves. Observing the document is more
     reliable than trying to call the enhancer at the end of each of them, and
     it also covers tables rendered inside modals. */
  function watchTablesForMobile() {
    enhanceTablesForMobile(document);
    if (typeof MutationObserver !== 'function') return;

    var pending = false;
    var observer = new MutationObserver(function () {
      if (pending) return;
      pending = true;
      /* Coalesce a burst of DOM writes into one pass. */
      requestAnimationFrame(function () {
        pending = false;
        enhanceTablesForMobile(document);
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function inventoryPhotoMax() {
    return (window.Photos && Photos.MAX_PHOTOS) || 15;
  }

  /* Ids from a POST /api/photos/batch response. The endpoint returns a bare
     array; the wrapped shapes are accepted so a contract change is caught by
     the count check at the call site instead of silently yielding no ids. */
  function uploadedPhotoIds(res) {
    var list = Array.isArray(res) ? res : ((res && (res.photos || res.items)) || []);
    return list.map(function (p) { return p && p.id; }).filter(Boolean);
  }

  /* Best-effort cleanup of photos uploaded for a save that then failed, so a
     retry does not leave unattached objects behind in MinIO. */
  function discardUploadedPhotos(ids) {
    return Promise.all((ids || []).map(function (id) {
      return Api.deletePhoto(id).catch(function () { /* the original error is what matters */ });
    }));
  }

  /* Only a 4xx proves the entry/attach was refused before anything was
     written. After a 5xx or a dropped connection the photos may already be
     attached, and DELETE /api/photos/:id removes the MinIO object before the
     row -- so there an orphan is left rather than risk a broken photo. */
  function discardIfRejected(ids, err) {
    var st = err && err.status;
    return (st >= 400 && st < 500 ? discardUploadedPhotos(ids) : Promise.resolve())
      .then(function () { throw err; });
  }

  /* Downscale, upload as one batch, and resolve the new photo ids -- only if
     every file was stored. Anything less rejects (and removes what did get
     stored), so callers never proceed with a partial set. */
  function uploadInventoryPhotos(files, meta) {
    return Photos.prepareAll(files).then(function (prepared) {
      return Api.uploadPhotos(prepared.map(function (r) { return r.file; }), meta);
    }).then(function (res) {
      var ids = uploadedPhotoIds(res);
      if (ids.length !== files.length) {
        return discardUploadedPhotos(ids).then(function () {
          throw new Error('the server stored ' + ids.length + ' of ' + files.length + ' photos');
        });
      }
      return ids;
    });
  }

  function inventoryPhotoFieldHtml() {
    var max = inventoryPhotoMax();
    return '<div class="field photo-picker-field">' +
      '<div class="photo-picker-head">' +
        '<label id="inboundPhotoLabel">Photos (optional)</label>' +
        '<span class="photo-counter" id="inboundPhotoCount" aria-live="polite">0 / ' + max + '</span>' +
      '</div>' +
      '<div class="inbound-photo-zone">' +
        '<div class="inbound-photo-btns">' +
          '<input type="file" id="inboundPhotoCamera" accept="image/*" capture="environment" multiple hidden>' +
          '<input type="file" id="inboundPhotoLibrary" accept="image/*" multiple hidden>' +
          '<button type="button" class="btn ghost photo-add-btn" id="btnInboundTakePhoto">' +
            '<svg><use href="#i-cam"></use></svg> Take photo</button>' +
          '<button type="button" class="btn ghost photo-add-btn" id="btnInboundUploadPhoto">' +
            '<svg><use href="#i-plus"></use></svg> Add photos</button>' +
        '</div>' +
        '<div class="photo-picker-grid" id="inboundPhotoGrid" hidden></div>' +
        '<p class="photo-picker-hint" id="inboundPhotoHint">Up to ' + max + ' photos. Add more at any time before saving.</p>' +
      '</div>' +
    '</div>';
  }

  /* Wires the markup above and owns the selection. Returns an accessor the
     submit handler uses to read the final list. */
  function initInventoryPhotoPicker() {
    var MAX = inventoryPhotoMax();
    var selected = [];   /* { file, url, key } */

    var grid = $('#inboundPhotoGrid');
    var countEl = $('#inboundPhotoCount');
    var hintEl = $('#inboundPhotoHint');
    var camInput = $('#inboundPhotoCamera');
    var libInput = $('#inboundPhotoLibrary');

    function keyOf(f) {
      return [f.name, f.size, f.lastModified].join('|');
    }

    function render() {
      if (countEl) {
        countEl.textContent = selected.length + ' / ' + MAX;
        countEl.classList.toggle('is-full', selected.length >= MAX);
      }
      if (!grid) return;
      grid.hidden = selected.length === 0;
      grid.innerHTML = selected.map(function (item, i) {
        return '<div class="photo-chip">' +
          '<img src="' + esc(item.url) + '" alt="' + esc(item.file.name) + '" loading="lazy">' +
          '<button type="button" class="photo-chip-x" data-remove="' + i + '" ' +
            'aria-label="Remove ' + esc(item.file.name) + '">&times;</button>' +
          '</div>';
      }).join('');
      $$('#inboundPhotoGrid [data-remove]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          removeAt(Number(btn.dataset.remove));
        });
      });
      if (hintEl) {
        hintEl.textContent = selected.length >= MAX
          ? 'Maximum of ' + MAX + ' photos reached. Remove one to add another.'
          : 'Up to ' + MAX + ' photos. Add more at any time before saving.';
      }
    }

    function removeAt(i) {
      var item = selected[i];
      if (!item) return;
      try { URL.revokeObjectURL(item.url); } catch (e) { /* already revoked */ }
      selected.splice(i, 1);
      render();
    }

    /* Additive: a second pick appends to what is already chosen rather than
       replacing it, which is what "add photos until 15" requires. */
    function addFiles(fileList) {
      var incoming = Array.prototype.slice.call(fileList || []);
      if (!incoming.length) return;

      var room = MAX - selected.length;
      var added = 0, dupes = 0, rejected = 0;

      incoming.forEach(function (f) {
        if (f.type && f.type.indexOf('image/') !== 0) { rejected++; return; }
        if (selected.some(function (x) { return x.key === keyOf(f); })) { dupes++; return; }
        if (added >= room) return;
        selected.push({ file: f, key: keyOf(f), url: URL.createObjectURL(f) });
        added++;
      });

      var overflow = incoming.length - added - dupes - rejected;
      render();

      if (rejected > 0) {
        toast(rejected === 1
          ? 'One file was skipped because it is not an image.'
          : rejected + ' files were skipped because they are not images.');
      }
      if (dupes > 0) {
        toast(dupes === 1
          ? 'That photo was already added.'
          : dupes + ' photos were already added.');
      }
      if (overflow > 0) {
        toast('You can attach a maximum of ' + MAX + ' photos. ' +
          added + ' added, ' + overflow + ' not added.');
      }
    }

    function bindPick(btn, input) {
      if (!btn || !input) return;
      btn.addEventListener('click', function () {
        if (selected.length >= MAX) {
          toast('Maximum of ' + MAX + ' photos reached. Remove one to add another.');
          return;
        }
        input.click();
      });
      input.addEventListener('change', function (e) {
        addFiles(e.target.files);
        /* Clear so picking the same file again still fires `change`. */
        e.target.value = '';
      });
    }

    bindPick($('#btnInboundTakePhoto'), camInput);
    bindPick($('#btnInboundUploadPhoto'), libInput);
    render();

    return {
      files: function () { return selected.map(function (x) { return x.file; }); },
      count: function () { return selected.length; },
      dispose: function () {
        selected.forEach(function (x) {
          try { URL.revokeObjectURL(x.url); } catch (e) { /* ignore */ }
        });
        selected = [];
      }
    };
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
          inventoryPhotoFieldHtml() +
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
          inventoryPhotoFieldHtml() +
          '<div class="field"><label>Notes / Comments (optional)</label><input type="text" name="notes" placeholder="e.g. SI SENT, cross dock"></div>';
      }

      var photoPicker = null;

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

        var doSubmit = function (photoIds) {
          var payload = {
            warehouseId: w.id,
            materialId: fd.materialId,
            type: 'inbound',
            division: divName,
            unitType: unitType,
            date: fd.date || undefined,
            weightValue: weightVal,
            weightUnit: weightUnit,
            photoId: (photoIds && photoIds[0]) || undefined,
            photoIds: (photoIds && photoIds.length) ? photoIds : undefined,
            orderNumber: fd.orderNumber,
            reference: fd.orderNumber,
            containerNumber: fd.containerNumber || undefined,
            sealNumber: fd.sealNumber || undefined,
            xl: xl, l: l, m: m, s: s,
            notes: fd.notes || undefined
          };

          var received = 'Inbound shipment received (' + num(total) + ' ' + unitLabel + 's)';
          return Api.createInventoryTransaction(payload).then(function (created) {
            if (!photoIds.length || !created || !created.id) {
              toast(received + ' and stock updated.');
              return;
            }
            /* Read the entry back before claiming the photos are on it. The
               entry itself is saved at this point, so a shortfall is reported
               as exactly that rather than failing the dialog (a retry would
               record the shipment twice). */
            return Api.getInventoryTransaction(created.id).then(function (tx) {
              var n = (tx && tx.photos && tx.photos.length) || 0;
              if (n < photoIds.length) {
                toast(received + ', but only ' + n + ' of ' + photoIds.length +
                  ' photos are attached. Open the entry from History to add the missing photos.');
              } else {
                toast(received + ' with ' + n + (n === 1 ? ' photo.' : ' photos.'));
              }
            }, function () {
              toast(received + '. Could not confirm the photos -- open the entry from History to check them.');
            });
          }, function (err) {
            return discardIfRejected(photoIds, err);
          }).then(function () {
            renderInventory();
          });
        };

        var chosen = photoPicker ? photoPicker.files() : [];
        if (!chosen.length) return doSubmit([]);

        /* Photos first, then the entry. If the upload fails nothing is
           saved and the dialog stays open with the selection intact, so the
           operator can retry -- the entry is never recorded without its
           photos behind a success message. */
        toast('Uploading ' + chosen.length + (chosen.length === 1 ? ' photo…' : ' photos…'));
        return uploadInventoryPhotos(chosen, {
          warehouseId: w.id,
          photoType: 'inventory_inbound',
          jobReference: fd.orderNumber
        }).then(doSubmit, function (err) {
          throw new Error('Photo upload failed: ' + String(err.message || err).replace(/\.$/, '') + '. Nothing was saved -- try again.');
        });
      });

      photoPicker = initInventoryPhotoPicker();

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
          date: fd.date || undefined,
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
          return '<tr class="clickable-row" data-tx="' + esc(t.id) + '" title="Click to view full transaction details and photos" style="cursor:pointer"><td class="mono" style="font-size:13px">' + esc(when(t.createdAt).split(' ')[0]) + '</td><td>' + esc(m.name) + '</td>' +
            '<td class="mono" style="font-size:12.5px;color:var(--muted)">' + esc(t.orderNumber || t.reference || t.reason || '—') + '</td>' +
            '<td style="color:var(--ink-2)">' + esc(by) + '</td>' +
            '<td><span class="badge ' + badgeClass + '">' + kind + '</span></td>' +
            '<td class="num"><strong>' + esc(q) + '</strong></td></tr>';
        }).join('') + '</tbody></table></div></div>';

      $$('#tkRecent .clickable-row[data-tx]').forEach(function (row) {
        row.addEventListener('click', function () {
          openTransactionDetailModal(row.dataset.tx);
        });
      });
    }).catch(function () { var host = $('#tkRecent'); if (host) host.innerHTML = ''; });
  }

  var photoCache = [];
  var currentLbPhotos = [];
  var currentLbIndex = 0;

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
      photoCache = all || [];
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
          var thumbUrl = (p.id ? Api.photoThumbnailUrl(p.id) : (p.thumbnailUrl ? Api.photoThumbnailUrl(p.thumbnailUrl) : (p.url || '')));
          var fileName = p.originalFilename || p.filename || ('Photo #' + (i + 1));
          var takenTime = p.takenAt || p.createdAt ? when(p.takenAt || p.createdAt) : '—';
          return '<div class="photo-card-item card" style="overflow:hidden;text-align:left;display:flex;flex-direction:column">' +
            '<div class="photo-thumb-wrap" data-photo-idx="' + i + '" style="cursor:pointer;position:relative;width:100%;height:130px;background:var(--panel-2,#182234);display:flex;align-items:center;justify-content:center;overflow:hidden">' +
              '<img src="' + esc(thumbUrl) + '" alt="' + esc(fileName) + '" loading="lazy" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display=\'none\';if(this.nextElementSibling)this.nextElementSibling.style.display=\'flex\';">' +
              '<div class="photo-error-placeholder" style="display:none;flex-direction:column;align-items:center;justify-content:center;padding:8px;text-align:center;color:var(--muted);font-size:11px;width:100%;height:100%">' +
                '<span>⚠️ Photo unavailable</span>' +
                '<button type="button" class="btn ghost btn-sm photo-retry-thumb" data-retry-idx="' + i + '" style="margin-top:6px;font-size:10.5px;padding:2px 8px">Retry</button>' +
              '</div>' +
            '</div>' +
            '<div style="padding:8px;font-size:11.5px;color:var(--muted);display:flex;flex-direction:column;gap:2px">' +
              '<span><strong style="color:var(--ink)">' + esc(userName(p.takenBy)) + '</strong></span>' +
              '<span>' + esc(takenTime) + '</span>' +
              (p.jobReference ? '<span class="mono" style="color:var(--brand);font-size:11px">Ref: ' + esc(p.jobReference) + '</span>' : '') +
            '</div>' +
          '</div>';
        }).join('') + '</div></div>';

      $$('.photo-thumb-wrap[data-photo-idx]').forEach(function (wrap) {
        wrap.addEventListener('click', function (e) {
          if (e.target && e.target.classList.contains('photo-retry-thumb')) return;
          openLightbox(Number(wrap.dataset.photoIdx), photoCache);
        });
      });

      $$('.photo-retry-thumb').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var idx = Number(btn.dataset.retryIdx);
          var p = photoCache[idx];
          if (!p) return;
          var wrap = btn.closest('.photo-thumb-wrap');
          if (!wrap) return;
          var img = wrap.querySelector('img');
          var errBox = wrap.querySelector('.photo-error-placeholder');
          if (img && errBox) {
            errBox.style.display = 'none';
            img.style.display = 'block';
            var base = (p.id ? Api.photoThumbnailUrl(p.id) : (p.thumbnailUrl ? Api.photoThumbnailUrl(p.thumbnailUrl) : (p.url || '')));
            var sep = base.indexOf('?') >= 0 ? '&' : '?';
            img.src = base + sep + '_retry=' + Date.now();
          }
        });
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

  function openLightbox(indexOrPhotos, maybePhotos) {
    if (Array.isArray(indexOrPhotos)) {
      currentLbPhotos = indexOrPhotos;
      currentLbIndex = typeof maybePhotos === 'number' ? maybePhotos : 0;
    } else if (typeof indexOrPhotos === 'number') {
      if (Array.isArray(maybePhotos)) {
        currentLbPhotos = maybePhotos;
        currentLbIndex = indexOrPhotos;
      } else {
        currentLbPhotos = photoCache || [];
        currentLbIndex = indexOrPhotos;
      }
    } else {
      return;
    }

    if (!currentLbPhotos || !currentLbPhotos.length) return;
    if (currentLbIndex < 0) currentLbIndex = 0;
    if (currentLbIndex >= currentLbPhotos.length) currentLbIndex = currentLbPhotos.length - 1;

    dialogOpenerEl = document.activeElement;
    var lb = $('#lightbox');
    if (lb) lb.hidden = false;
    renderLightboxCurrent();
    var lbCloseBtn = $('#lbClose');
    if (lbCloseBtn) lbCloseBtn.focus();
  }

  function navigateLightbox(delta) {
    if (!currentLbPhotos || currentLbPhotos.length <= 1) return;
    var next = currentLbIndex + delta;
    if (next < 0) next = currentLbPhotos.length - 1;
    if (next >= currentLbPhotos.length) next = 0;
    currentLbIndex = next;
    renderLightboxCurrent();
  }

  function retryLightboxImage() {
    var p = currentLbPhotos[currentLbIndex];
    var lbImg = $('#lbImg');
    var lbError = $('#lbError');
    if (!p || !lbImg) return;
    if (lbError) lbError.hidden = true;
    lbImg.hidden = false;
    var viewUrl = p.id ? Api.photoUrl(p.id, 'view') : (p.url || '');
    var sep = viewUrl.indexOf('?') >= 0 ? '&' : '?';
    lbImg.src = viewUrl + sep + '_retry=' + Date.now();
  }

  function renderLightboxCurrent() {
    var p = currentLbPhotos[currentLbIndex];
    if (!p) return;

    var lbImg = $('#lbImg');
    var lbError = $('#lbError');
    var lbMeta = $('#lbMeta');
    var lbPrev = $('#lbPrev');
    var lbNext = $('#lbNext');

    if (lbPrev) lbPrev.hidden = currentLbPhotos.length <= 1;
    if (lbNext) lbNext.hidden = currentLbPhotos.length <= 1;

    if (lbError) lbError.hidden = true;
    if (lbImg) {
      lbImg.hidden = false;
      lbImg.onload = function () {
        if (lbError) lbError.hidden = true;
      };
      lbImg.onerror = function () {
        lbImg.hidden = true;
        if (lbError) lbError.hidden = false;
      };
      var viewUrl = p.id ? Api.photoUrl(p.id, 'view') : (p.url || '');
      lbImg.src = viewUrl;
    }

    var downloadUrl = p.id ? Api.photoDownloadUrl(p.id) : (p.downloadUrl || p.url || '');
    var fileName = p.originalFilename || p.filename || ('photo_' + (p.id ? p.id.slice(0, 8) : (currentLbIndex + 1)) + '.jpg');

    var counterHtml = currentLbPhotos.length > 1
      ? '<span class="lb-counter" style="margin-right:8px;font-weight:600">Photo ' + (currentLbIndex + 1) + ' of ' + currentLbPhotos.length + '</span> · '
      : '';

    var uploader = p.takenBy ? userName(p.takenBy) : (p.creatorName || (p.createdBy ? ('Staff #' + p.createdBy) : 'Staff'));
    var takenTime = p.takenAt || p.createdAt ? when(p.takenAt || p.createdAt) : '';
    var sizeStr = p.sizeBytes ? (' · ' + bytes(p.sizeBytes)) : '';

    var recordBtnHtml = '';
    if (p.jobReference) {
      recordBtnHtml = ' <button type="button" class="btn ghost btn-sm" id="lbViewRecord" style="margin-top:12px;margin-left:8px">View Record (' + esc(p.jobReference) + ')</button>';
    }

    if (lbMeta) {
      lbMeta.innerHTML =
        counterHtml + esc(uploader) + (takenTime ? ' · ' + esc(takenTime) : '') + sizeStr +
        (p.jobReference ? '<br><span class="mono" style="font-size:12px">Ref: ' + esc(p.jobReference) + '</span>' : '') +
        '<div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
          '<a href="' + esc(downloadUrl) + '" download="' + esc(fileName) + '" class="btn ghost btn-sm" id="lbDownload" style="text-decoration:none;display:inline-flex;align-items:center;gap:4px"><svg style="width:14px;height:14px"><use href="#i-download"></use></svg> Download</a>' +
          recordBtnHtml +
          (me && me.role === 'admin' && p.id ? ' <button type="button" class="btn danger btn-sm" id="lbDel" style="margin-top:12px">Delete</button>' : '') +
        '</div>';
    }

    var viewRecordBtn = $('#lbViewRecord');
    if (viewRecordBtn && p.jobReference) {
      viewRecordBtn.addEventListener('click', function () {
        closeLightbox();
        Api.listInventoryTransactions({ search: p.jobReference, limit: 1 }).then(function (res) {
          var list = (res && res.items) || (Array.isArray(res) ? res : []);
          if (list && list.length > 0) {
            openTransactionDetailModal(list[0].id);
          } else {
            toast('No inventory transaction found for reference ' + p.jobReference);
          }
        }).catch(function (err) {
          toast('Could not load record: ' + (err.message || err));
        });
      });
    }

    var del = $('#lbDel');
    if (del && p.id) {
      del.addEventListener('click', function () {
        if (!confirm('Delete this photo permanently?')) return;
        Api.deletePhoto(p.id).then(function () {
          closeLightbox();
          renderPhotos();
          toast('Photo deleted.');
        }).catch(function (err) { toast(err.message || 'Could not delete photo.'); });
      });
    }
  }

  function addPhotos(files) {
    if (!files || !files.length) return;
    var w = warehouse();
    var MAX = inventoryPhotoMax();

    var chosen = Array.prototype.slice.call(files);
    var overflow = 0;
    if (chosen.length > MAX) {
      overflow = chosen.length - MAX;
      chosen = chosen.slice(0, MAX);
    }

    toast('Uploading ' + chosen.length + (chosen.length === 1 ? ' photo…' : ' photos…'));

    /* prepareAll decodes one image at a time; the previous Promise.all over
       every file held a full-resolution bitmap per photo simultaneously,
       which is what made a large multi-select fail on a phone. */
    Photos.prepareAll(chosen).then(function (prepared) {
      return Api.uploadPhotos(prepared.map(function (r) { return r.file; }), {
        warehouseId: w ? w.id : undefined
      });
    }).then(function (res) {
      var n = (res || []).length;
      toast(n + (n === 1 ? ' photo uploaded.' : ' photos uploaded.') +
        (overflow > 0 ? ' ' + overflow + ' not uploaded — the limit is ' + MAX + ' at a time.' : ''));
      renderPhotos();
    }).catch(function (err) {
      toast('Upload failed: ' + (err.message || err));
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

  /* --------------------------------------------------------------------
     Invoice number display.

     The number is allocated server-side (PostgreSQL sequence) at save time,
     so an unsaved draft has none yet. We show the backend's preview of the
     next number when we have it, and a plain non-numeric label when we do
     not -- never a hardcoded digit string, which previously read as a real
     invoice number ("1115 (Assigned)") and misled users.
     -------------------------------------------------------------------- */
  var nextInvoiceNumberHint = null;

  function invoiceNumberDisplay(d) {
    if (d && d.invoiceNumber) return String(d.invoiceNumber);
    if (nextInvoiceNumberHint) return nextInvoiceNumberHint + ' (Assigned)';
    return 'Assigned on save';
  }

  /* Refreshes the "(Assigned)" hint from the backend and patches the editor
     label in place, so opening the editor never has to block on the call. */
  function refreshNextInvoiceNumber() {
    if (!Api || typeof Api.nextInvoiceNumber !== 'function') return;
    Api.nextInvoiceNumber().then(function (res) {
      if (!res || !res.nextNumber) return;
      nextInvoiceNumberHint = String(res.nextNumber);
      var el = $('#edInvoiceNo');
      if (el && !(draft && draft.invoiceNumber)) {
        el.textContent = invoiceNumberDisplay(draft);
      }
    }).catch(function () { /* hint only -- editor stays usable without it */ });
  }

  /* ====================================================================
     Action registry

     Every "create" affordance in the app resolves through this one table.
     Previously the top-right toolbar buttons owned their modal code via
     addEventListener, while the centered empty-state buttons rendered
     `data-action="newCustomer"` / `data-action="newProduct"` -- names that
     matched the toolbar button *element ids* but were never registered in
     the delegated click handler, so those buttons silently did nothing.

     Both entry points now dispatch to the same function here, so there is a
     single modal implementation per entity and no id-click indirection.
     ==================================================================== */

  function openNewInvoice() {
    draft = newDraft();
    editorViewMode = false;
    show('editor');
    refreshNextInvoiceNumber();
  }

  function openAddCustomerModal() {
    openModal('Add Customer',
      field('name', 'Customer / Company Name', { required: true }) +
      field('billTo', 'Billing Address', { type: 'textarea', required: true }) +
      field('shipTo', 'Shipping Address', { type: 'textarea' }) +
      field('email', 'Email Address', { type: 'email' }),
      function (fd) {
        return Api.createCustomer({
          name: fd.name, billTo: fd.billTo, shipTo: fd.shipTo, email: fd.email,
          warehouseId: warehouseId,
          // The customer belongs to the division currently being worked in.
          // Stated explicitly rather than left to the server to infer: a user
          // with access to both divisions has no unambiguous default, and the
          // API rejects a create that does not say which.
          division: apiDivisionKey(entity)
        }).then(function () { toast('Customer added.'); renderCustomers(); });
      });
  }

  function openAddProductModal() {
    var w = warehouse();
    if (!w) { toast('Please select a warehouse first.'); return; }
    // `entity` is the division currently being viewed, so a product created
    // from the Healthcare catalog defaults to division=healthcare and one
    // created from Recycling defaults to division=recycling. The field is
    // always rendered and always submitted -- the API rejects a missing or
    // unknown division, and must keep doing so.
    openModal('Add ' + (isRecycling() ? 'Material' : 'Product'),
      field('name', 'Product', { required: true, placeholder: isRecycling() ? 'e.g. Mixed Electronics' : 'e.g. Synguard 100 Nitrile Gloves' }) +
      field('category', 'Category', { placeholder: isRecycling() ? 'e.g. Electronics / Plastics' : 'e.g. PPE / Gloves' }) +
      productDivisionFacilityFields(entity, w.name) +
      field('description', 'Description (Optional)', { type: 'textarea' }),
      function (fd) {
        var division = fd.division || entity;
        return Api.createMaterial({
          name: fd.name, category: fd.category, description: fd.description,
          division: division, warehouseId: w.id,
          unit: division === 'recycling' ? 'pallet' : 'box'
        }).then(function () { toast('Catalog item added.'); renderProducts(); });
      });
  }

  var ACTIONS = {
    newInvoice: openNewInvoice,
    newPurchaseOrder: function () { openNewPurchaseOrder(); },
    newCustomer: openAddCustomerModal,
    newProduct: openAddProductModal,
    goProducts: function () { show('products'); },
    addPhoto: function () { var ap = $('#addPhoto'); if (ap) ap.click(); }
  };

  function runAction(name) {
    var fn = ACTIONS[name];
    if (typeof fn === 'function') { fn(); return true; }
    return false;
  }

  /* Binds a concrete element (the toolbar buttons) to a registered action.
     Also stamps data-action so the element is discoverable by the same
     delegated handler and by tests. */
  function bindAction(el, name) {
    if (!el) return;
    el.setAttribute('data-action', name);
    el.setAttribute('data-action-bound', '');
    el.addEventListener('click', function (e) { e.preventDefault(); runAction(name); });
  }

  /* --------------------------------------------------------------------
     Printing / Save as PDF.

     Browsers derive the default "Save as PDF" filename from document.title,
     which is the app shell's title ("GreenWave Operations Platform") -- so
     every saved invoice landed on disk under the same meaningless name. We
     swap in a deterministic document name for the duration of the print job
     and restore it afterwards.

     The invoice number is read from the saved record, never invented here;
     an unsaved draft prints as Invoice-Draft rather than borrowing a number
     it has not been allocated yet.
     -------------------------------------------------------------------- */
  function printDocumentName(d) {
    var n = d && d.invoiceNumber ? String(d.invoiceNumber) : '';
    // Keep only characters that are safe in a filename on every OS.
    n = n.replace(/[^A-Za-z0-9._-]/g, '');
    return n ? 'Invoice-' + n : 'Invoice-Draft';
  }

  function printInvoiceDocument() {
    if (!draft) return;
    if (!editorViewMode && typeof syncInvoiceDraftFromForm === 'function') {
      syncInvoiceDraftFromForm();
    }
    var previousTitle = document.title;
    var restored = false;
    var mql = null;
    var invStyle = null;

    function restore() {
      if (restored) return;
      restored = true;
      document.title = previousTitle;
      document.body.classList.remove('printing-invoice');
      if (invStyle && invStyle.parentNode) invStyle.parentNode.removeChild(invStyle);
      window.removeEventListener('afterprint', restore);
      if (mql && mql.removeListener) mql.removeListener(onMqlChange);
    }
    function onMqlChange(e) { if (!e.matches) restore(); }

    document.title = printDocumentName(draft);
    document.body.classList.add('printing-invoice');

    try {
      invStyle = document.createElement('style');
      invStyle.id = 'invPrintPageRule';
      invStyle.textContent = '@page { size: A4 portrait !important; margin: 0 !important; }';
      document.head.appendChild(invStyle);
    } catch (e) { /* ignore */ }

    window.addEventListener('afterprint', restore);
    try {
      mql = window.matchMedia('print');
      if (mql && mql.addListener) mql.addListener(onMqlChange);
    } catch (e) { /* matchMedia('print') unsupported -- afterprint covers us */ }

    window.print();
    setTimeout(restore, 60000);
  }

  function downloadInvoicePdf() {
    if (!draft) return;
    if (!editorViewMode && typeof syncInvoiceDraftFromForm === 'function') {
      syncInvoiceDraftFromForm();
    }
    var num = draft.invoiceNumber ? String(draft.invoiceNumber).replace(/[^A-Za-z0-9._-]/g, '') : 'Draft';
    var filename = 'Invoice-' + num + '.pdf';
    toast('Generating clean A4 PDF...', 'info');

    Api.renderInvoicePdf({
      html: invoiceDocumentHtml(draft),
      invoiceNumber: num
    }).then(function (blob) {
      var url = window.URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }, 1000);
      toast('Downloaded ' + filename, 'success');
    }).catch(function (err) {
      console.error('Download Invoice PDF error:', err);
      toast('Failed to generate PDF: ' + (err.message || 'Unknown error'), 'error');
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

  function savedInvoiceTaxRate(inv) {
    return (inv.taxRate == null || inv.taxRate === '' || isNaN(Number(inv.taxRate))) ? 5 : Number(inv.taxRate);
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
      // A stored 0% (zero-rated / export) is a real rate: only a missing
      // value falls back to the 5% GST default. The label follows the rate
      // when none was stored (e.g. an invoice converted from a proforma).
      taxLabel: inv.taxLabel || ('GST @ ' + savedInvoiceTaxRate(inv) + '%'),
      taxRatePct: savedInvoiceTaxRate(inv),
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
    if (edPrint) edPrint.onclick = function () { printInvoiceDocument(); };

    var edPdf = $('#edPdf');
    if (edPdf) edPdf.onclick = function () { downloadInvoicePdf(); };

    var edPreview = $('#edPreview');
    if (edPreview) {
      if (editorViewMode) {
        edPreview.innerHTML = '<svg><use href="#i-edit"></use></svg>Edit Form';
        edPreview.onclick = function () {
          editorViewMode = false;
          renderEditor();
        };
      } else {
        edPreview.innerHTML = '<svg><use href="#i-doc"></use></svg>Preview';
        edPreview.onclick = function () {
          syncInvoiceDraftFromForm();
          editorViewMode = true;
          renderEditor();
        };
      }
    }

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

  /* Authoritative Invoice 1114 Document HTML generator.
     Used across Document Preview, Print, and Playwright PDF Generation. */
  function invoiceDocumentHtml(d) {
    if (!d) d = {};
    var co = d.companyInfo || {};
    var coName = co.name || 'Greenwave Recycling Inc.';
    var coBn = co.bn || 'BN 751161951BC0001';
    var coGst = co.gst || '751161951RT0001';
    var coLine1 = co.line1 || '23394 Fisherman Rd,';
    var coLine2 = co.line2 || 'Maple Ridge, BC V2W 1B9';
    var coEmail = co.email || 'sales@greenwaverecycling.ca';
    var coPhone = co.phone || '6724720423';

    var tot = totalsLocal(d);
    var pStatus = paymentStatusMeta(d.paymentStatus);

    var billLines = (d.billTo || '').split('\n').filter(Boolean).map(esc).join('<br>');
    var shipLines = (d.shipTo || '').split('\n').filter(Boolean).map(esc).join('<br>');

    var itemsHtml = (d.items || []).map(function (it, idx) {
      var lineAmt = lineAmountDollars(it);
      return '<tr>' +
        '<td class="mono">' + (idx + 1) + '.</td>' +
        '<td class="mono">' + esc(it.serviceDate || d.invoiceDate || '—') + '</td>' +
        '<td>' + esc(it.productService || 'supply') + '</td>' +
        '<td>' + esc(it.unit || '') + '</td>' +
        '<td>' + esc(it.description || '—') + '</td>' +
        '<td class="num mono">' + num(it.quantity, 3) + '</td>' +
        '<td class="num mono">' + moneyRate(it.unitPrice) + '</td>' +
        '<td class="num mono" style="font-weight:600">' + moneyDollars(lineAmt) + '</td>' +
        '<td class="num">' + esc(it.taxRateLabel || 'GST') + '</td>' +
      '</tr>';
    }).join('');

    if (!itemsHtml) {
      itemsHtml = '<tr><td colspan="9" style="text-align:center;padding:16px;color:#888;">No line items</td></tr>';
    }

    var payLinkUrl = d.id ? ('#pay/' + d.id) : '#';
    var invNumStr = (d && d.invoiceNumber) ? String(d.invoiceNumber) : (nextInvoiceNumberHint || '—');

    var taxLabel = d.taxLabel || 'GST @ 5%';
    var taxLabelStr = taxLabel.indexOf('@') >= 0
      ? (esc(taxLabel) + ' on ' + moneyDollars(tot.subtotal))
      : (esc(taxLabel) + ' on ' + moneyDollars(tot.subtotal));

    return '<div class="invoice-page-1114">' +
      '<div class="inv-header">' +
        '<div class="inv-header-left">' +
          '<h1 class="inv-title">INVOICE</h1>' +
          '<div class="inv-co-grid">' +
            '<div>' +
              '<div class="inv-co-name">' + esc(coName) + '</div>' +
              '<div>' + esc(coBn) + '</div>' +
              '<div class="inv-co-sub">GST/HST Registration No.</div>' +
              '<div>' + esc(coGst) + '</div>' +
            '</div>' +
            '<div>' +
              '<div>' + esc(coLine1) + '</div>' +
              '<div>' + esc(coLine2) + '</div>' +
              '<div>' + esc(coEmail) + '</div>' +
              '<div>' + esc(coPhone) + '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="inv-logo-wrap">' +
          '<img src="assets/logo-invoice.png" class="inv-logo-img" alt="' + esc(coName) + '">' +
        '</div>' +
      '</div>' +

      '<div class="inv-tint-box">' +
        '<div class="inv-tint-row">' +
          '<div class="inv-tint-col">' +
            '<div class="inv-tint-lbl">Bill to</div>' +
            '<div>' + (billLines || '<span style="color:#888">—</span>') + '</div>' +
          '</div>' +
          '<div class="inv-tint-col">' +
            '<div class="inv-tint-lbl">Ship to</div>' +
            '<div>' + (shipLines || '<span style="color:#888">—</span>') + '</div>' +
          '</div>' +
        '</div>' +

        '<div class="inv-tint-divider"></div>' +

        '<div class="inv-tint-row">' +
          '<div class="inv-tint-col">' +
            '<div class="inv-tint-lbl">Shipping info</div>' +
            '<div class="inv-detail-row"><span class="inv-detail-k">Ship via:</span><span class="inv-detail-v">' + esc(d.shipVia || 'Greenwave Recycling Truck') + '</span></div>' +
            '<div class="inv-detail-row"><span class="inv-detail-k">Ship date:</span><span class="inv-detail-v">' + esc(d.shipDate || d.invoiceDate || '—') + '</span></div>' +
          '</div>' +
          '<div class="inv-tint-col">' +
            '<div class="inv-tint-lbl">Invoice details</div>' +
            '<div class="inv-detail-row"><span class="inv-detail-k">Invoice no.:</span><span class="inv-detail-v mono" style="font-weight:700">' + esc(invNumStr) + '</span></div>' +
            '<div class="inv-detail-row"><span class="inv-detail-k">Terms:</span><span class="inv-detail-v">' + esc(d.paymentTerms || 'Net 15') + '</span></div>' +
            '<div class="inv-detail-row"><span class="inv-detail-k">Invoice date:</span><span class="inv-detail-v">' + esc(d.invoiceDate || '—') + '</span></div>' +
            '<div class="inv-detail-row"><span class="inv-detail-k">Due date:</span><span class="inv-detail-v">' + esc(d.dueDate || '—') + '</span></div>' +
            (d.id && d.paymentStatus ? (
              '<div class="inv-detail-row"><span class="inv-detail-k">Status:</span><span class="badge ' + pStatus.cls + '">' + pStatus.label + '</span></div>' +
              (d.paymentStatus === 'paid' && d.paidAt ? '<div class="inv-detail-row"><span class="inv-detail-k"></span><span style="font-size:12px;color:#0F7A4C;font-weight:600">Paid on: ' + ddmmyyyy(d.paidAt) + '</span></div>' : '')
            ) : '') +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="inv-table-wrap">' +
        '<table class="inv-table">' +
          '<thead>' +
            '<tr>' +
              '<th style="width:25px">#</th>' +
              '<th style="width:75px">Service Date</th>' +
              '<th style="width:95px">Product/service</th>' +
              '<th style="width:45px">Unit.</th>' +
              '<th>Description</th>' +
              '<th class="num" style="width:55px">Qty</th>' +
              '<th class="num" style="width:70px">Rate</th>' +
              '<th class="num" style="width:80px">Amount</th>' +
              '<th class="num" style="width:45px">Tax</th>' +
            '</tr>' +
          '</thead>' +
          '<tbody>' + itemsHtml + '</tbody>' +
        '</table>' +
      '</div>' +

      '<div class="inv-bottom-area">' +
        '<div class="inv-pay-col">' +
          '<div class="inv-pay-title">Ways to pay</div>' +
          '<div class="inv-pay-icons">' +
            '<img src="assets/pay-visa.png" class="inv-pay-icon" alt="Visa">' +
            '<img src="assets/pay-mc.png" class="inv-pay-icon" alt="Mastercard">' +
            '<img src="assets/pay-discover.png" class="inv-pay-icon" alt="Discover">' +
            '<img src="assets/pay-amex.png" class="inv-pay-icon" alt="Amex">' +
            '<img src="assets/pay-jcb.png" class="inv-pay-icon" alt="JCB">' +
            '<img src="assets/pay-bank.png" class="inv-pay-icon" alt="Bank">' +
          '</div>' +
          '<div>' +
            '<a href="' + payLinkUrl + '" class="inv-view-pay-btn" target="_blank" rel="noopener">View and pay</a>' +
          '</div>' +
          (d.paymentInstructions ? ('<div class="inv-instructions-note" style="margin-top:14px;font-size:8.5pt;color:#555;white-space:pre-line;">' + esc(d.paymentInstructions) + '</div>') : '') +
          (d.notes ? ('<div class="inv-notes-note" style="margin-top:8px;font-size:8.5pt;color:#666;white-space:pre-line;">' + esc(d.notes) + '</div>') : '') +
        '</div>' +

        '<div class="inv-totals-col">' +
          '<div class="inv-tot-row">' +
            '<span>Subtotal</span>' +
            '<span class="mono">' + moneyDollars(tot.subtotal) + '</span>' +
          '</div>' +
          '<div class="inv-tot-row">' +
            '<span>' + taxLabelStr + '</span>' +
            '<span class="mono">' + moneyDollars(tot.tax) + '</span>' +
          '</div>' +
          '<div class="inv-tot-divider"></div>' +
          '<div class="inv-tot-row inv-total-due">' +
            '<span>Total</span>' +
            '<span class="mono">' + moneyDollars(tot.total) + '</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* Read-only, professional invoice document view */
  function renderInvoiceDocumentView() {
    var edBody = $('#editorBody');
    if (!edBody) return;
    edBody.innerHTML = '<div class="invoice-doc-container">' + invoiceDocumentHtml(draft) + '</div>';
  }

  function syncInvoiceDraftFromForm() {
    if (!draft) return;
    var billEl = $('#edBill'); if (billEl) draft.billTo = billEl.value;
    var shipEl = $('#edShip'); if (shipEl) draft.shipTo = shipEl.value;
    var shipViaEl = $('#edShipVia'); if (shipViaEl) draft.shipVia = shipViaEl.value;
    var shipDateEl = $('#edShipDate'); if (shipDateEl) draft.shipDate = shipDateEl.value;
    var termsEl = $('#edTerms'); if (termsEl) draft.paymentTerms = termsEl.value;
    var dateEl = $('#edDate'); if (dateEl) draft.invoiceDate = dateEl.value;
    var dueEl = $('#edDueDate'); if (dueEl) draft.dueDate = dueEl.value;
    var payInstEl = $('#edPayInst'); if (payInstEl) draft.paymentInstructions = payInstEl.value;
    var notesEl = $('#edNotes'); if (notesEl) draft.notes = notesEl.value;

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

    var pDoc = $('#invPrintDoc');
    if (pDoc) pDoc.innerHTML = invoiceDocumentHtml(draft);
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
              '<img src="assets/logo.png?v=20260907_purchaseorders" alt="Greenwave Logo" class="inv-1114-logo-img">' +
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
              '<div class="inv-1114-meta-row"><label>Invoice no.:</label><span class="mono" id="edInvoiceNo" style="font-weight:700">' + esc(invoiceNumberDisplay(draft)) + '</span></div>' +
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
    edBody.innerHTML =
      '<div class="inv-editor-form">' + html + '</div>' +
      '<div class="inv-print-document" id="invPrintDoc" style="display:none">' + invoiceDocumentHtml(draft) + '</div>';

    var syncDraftValues = syncInvoiceDraftFromForm;

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
        taxRate: (draft.taxRatePct === '' || draft.taxRatePct == null || isNaN(Number(draft.taxRatePct))) ? 5 : Number(draft.taxRatePct),
        // Same rule as customers: the invoice is created in the division the
        // user is working in, stated explicitly. This is scoping only — it has
        // no bearing on the invoice number, which stays a single global
        // sequence shared by both divisions.
        division: apiDivisionKey(entity),
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

  /* ==========================================================================
     PURCHASE ORDERS

     A purchase order is a distinct document type from an invoice: money going
     out rather than in, its own `PO-0001` numbering series, and resin-trading
     line items (code / resin / colour). The layout below reproduces the
     supplied PURCHASE.docx -- navy section rules, bordered header box, wide
     line-item table, strong TOTAL -- and is the SAME markup for the live
     preview, the read-only document view and the printed PDF, so what the
     admin sees while typing is exactly what comes out of the printer.

     Administrator-only. Everything here is gated by can('purchaseorders'),
     which is a convenience: the real control is @Roles('admin') on
     PurchaseOrdersController, and every call below 403s for anyone else.
     ========================================================================== */

  /* --------------------------------------------------------------------
     Exact money arithmetic.

     The document must agree with the server to the cent, and the server
     computes in exact fixed-point (see api/src/common/decimal.ts). Doing the
     preview in floats would make it disagree on values like 10 x 1.0005, so
     the same integer-scaled arithmetic is mirrored here with BigInt. Scales
     match the NUMERIC columns in migration 018.
     -------------------------------------------------------------------- */
  var PO_QTY_SCALE = 3;
  var PO_PRICE_SCALE = 4;
  var PO_MONEY_SCALE = 2;

  function poToScaled(value, scale) {
    var text = String(value == null || value === '' ? '0' : value).trim();
    // Expand exponent notation before the digit-slicing below.
    if (/[eE]/.test(text)) {
      var n = Number(text);
      if (!isFinite(n)) return BigInt(0);
      text = n.toFixed(Math.min(20, scale + 6));
    }
    var m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text);
    if (!m || (m[2] === '' && !m[3])) return BigInt(0);

    var frac = m[3] || '';
    var kept = frac.slice(0, scale);
    while (kept.length < scale) kept += '0';

    var units = BigInt((m[2] || '0') + kept);
    var dropped = frac.slice(scale);
    if (dropped.length && dropped.charCodeAt(0) >= 53 /* '5' */) {
      units += BigInt(1);
    }
    return m[1] === '-' ? -units : units;
  }

  function poDivideRounded(numerator, denominator) {
    var negative = numerator < BigInt(0);
    var abs = negative ? -numerator : numerator;
    var two = BigInt(2);
    var rounded = (abs * two + denominator) / (denominator * two);
    return negative ? -rounded : rounded;
  }

  /** quantity x unitPrice, exact, in cents. Mirrors lineAmountCents() server-side. */
  function poLineAmountCents(quantity, unitPrice) {
    var qty = poToScaled(quantity, PO_QTY_SCALE);
    var price = poToScaled(unitPrice, PO_PRICE_SCALE);
    var excess = PO_QTY_SCALE + PO_PRICE_SCALE - PO_MONEY_SCALE;
    var divisor = BigInt(1);
    for (var i = 0; i < excess; i++) divisor *= BigInt(10);
    return poDivideRounded(qty * price, divisor);
  }

  function poTotalCents(items) {
    var sum = BigInt(0);
    (items || []).forEach(function (it) {
      sum += poLineAmountCents(it.quantity, it.unitPrice);
    });
    return sum;
  }

  /** Cents -> "21940.00". Plain 2dp, matching the reference document. */
  function poMoney(cents) {
    var negative = cents < BigInt(0);
    var digits = (negative ? -cents : cents).toString();
    while (digits.length <= PO_MONEY_SCALE) digits = '0' + digits;
    var whole = digits.slice(0, digits.length - PO_MONEY_SCALE);
    var frac = digits.slice(digits.length - PO_MONEY_SCALE);
    return (negative ? '-' : '') + whole + '.' + frac;
  }

  /** Unit price as shown in the table: 2dp minimum, up to 4 when finer. */
  function poPrice(value) {
    var n = Number(value);
    if (!isFinite(n)) return '0.00';
    var s = n.toFixed(4).replace(/(\.\d\d)0+$/, '$1');
    return s;
  }

  /**
   * Quantity as the reference renders it -- space-grouped thousands and no
   * trailing zeros ("54 850", not "54,850.000").
   */
  function poQty(value) {
    var n = Number(value);
    if (!isFinite(n)) return '0';
    var s = n.toFixed(3).replace(/\.?0+$/, '');
    var parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return parts.join('.');
  }

  function poCurrency(d) {
    return (d && d.currency) === 'CAD' ? 'CAD' : 'USD';
  }

  /* --------------------------------------------------------------------
     Draft model
     -------------------------------------------------------------------- */

  /**
   * Company letterhead for the PO.
   *
   * The reference document's own header differs from the invoice letterhead
   * (comma after the street number, full "CANADA", dashed phone), so it is
   * seeded from the reference rather than reusing the invoice defaults --
   * and every line stays editable.
   */
  function poCompanyDefaults() {
    var co = db.company || {};
    return {
      name: 'GreenWave Recycling Inc.',
      line1: '23394, Fisherman Rd',
      line2: 'Maple Ridge, BC, V3W 1B9, CANADA',
      phone: '1-672-472-0423',
      email: co.email || 'sales@greenwaverecycling.ca'
    };
  }

  function blankPoLine() {
    return {
      code: '', resin: '', description: '', color: '',
      quantity: 0, unit: 'lbs', unitPrice: 0
    };
  }

  function newPoDraft() {
    var w = warehouse();
    return {
      id: null,
      poNumber: '',
      orderDate: today(),
      expectedDate: '',
      currency: 'USD',
      supplierName: '',
      supplierAddress: '',
      supplierCity: '',
      supplierProvince: '',
      supplierPostalCode: '',
      supplierCountry: '',
      supplierPhone: '',
      supplierEmail: '',
      companyInfo: poCompanyDefaults(),
      notes: '',
      footerDate: '',
      status: 'draft',
      warehouseId: w ? w.id : null,
      items: [blankPoLine()]
    };
  }

  function poToDraft(po) {
    var co = po.companyInfo || poCompanyDefaults();
    var items = (po.items || []).map(function (it) {
      return {
        code: it.code || '',
        resin: it.resin || '',
        description: it.description || '',
        color: it.color || '',
        quantity: Number(it.quantity) || 0,
        unit: it.unit || '',
        unitPrice: Number(it.unitPrice) || 0
      };
    });
    if (!items.length) items = [blankPoLine()];
    return {
      id: po.id,
      poNumber: po.poNumber || '',
      orderDate: po.orderDate || today(),
      expectedDate: po.expectedDate || '',
      currency: po.currency === 'CAD' ? 'CAD' : 'USD',
      supplierName: po.supplierName || '',
      supplierAddress: po.supplierAddress || '',
      supplierCity: po.supplierCity || '',
      supplierProvince: po.supplierProvince || '',
      supplierPostalCode: po.supplierPostalCode || '',
      supplierCountry: po.supplierCountry || '',
      supplierPhone: po.supplierPhone || '',
      supplierEmail: po.supplierEmail || '',
      companyInfo: {
        name: co.name || 'GreenWave Recycling Inc.',
        line1: co.line1 || '23394, Fisherman Rd',
        line2: co.line2 || 'Maple Ridge, BC, V3W 1B9, CANADA',
        phone: co.phone || '1-672-472-0423',
        email: co.email || 'sales@greenwaverecycling.ca'
      },
      notes: po.notes || '',
      footerDate: po.footerDate || '',
      status: po.status || 'draft',
      warehouseId: po.warehouseId || null,
      items: items
    };
  }

  function poNumberDisplay(d) {
    if (d && d.poNumber) return String(d.poNumber);
    if (nextPoNumberHint) return nextPoNumberHint;
    return 'Assigned on save';
  }

  /* Refreshes the next-number hint from the backend. Purely a hint: the
     authoritative number is the one create() returns, and if another admin
     saves first they take this one. */
  function refreshNextPoNumber() {
    if (!Api || typeof Api.nextPurchaseOrderNumber !== 'function') return;
    Api.nextPurchaseOrderNumber().then(function (res) {
      if (!res || !res.nextNumber) return;
      nextPoNumberHint = String(res.nextNumber);
      var kpi = $('#kpiPoNext');
      if (kpi) kpi.textContent = nextPoNumberHint;
      if (poDraft && !poDraft.poNumber) {
        var el = $('#poEdNumber');
        if (el) el.textContent = nextPoNumberHint;
        var docEl = $('#poDocNumber');
        if (docEl) docEl.textContent = nextPoNumberHint;
      }
    }).catch(function () { /* hint only -- the editor stays usable without it */ });
  }

  /* --------------------------------------------------------------------
     The document itself.

     One function, used by the live preview, the read-only view and print.
     There is deliberately no second "print template" that could drift.
     -------------------------------------------------------------------- */
  function poSupplierLines(d) {
    var locality = [d.supplierCity, d.supplierProvince, d.supplierPostalCode]
      .filter(function (x) { return x && String(x).trim(); })
      .join(', ');
    if (d.supplierCountry && String(d.supplierCountry).trim()) {
      locality = locality ? locality + ', ' + d.supplierCountry : d.supplierCountry;
    }
    var contact = [];
    if (d.supplierPhone) contact.push('Tel: ' + d.supplierPhone);
    if (d.supplierEmail) contact.push(d.supplierEmail);

    return {
      name: d.supplierName || '',
      address: d.supplierAddress || '',
      locality: locality,
      contact: contact.join('  ')
    };
  }

  function poFormatDate(val) {
    if (!val || typeof val !== 'string') return '';
    var trimmed = val.trim();
    if (!trimmed) return '';
    var m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return '';
    var y = parseInt(m[1], 10);
    var mo = parseInt(m[2], 10);
    var d = parseInt(m[3], 10);
    if (y < 2000 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > 31) return '';
    return trimmed;
  }

  function poDocumentHtml(d) {
    var co = d.companyInfo || poCompanyDefaults();
    var cur = poCurrency(d);
    var sup = poSupplierLines(d);
    var totalCents = poTotalCents(d.items);

    var rows = (d.items || []).map(function (it) {
      return '<tr>' +
        '<td>' + esc(it.code || '') + '</td>' +
        '<td class="po-c">' + esc(it.resin || '') + '</td>' +
        '<td>' + esc(it.description || '') + '</td>' +
        '<td class="po-c">' + esc(it.color || '') + '</td>' +
        '<td class="po-c">' + esc(poQty(it.quantity)) + '</td>' +
        '<td class="po-c">' + esc(it.unit || '') + '</td>' +
        '<td class="po-r">' + esc(poPrice(it.unitPrice)) + '</td>' +
        '<td class="po-r">' + esc(poMoney(poLineAmountCents(it.quantity, it.unitPrice))) + '</td>' +
      '</tr>';
    }).join('');

    return '' +
      '<div class="po-page">' +

        /* Letterhead */
        '<div class="po-letterhead">' +
          '<img src="assets/logo.png?v=20260907_purchaseorders" alt="GreenWave Recycling Inc." class="po-logo">' +
          '<div class="po-letterhead-text">' +
            '<div class="po-co-name">' + esc(co.name || 'GreenWave Recycling Inc.') + '</div>' +
            '<div class="po-co-line">' + esc(co.line1 || '23394, Fisherman Rd') + '</div>' +
            '<div class="po-co-line">' + esc(co.line2 || 'Maple Ridge, BC, V3W 1B9, CANADA') + '</div>' +
            '<div class="po-co-contact">' +
              (co.phone ? '<span class="po-co-tel">Tel: ' + esc(co.phone) + '</span>' : '') +
              (co.phone && co.email ? '<span class="po-co-dot">&nbsp;&bull;&nbsp;</span>' : '') +
              (co.email ? '<span class="po-co-email">' + esc(co.email) + '</span>' : '') +
            '</div>' +
          '</div>' +
        '</div>' +

        '<h1 class="po-title">PURCHASE ORDER</h1>' +

        /* Bordered header box: PO # / dates on the left, currency on the right */
        '<div class="po-infobox">' +
          '<div class="po-infobox-col">' +
            '<div class="po-kv"><span class="po-k">PO #:</span><span class="po-v mono" id="poDocNumber">' + esc(poNumberDisplay(d)) + '</span></div>' +
            '<div class="po-kv"><span class="po-k">Order Date:</span><span class="po-v">' + esc(poFormatDate(d.orderDate)) + '</span></div>' +
            '<div class="po-kv"><span class="po-k">Expected Date:</span><span class="po-v">' + esc(poFormatDate(d.expectedDate)) + '</span></div>' +
          '</div>' +
          '<div class="po-infobox-col po-infobox-col-right">' +
            '<div class="po-kv"><span class="po-k">Currency:</span><span class="po-v">' + esc(cur) + '</span></div>' +
          '</div>' +
        '</div>' +

        /* Supplier */
        '<div class="po-section-bar">SUPPLIER</div>' +
        '<div class="po-supplier">' +
          '<div class="po-supplier-name">' + (sup.name ? esc(sup.name) : '<span class="po-placeholder">Supplier name</span>') + '</div>' +
          (sup.address ? '<div class="po-supplier-line">' + esc(sup.address) + '</div>' : '') +
          (sup.locality ? '<div class="po-supplier-line">' + esc(sup.locality) + '</div>' : '') +
          (sup.contact ? '<div class="po-supplier-line">' + esc(sup.contact) + '</div>' : '') +
        '</div>' +

        /* Line items */
        '<div class="po-table-wrap">' +
          '<table class="po-table">' +
            '<thead><tr>' +
              '<th>Code</th>' +
              '<th class="po-c">Resin</th>' +
              '<th class="po-c">Description</th>' +
              '<th class="po-c">Color</th>' +
              '<th class="po-c">Quantity</th>' +
              '<th class="po-c">Unit</th>' +
              '<th class="po-c">Unit Price (' + esc(cur) + ')</th>' +
              '<th class="po-c">Amount (' + esc(cur) + ')</th>' +
            '</tr></thead>' +
            '<tbody>' + (rows || '<tr><td colspan="8" class="po-c po-placeholder">No line items</td></tr>') + '</tbody>' +
          '</table>' +
        '</div>' +

        (d.notes ? '<div class="po-notes"><span class="po-k">Notes:</span> ' + esc(d.notes) + '</div>' : '') +

        /* Signature date and total */
        '<div class="po-foot">' +
          '<div class="po-foot-date">Date: ' + (poFormatDate(d.footerDate) ? esc(poFormatDate(d.footerDate)) : '____________________') + '</div>' +
          '<div class="po-foot-total">TOTAL: ' + esc(poMoney(totalCents)) + ' ' + esc(cur) + '</div>' +
        '</div>' +

        '<div class="po-doc-footer">greenwaverecycling.ca</div>' +

      '</div>';
  }

  /* --------------------------------------------------------------------
     Printing / Save as PDF.

     Same approach as the invoice: the browser renders the document element
     itself to PDF via the print pipeline, so the output is real selectable,
     vector text -- not a screenshot of the UI. The tab title is swapped for
     the duration so the saved file is named after the PO rather than the app.
     -------------------------------------------------------------------- */
  function poPrintDocumentName(d) {
    var n = d && d.poNumber ? String(d.poNumber) : '';
    n = n.replace(/[^A-Za-z0-9._-]/g, '');
    return n || 'Purchase-Order';
  }

  function printPurchaseOrderDocument() {
    var previousTitle = document.title;
    var restored = false;
    var mql = null;
    var poStyle = null;
    function restore() {
      if (restored) return;
      restored = true;
      document.title = previousTitle;
      document.body.classList.remove('printing-po');
      if (poStyle && poStyle.parentNode) poStyle.parentNode.removeChild(poStyle);
      window.removeEventListener('afterprint', restore);
      if (mql && mql.removeListener) mql.removeListener(onMqlChange);
    }
    function onMqlChange(e) { if (!e.matches) restore(); }

    // Must be set before the dialog opens -- that is when the browser
    // snapshots the default filename.
    document.title = (poDraft && poDraft.poNumber) ? poDraft.poNumber : 'PURCHASE ORDER';
    document.body.classList.add('printing-po');

    try {
      poStyle = document.createElement('style');
      poStyle.id = 'poPrintPageRule';
      poStyle.textContent = '@page { size: A4 portrait !important; margin: 0 !important; }';
      document.head.appendChild(poStyle);
    } catch (e) { /* ignore */ }

    window.addEventListener('afterprint', restore);
    try {
      mql = window.matchMedia('print');
      if (mql && mql.addListener) mql.addListener(onMqlChange);
    } catch (e) { /* afterprint covers us */ }

    window.print();
    setTimeout(restore, 60000);
  }

  function downloadPurchaseOrderPdf() {
    if (!poDraft) return;
    var d = poDraft;
    var num = d.poNumber ? String(d.poNumber).replace(/[^A-Za-z0-9._-]/g, '') : 'Purchase-Order';
    var filename = num + '.pdf';
    toast('Generating clean A4 PDF...', 'info');

    Api.renderPurchaseOrderPdf({
      html: poDocumentHtml(d),
      poNumber: num
    }).then(function (blob) {
      var url = window.URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }, 1000);
      toast('Downloaded ' + filename, 'success');
    }).catch(function (err) {
      console.error('Download PDF error:', err);
      toast('Failed to generate PDF: ' + (err.message || 'Unknown error'), 'error');
    });
  }

  /* --------------------------------------------------------------------
     List / management view
     -------------------------------------------------------------------- */
  function openNewPurchaseOrder() {
    if (!can('purchaseorders')) { toast('Only administrators can create purchase orders.'); return; }
    poDraft = newPoDraft();
    poViewMode = false;
    show('poeditor');
    refreshNextPoNumber();
  }

  function poStatusBadge(status) {
    var s = String(status || 'draft').toLowerCase();
    if (s === 'issued') return '<span class="badge badge-received">Issued</span>';
    if (s === 'closed') return '<span class="badge badge-paid">Closed</span>';
    if (s === 'cancelled') return '<span class="badge badge-failed">Cancelled</span>';
    return '<span class="badge badge-transit">Draft</span>';
  }

  function updatePoMetrics(list) {
    var usd = BigInt(0), cad = BigInt(0);
    (list || []).forEach(function (po) {
      // NUMERIC comes back as a string from PostgreSQL and a number from the
      // sqlite test driver; poToScaled handles both without going via a float.
      var cents = poToScaled(po.total, PO_MONEY_SCALE);
      if (po.currency === 'CAD') cad += cents; else usd += cents;
    });
    var cEl = $('#kpiPoCount'); if (cEl) cEl.textContent = String((list || []).length);
    var uEl = $('#kpiPoUsd'); if (uEl) uEl.textContent = poMoney(usd);
    var dEl = $('#kpiPoCad'); if (dEl) dEl.textContent = poMoney(cad);
  }

  function renderPurchaseOrderList() {
    var host = $('#poList');
    if (host) {
      host.innerHTML =
        '<div class="card"><div class="po-skeleton-wrap">' +
        '<div class="po-skeleton po-skeleton-row"></div>'.repeat(5) +
        '</div></div>';
    }
    refreshNextPoNumber();

    Api.listPurchaseOrders({ warehouseId: warehouseId }).then(function (list) {
      poListCache = list || [];
      updatePoMetrics(poListCache);

      var el = $('#poList');
      if (!el) return;

      var filtered = poListCache.filter(function (po) {
        if (poFilter !== 'all' && String(po.status || 'draft').toLowerCase() !== poFilter) return false;
        if (poSearchQuery) {
          var q = poSearchQuery.toLowerCase();
          var hit = String(po.poNumber || '').toLowerCase().indexOf(q) >= 0 ||
                    String(po.supplierName || '').toLowerCase().indexOf(q) >= 0;
          if (!hit) return false;
        }
        return true;
      });

      if (!filtered.length) {
        el.innerHTML = poListCache.length
          ? emptyState('po', 'No matching purchase orders',
              'No purchase orders match the current filter or search.', null, null)
          : emptyState('po', 'No purchase orders yet',
              'Create a purchase order to send to a supplier. Numbers are assigned automatically, starting at PO-0001.',
              'Create Purchase Order', 'newPurchaseOrder');
        return;
      }

      el.innerHTML = '<div class="card"><div class="tablewrap" tabindex="0" role="region" aria-label="Scrollable table">' +
        '<table class="table stack-mobile" id="poTable"><thead><tr>' +
          '<th>PO #</th><th>Supplier</th><th>Order Date</th><th>Expected</th>' +
          '<th>Currency</th><th class="num">Total</th><th>Created By</th>' +
          '<th>Status</th><th>Created</th><th>Actions</th>' +
        '</tr></thead><tbody>' +
        filtered.map(function (po) {
          var cents = poToScaled(po.total, PO_MONEY_SCALE);
          return '<tr data-po-row="' + esc(po.id) + '">' +
            '<td data-label="PO #" class="mono"><strong>' + esc(po.poNumber) + '</strong></td>' +
            '<td data-label="Supplier">' + esc(po.supplierName || '—') + '</td>' +
            '<td data-label="Order Date" class="mono" style="font-size:13px">' + esc(po.orderDate || '—') + '</td>' +
            '<td data-label="Expected" class="mono" style="font-size:13px">' + esc(po.expectedDate || '—') + '</td>' +
            '<td data-label="Currency" class="mono" style="font-size:12.5px;font-weight:600">' + esc(poCurrency(po)) + '</td>' +
            '<td data-label="Total" class="num"><strong>' + esc(poMoney(cents)) + '</strong></td>' +
            '<td data-label="Created By"><span class="po-cell-clip" title="' + esc(userName(po.createdBy) || '') + '">' + esc(userName(po.createdBy) || '—') + '</span></td>' +
            '<td data-label="Status">' + poStatusBadge(po.status) + '</td>' +
            '<td data-label="Created" class="mono" style="font-size:12.5px">' + esc(po.createdAt ? String(po.createdAt).slice(0, 10) : '—') + '</td>' +
            '<td data-label="Actions">' +
              '<div style="display:flex;gap:6px;flex-wrap:nowrap">' +
                '<button type="button" class="btn ghost btn-sm po-btn-view" data-po-view="' + esc(po.id) + '">View</button>' +
                '<button type="button" class="btn ghost btn-sm po-btn-edit" data-po-edit="' + esc(po.id) + '" title="Edit"><svg style="width:13px;height:13px"><use href="#i-edit"></use></svg></button>' +
                '<button type="button" class="btn ghost btn-sm po-btn-print" data-po-print="' + esc(po.id) + '" title="Print / download PDF"><svg style="width:13px;height:13px"><use href="#i-print"></use></svg></button>' +
                '<button type="button" class="btn ghost btn-sm po-btn-del" data-po-del="' + esc(po.id) + '" title="Delete"><svg style="width:13px;height:13px"><use href="#i-trash"></use></svg></button>' +
              '</div>' +
            '</td></tr>';
        }).join('') + '</tbody></table></div></div>';

      function openPo(id, viewMode, thenPrint) {
        return Api.getPurchaseOrder(id).then(function (po) {
          poDraft = poToDraft(po);
          poViewMode = viewMode;
          show('poeditor');
          if (thenPrint) setTimeout(printPurchaseOrderDocument, 120);
        }).catch(function (err) {
          toast(err.message || 'Could not open that purchase order.');
        });
      }

      $$('.po-btn-view').forEach(function (b) {
        b.addEventListener('click', function () { openPo(b.dataset.poView, true, false); });
      });
      $$('.po-btn-edit').forEach(function (b) {
        b.addEventListener('click', function () { openPo(b.dataset.poEdit, false, false); });
      });
      $$('.po-btn-print').forEach(function (b) {
        b.addEventListener('click', function () { openPo(b.dataset.poPrint, true, true); });
      });
      $$('.po-btn-del').forEach(function (b) {
        b.addEventListener('click', function () {
          var po = poListCache.filter(function (x) { return x.id === b.dataset.poDel; })[0];
          confirmDeletePurchaseOrder(po);
        });
      });
    }).catch(function (err) { apiErrorState('#poList', err); });
  }

  function confirmDeletePurchaseOrder(po) {
    if (!po || !po.id) return;
    var bodyHtml =
      '<div class="delete-confirm">' +
        '<p class="delete-confirm-lead">This permanently removes the purchase order and all of its line items. This cannot be undone.</p>' +
        '<dl class="delete-confirm-details">' +
          '<div><dt>Purchase order</dt><dd>' + esc(po.poNumber || '') + '</dd></div>' +
          '<div><dt>Supplier</dt><dd>' + esc(po.supplierName || '—') + '</dd></div>' +
        '</dl>' +
        '<div class="global-access-warning">' +
          '<svg style="width:14px;height:14px;flex:none"><use href="#i-alert"></use></svg>' +
          'The number stays consumed &mdash; it is never reissued to a later purchase order.' +
        '</div>' +
      '</div>';

    openModal('Delete Purchase Order?', bodyHtml, function () {
      return Api.deletePurchaseOrder(po.id).then(function () {
        toast('Purchase order ' + po.poNumber + ' deleted.');
        if (poDraft && poDraft.id === po.id) poDraft = null;
        show('purchaseorders');
      });
    }, { okLabel: 'Delete Purchase Order', okClass: 'danger', savingLabel: 'Deleting…' });
  }

  function setupPurchaseOrderFilters() {
    $$('#poFilterTabs [data-po-filter]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('#poFilterTabs [data-po-filter]').forEach(function (b) {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        poFilter = btn.dataset.poFilter;
        renderPurchaseOrderList();
      });
    });

    var s = $('#poSearch');
    if (s) {
      s.addEventListener('input', function () {
        poSearchQuery = s.value.trim();
        renderPurchaseOrderList();
      });
    }
  }

  /* --------------------------------------------------------------------
     Editor
     -------------------------------------------------------------------- */
  function renderPoEditor() {
    if (!poDraft) poDraft = newPoDraft();

    var title = $('#poEdTitle');
    if (title) {
      title.textContent = poViewMode
        ? 'Purchase order ' + (poDraft.poNumber || '')
        : (poDraft.poNumber ? 'Edit purchase order ' + poDraft.poNumber : 'New purchase order');
    }

    var printBtn = $('#poEdPrint');
    if (printBtn) printBtn.onclick = function () { printPurchaseOrderDocument(); };

    var pdfBtn = $('#poEdPdf');
    if (pdfBtn) pdfBtn.onclick = function () { downloadPurchaseOrderPdf(); };

    var delBtn = $('#poEdDelete');
    if (delBtn) {
      delBtn.hidden = !poDraft.id;
      delBtn.onclick = function () {
        confirmDeletePurchaseOrder({
          id: poDraft.id,
          poNumber: poDraft.poNumber,
          supplierName: poDraft.supplierName
        });
      };
    }

    var previewBtn = $('#poEdPreview');
    if (previewBtn) {
      previewBtn.hidden = false;
      previewBtn.textContent = poViewMode ? 'Back to editor' : 'Preview';
      previewBtn.onclick = function () {
        poViewMode = !poViewMode;
        renderPoEditor();
      };
    }

    var saveBtn = $('#poEdSave');
    if (poViewMode) {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<svg><use href="#i-edit"></use></svg>Edit purchase order';
        saveBtn.onclick = function () { poViewMode = false; renderPoEditor(); };
      }
      renderPoDocumentView();
    } else {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<svg><use href="#i-check"></use></svg>' +
          (poDraft.id ? 'Save changes' : 'Save purchase order');
      }
      renderPoEditorForm();
    }
  }

  /** Read-only, full-width document — the "View" flow and the print target. */
  function renderPoDocumentView() {
    var body = $('#poEditorBody');
    if (!body) return;
    body.innerHTML = '<div class="po-doc-container po-doc-standalone">' +
      poDocumentHtml(poDraft) + '</div>';
  }

  function poLineRowHtml(it, idx) {
    return '<tr data-po-line="' + idx + '">' +
      '<td data-label="Code"><input type="text" class="po-in po-f-code" value="' + esc(it.code || '') + '" placeholder="UTL"></td>' +
      '<td data-label="Resin"><input type="text" class="po-in po-f-resin" value="' + esc(it.resin || '') + '" placeholder="HDPE"></td>' +
      '<td data-label="Description"><input type="text" class="po-in po-f-desc" value="' + esc(it.description || '') + '" placeholder="PE100 REPRO" required></td>' +
      '<td data-label="Color"><input type="text" class="po-in po-f-color" value="' + esc(it.color || '') + '" placeholder="Noir"></td>' +
      '<td data-label="Quantity"><input type="number" step="any" min="0" class="po-in num po-f-qty" value="' + esc(it.quantity != null ? it.quantity : '') + '" placeholder="0"></td>' +
      '<td data-label="Unit"><input type="text" class="po-in po-f-unit" value="' + esc(it.unit || '') + '" placeholder="lbs"></td>' +
      '<td data-label="Unit Price"><input type="number" step="0.0001" min="0" class="po-in num po-f-price" value="' + esc(it.unitPrice != null ? it.unitPrice : '') + '" placeholder="0.00"></td>' +
      '<td data-label="Amount" class="num mono po-line-amount">' + esc(poMoney(poLineAmountCents(it.quantity, it.unitPrice))) + '</td>' +
      '<td data-label="" class="po-line-actions">' +
        '<button type="button" class="iconbtn po-line-up" title="Move line up" aria-label="Move line up">&#9650;</button>' +
        '<button type="button" class="iconbtn po-line-down" title="Move line down" aria-label="Move line down">&#9660;</button>' +
        '<button type="button" class="iconbtn po-line-del" title="Remove line" aria-label="Remove line"><svg><use href="#i-trash"></use></svg></button>' +
      '</td>' +
    '</tr>';
  }

  function renderPoEditorForm() {
    var d = poDraft;
    var co = d.companyInfo || poCompanyDefaults();
    var cur = poCurrency(d);

    var html =
      '<div class="po-workspace">' +

        /* ---------------- Editor pane ---------------- */
        '<div class="po-edit-pane">' +

          '<section class="card po-card">' +
            '<h2 class="po-card-title">General</h2>' +
            '<div class="po-grid po-grid-4">' +
              '<div class="field"><label for="poEdNumberField">PO number</label>' +
                '<div class="po-assigned mono" id="poEdNumber">' + esc(poNumberDisplay(d)) + '</div>' +
                '<span class="po-hint">' + (d.poNumber ? 'Assigned — cannot be changed' : 'Assigned by the server on save') + '</span>' +
              '</div>' +
              '<div class="field"><label for="poOrderDate">Order date</label>' +
                '<input type="date" id="poOrderDate" min="2000-01-01" max="2099-12-31" value="' + esc(poFormatDate(d.orderDate)) + '" required></div>' +
              '<div class="field"><label for="poExpectedDate">Expected date</label>' +
                '<input type="date" id="poExpectedDate" min="2000-01-01" max="2099-12-31" value="' + esc(poFormatDate(d.expectedDate)) + '"></div>' +
              '<div class="field"><label for="poCurrencySel">Currency</label>' +
                '<select id="poCurrencySel">' +
                  '<option value="USD"' + (cur === 'USD' ? ' selected' : '') + '>USD</option>' +
                  '<option value="CAD"' + (cur === 'CAD' ? ' selected' : '') + '>CAD</option>' +
                '</select></div>' +
            '</div>' +
            '<div class="po-grid po-grid-2">' +
              '<div class="field"><label for="poStatusSel">Status</label>' +
                '<select id="poStatusSel">' +
                  ['draft', 'issued', 'closed', 'cancelled'].map(function (v) {
                    return '<option value="' + v + '"' + (d.status === v ? ' selected' : '') + '>' +
                      v.charAt(0).toUpperCase() + v.slice(1) + '</option>';
                  }).join('') +
                '</select></div>' +
              '<div class="field"><label for="poFooterDate">Signature date <span class="po-hint-inline">(the &ldquo;Date:&rdquo; line on the document)</span></label>' +
                '<input type="date" id="poFooterDate" min="2000-01-01" max="2099-12-31" value="' + esc(poFormatDate(d.footerDate)) + '"></div>' +
            '</div>' +
          '</section>' +

          '<section class="card po-card">' +
            '<h2 class="po-card-title">Supplier</h2>' +
            '<div class="po-grid po-grid-2">' +
              '<div class="field po-span-2"><label for="poSupName">Supplier name <span class="po-req">*</span></label>' +
                '<input type="text" id="poSupName" value="' + esc(d.supplierName) + '" placeholder="Greenwave Recycling" required></div>' +
              '<div class="field po-span-2"><label for="poSupAddress">Address</label>' +
                '<input type="text" id="poSupAddress" value="' + esc(d.supplierAddress) + '" placeholder="23394, Fisherman Rd"></div>' +
              '<div class="field"><label for="poSupCity">City</label>' +
                '<input type="text" id="poSupCity" value="' + esc(d.supplierCity) + '" placeholder="Maple Ridge"></div>' +
              '<div class="field"><label for="poSupProvince">Province / State</label>' +
                '<input type="text" id="poSupProvince" value="' + esc(d.supplierProvince) + '" placeholder="BC"></div>' +
              '<div class="field"><label for="poSupPostal">Postal / ZIP</label>' +
                '<input type="text" id="poSupPostal" value="' + esc(d.supplierPostalCode) + '" placeholder="V3W 1B9"></div>' +
              '<div class="field"><label for="poSupCountry">Country</label>' +
                '<input type="text" id="poSupCountry" value="' + esc(d.supplierCountry) + '" placeholder="CANADA"></div>' +
              '<div class="field"><label for="poSupPhone">Telephone</label>' +
                '<input type="text" id="poSupPhone" value="' + esc(d.supplierPhone) + '" placeholder="1-672-472-0423"></div>' +
              '<div class="field"><label for="poSupEmail">Email</label>' +
                '<input type="email" id="poSupEmail" value="' + esc(d.supplierEmail) + '" placeholder="sales@greenwaverecycling.ca"></div>' +
            '</div>' +
          '</section>' +

          '<section class="card po-card">' +
            '<div class="po-card-head">' +
              '<h2 class="po-card-title">Line items</h2>' +
              '<button type="button" class="btn ghost btn-sm" id="poAddLine"><svg><use href="#i-plus"></use></svg>Add item</button>' +
            '</div>' +
            '<div class="tablewrap po-items-wrap" tabindex="0" role="region" aria-label="Line items">' +
              '<table class="table po-items-table stack-mobile" id="poItemsTable"><thead><tr>' +
                '<th style="width:8.5%">Code</th>' +
                '<th style="width:8.5%">Resin</th>' +
                '<th style="width:27%">Description</th>' +
                '<th style="width:8.5%">Color</th>' +
                '<th class="num" style="width:11%">Quantity</th>' +
                '<th style="width:6.5%">Unit</th>' +
                '<th class="num" style="width:12%">Unit Price (<span class="po-cur-label">' + esc(cur) + '</span>)</th>' +
                '<th class="num" style="width:12%">Amount (<span class="po-cur-label">' + esc(cur) + '</span>)</th>' +
                '<th style="width:6%"></th>' +
              '</tr></thead><tbody id="poLinesWrap">' +
                d.items.map(poLineRowHtml).join('') +
              '</tbody></table>' +
            '</div>' +
            '<p class="po-items-hint noprint">Amounts update automatically as you edit quantities and prices.</p>' +
          '</section>' +

          '<section class="card po-card">' +
            '<h2 class="po-card-title">Letterhead &amp; notes</h2>' +
            '<div class="po-grid po-grid-2">' +
              '<div class="field po-span-2"><label for="poCoName">Company name</label>' +
                '<input type="text" id="poCoName" value="' + esc(co.name) + '"></div>' +
              '<div class="field"><label for="poCoLine1">Address line 1</label>' +
                '<input type="text" id="poCoLine1" value="' + esc(co.line1) + '"></div>' +
              '<div class="field"><label for="poCoLine2">Address line 2</label>' +
                '<input type="text" id="poCoLine2" value="' + esc(co.line2) + '"></div>' +
              '<div class="field"><label for="poCoPhone">Telephone</label>' +
                '<input type="text" id="poCoPhone" value="' + esc(co.phone) + '"></div>' +
              '<div class="field"><label for="poCoEmail">Email</label>' +
                '<input type="text" id="poCoEmail" value="' + esc(co.email) + '"></div>' +
              '<div class="field po-span-2"><label for="poNotes">Notes (optional)</label>' +
                '<textarea id="poNotes" rows="2" placeholder="Anything the supplier should see on the document">' + esc(d.notes) + '</textarea></div>' +
            '</div>' +
          '</section>' +

          '<section class="card po-card po-summary-card">' +
            '<div class="po-summary-row"><span>Line items</span><span class="mono" id="poSumCount">' + d.items.length + '</span></div>' +
            '<div class="po-summary-row po-summary-total">' +
              '<span>TOTAL</span>' +
              '<span class="mono"><span id="poSumTotal">' + esc(poMoney(poTotalCents(d.items))) + '</span> <span class="po-cur-label">' + esc(cur) + '</span></span>' +
            '</div>' +
            '<p class="po-summary-note">Amounts are recalculated by the server when you save — this figure is a preview of that calculation.</p>' +
          '</section>' +

        '</div>' +

        /* ---------------- Preview pane (right) ---------------- */
        '<aside class="po-preview-pane" aria-label="Purchase order preview">' +
          '<div class="po-preview-label">Live document preview</div>' +
          '<div class="po-doc-container" id="poPreview">' + poDocumentHtml(d) + '</div>' +
        '</aside>' +

      '</div>';

    var body = $('#poEditorBody');
    if (!body) return;
    body.innerHTML = html;

    /* ---- Read the form back into the draft, recompute, repaint preview ---- */
    function val(id) { var el = $(id); return el ? el.value : ''; }

    function syncPoDraft() {
      d.orderDate = poFormatDate(val('#poOrderDate')) || val('#poOrderDate');
      d.expectedDate = poFormatDate(val('#poExpectedDate'));
      d.currency = val('#poCurrencySel') === 'CAD' ? 'CAD' : 'USD';
      d.status = val('#poStatusSel') || 'draft';
      d.footerDate = poFormatDate(val('#poFooterDate'));

      d.supplierName = val('#poSupName');
      d.supplierAddress = val('#poSupAddress');
      d.supplierCity = val('#poSupCity');
      d.supplierProvince = val('#poSupProvince');
      d.supplierPostalCode = val('#poSupPostal');
      d.supplierCountry = val('#poSupCountry');
      d.supplierPhone = val('#poSupPhone');
      d.supplierEmail = val('#poSupEmail');

      d.companyInfo = {
        name: val('#poCoName'), line1: val('#poCoLine1'), line2: val('#poCoLine2'),
        phone: val('#poCoPhone'), email: val('#poCoEmail')
      };
      d.notes = val('#poNotes');

      $$('#poLinesWrap tr').forEach(function (row) {
        var i = Number(row.dataset.poLine);
        var it = d.items[i];
        if (!it) return;
        function cell(sel) { var e = row.querySelector(sel); return e ? e.value : ''; }
        it.code = cell('.po-f-code');
        it.resin = cell('.po-f-resin');
        it.description = cell('.po-f-desc');
        it.color = cell('.po-f-color');
        it.quantity = parseQty(cell('.po-f-qty'));
        it.unit = cell('.po-f-unit');
        it.unitPrice = parseQty(cell('.po-f-price'));

        var amt = row.querySelector('.po-line-amount');
        if (amt) amt.textContent = poMoney(poLineAmountCents(it.quantity, it.unitPrice));
      });

      var cur2 = poCurrency(d);
      $$('.po-cur-label').forEach(function (e) { e.textContent = cur2; });
      var totEl = $('#poSumTotal');
      if (totEl) totEl.textContent = poMoney(poTotalCents(d.items));
      var cntEl = $('#poSumCount');
      if (cntEl) cntEl.textContent = String(d.items.length);

      var preview = $('#poPreview');
      if (preview) preview.innerHTML = poDocumentHtml(d);
    }

    $$('#poEditorBody input, #poEditorBody textarea, #poEditorBody select').forEach(function (inp) {
      inp.addEventListener('input', syncPoDraft);
      inp.addEventListener('change', syncPoDraft);
    });

    var addBtn = $('#poAddLine');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        syncPoDraft();
        d.items.push(blankPoLine());
        renderPoEditor();
        // Put the cursor straight into the new row's first field.
        var rows = $$('#poLinesWrap tr');
        var last = rows[rows.length - 1];
        if (last) { var f = last.querySelector('.po-f-code'); if (f) f.focus(); }
      });
    }

    function lineIndexOf(btn) {
      var row = btn.closest('tr');
      return row ? Number(row.dataset.poLine) : -1;
    }

    $$('.po-line-del').forEach(function (b) {
      b.addEventListener('click', function () {
        syncPoDraft();
        var i = lineIndexOf(b);
        if (i < 0) return;
        d.items.splice(i, 1);
        // A purchase order always has at least one row to type into; the
        // backend separately rejects a submission with no items.
        if (!d.items.length) d.items.push(blankPoLine());
        renderPoEditor();
      });
    });

    function moveLine(from, to) {
      if (to < 0 || to >= d.items.length) return;
      var moved = d.items.splice(from, 1)[0];
      d.items.splice(to, 0, moved);
      renderPoEditor();
    }
    $$('.po-line-up').forEach(function (b) {
      b.addEventListener('click', function () { syncPoDraft(); var i = lineIndexOf(b); if (i > 0) moveLine(i, i - 1); });
    });
    $$('.po-line-down').forEach(function (b) {
      b.addEventListener('click', function () { syncPoDraft(); var i = lineIndexOf(b); if (i >= 0) moveLine(i, i + 1); });
    });

    /* ---- Save ---- */
    var saveBtn = $('#poEdSave');
    if (saveBtn) {
      saveBtn.onclick = function () {
        syncPoDraft();

        var problem = validatePoDraft(d);
        if (problem) { toast(problem); return; }

        var payload = {
          orderDate: d.orderDate,
          currency: poCurrency(d),
          supplierName: d.supplierName.trim(),
          supplierAddress: d.supplierAddress || undefined,
          supplierCity: d.supplierCity || undefined,
          supplierProvince: d.supplierProvince || undefined,
          supplierPostalCode: d.supplierPostalCode || undefined,
          supplierCountry: d.supplierCountry || undefined,
          supplierPhone: d.supplierPhone || undefined,
          supplierEmail: d.supplierEmail || undefined,
          companyInfo: d.companyInfo,
          notes: d.notes || undefined,
          status: d.status || 'draft',
          // Scoping only, exactly as invoices do it — it has no bearing on the
          // PO number, which is a single global server-side sequence.
          division: apiDivisionKey(entity),
          items: d.items.map(function (it) {
            return {
              code: it.code || undefined,
              resin: it.resin || undefined,
              description: it.description,
              color: it.color || undefined,
              quantity: Number(it.quantity),
              unit: it.unit || undefined,
              unitPrice: Number(it.unitPrice)
              // No `amount`: the server computes it and rejects a supplied one.
            };
          })
        };
        // Optional dates are sent as null rather than "" (which is not a valid
        // ISO date) and rather than being omitted — omitting them would make it
        // impossible to *clear* a date that had previously been set, since the
        // API treats an absent field as "leave unchanged".
        payload.expectedDate = d.expectedDate || null;
        payload.footerDate = d.footerDate || null;
        if (d.warehouseId) payload.warehouseId = d.warehouseId;

        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';
        function reset() {
          saveBtn.disabled = false;
          saveBtn.innerHTML = '<svg><use href="#i-check"></use></svg>' +
            (d.id ? 'Save changes' : 'Save purchase order');
        }

        var req = d.id ? Api.updatePurchaseOrder(d.id, payload)
                       : Api.createPurchaseOrder(payload);
        req.then(function (saved) {
          reset();
          toast('Purchase order ' + saved.poNumber + ' saved.');
          // Re-seed from the server's response so the number, the recalculated
          // amounts and the total on screen are the stored ones, not ours.
          poDraft = poToDraft(saved);
          poViewMode = true;
          nextPoNumberHint = null;
          renderPoEditor();
          refreshNextPoNumber();
        }).catch(function (err) {
          reset();
          toast(poErrorMessage(err));
        });
      };
    }
  }

  /**
   * Client-side validation. A convenience that catches mistakes before a round
   * trip -- the backend independently re-validates all of it, and is the only
   * thing that actually decides whether a purchase order is acceptable.
   */
  function validatePoDraft(d) {
    if (!d.orderDate) return 'Please choose an order date.';
    if (d.expectedDate && d.expectedDate < d.orderDate) {
      return 'The expected date cannot be before the order date.';
    }
    if (!d.supplierName || !d.supplierName.trim()) return 'Please enter a supplier name.';
    if (d.supplierEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.supplierEmail)) {
      return 'Please enter a valid supplier email address.';
    }
    if (['USD', 'CAD'].indexOf(poCurrency(d)) < 0) return 'Please choose a currency.';

    var usable = d.items.filter(function (it) {
      return (it.description && it.description.trim()) || Number(it.quantity) > 0;
    });
    if (!usable.length) return 'Add at least one line item.';

    for (var i = 0; i < d.items.length; i++) {
      var it = d.items[i];
      var n = i + 1;
      if (!it.description || !it.description.trim()) return 'Line ' + n + ' needs a description.';
      if (!(Number(it.quantity) > 0)) return 'Line ' + n + ': quantity must be greater than 0.';
      if (Number(it.unitPrice) < 0) return 'Line ' + n + ': unit price cannot be negative.';
    }
    return null;
  }

  /** Turns an API failure into something an administrator can act on. */
  function poErrorMessage(err) {
    if (!err) return 'Could not save the purchase order.';
    if (err.status === 403) return 'Only administrators can manage purchase orders.';
    if (err.status === 401) return 'Your session has expired. Please sign in again.';
    if (err.status === 0) return err.message;
    // Nest returns `message` as an array for validation failures.
    var body = err.body;
    if (body && Array.isArray(body.message) && body.message.length) {
      return String(body.message[0]);
    }
    return err.message || 'Could not save the purchase order.';
  }

  /* ==========================================================================
     PROFORMA INVOICES (GREENWAVE RECYCLING DIVISION ONLY)

     Non-accounting quotations & preliminary sales estimates.
     - Dedicated numbering sequence: PF-0001, PF-0002...
     - Complete isolation: 0 payments, 0 journal entries, 0 AR postings.
     - Transactional conversion to final real invoice with audit tracking.
     - Responsive list view & editor with Incoterms and weights.
     ========================================================================== */

  var proformaDraft = null;
  var proformaFilter = 'all';
  var proformaSearchQuery = '';
  var proformaListCache = [];
  var proformaDirty = false;
  var proformaFiltersBound = false;
  var proformaCustomersCache = null;

  var INCOTERM_OPTIONS = [
    'FOB', 'CIF', 'CFR', 'EXW', 'DAP', 'DDP', 'FCA', 'CPT', 'CIP'
  ];
  var PF_CURRENCIES = ['CAD', 'USD'];
  var PF_WEIGHT_UNITS = ['kg', 'lb', 't'];
  var PF_DEFAULT_TERMS = 'Commercial proforma estimate. This is not a tax invoice or demand for payment.';

  /* Status vocabulary. Every chip carries its word, never colour alone. */
  var PF_STATUS = {
    draft:     { label: 'Draft',     cls: 'pf-st-draft' },
    sent:      { label: 'Sent',      cls: 'pf-st-sent' },
    accepted:  { label: 'Accepted',  cls: 'pf-st-accepted' },
    expired:   { label: 'Expired',   cls: 'pf-st-expired' },
    converted: { label: 'Converted', cls: 'pf-st-converted' },
    cancelled: { label: 'Cancelled', cls: 'pf-st-cancelled' }
  };

  function pfStatusChip(status) {
    var st = PF_STATUS[(status || 'draft').toLowerCase()] || PF_STATUS.draft;
    return '<span class="badge pf-st ' + st.cls + '">' + esc(st.label) + '</span>';
  }

  function pfRound(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  function pfMoney(amount, currency) {
    return (currency || 'CAD') + ' ' + (Number(amount) || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function pfWeight(value, unit) {
    var n = Number(value);
    if (!value || !isFinite(n) || n <= 0) return '—';
    return n.toLocaleString('en-CA', { maximumFractionDigits: 3 }) + ' ' + (unit || 'kg');
  }

  /* Editable until it has become a real invoice or been withdrawn. The API
     enforces the same rule (converted/cancelled are read-only). */
  function pfIsEditable(status) { return status !== 'converted' && status !== 'cancelled'; }
  /* Mirrors ProformasService.convert(): draft, sent and accepted only. */
  function pfIsConvertible(status) { return status === 'draft' || status === 'sent' || status === 'accepted'; }

  function blankProformaLine() {
    return {
      description: '',
      quantity: 1,
      unit: 'kg',
      unitPrice: 0,
      discount: 0,
      taxRate: 0,
      weight: null
    };
  }

  function newProformaDraft() {
    return {
      customerId: '',
      customerName: '',
      warehouseId: warehouseId || '',
      issueDate: today(),
      validityDate: '',
      currency: 'CAD',
      poReference: '',
      billTo: '',
      shipTo: '',
      origin: '',
      destination: '',
      incoterm: 'FOB',
      incotermLocation: '',
      shippingTerms: '',
      notes: '',
      commercialTerms: PF_DEFAULT_TERMS,
      weightUnit: 'kg',
      status: 'draft',
      items: [blankProformaLine()]
    };
  }

  function proformaToDraft(p) {
    if (!p) return null;
    return {
      id: p.id,
      proformaNumber: p.proformaNumber,
      customerId: p.customerId || '',
      customerName: p.customerName || '',
      warehouseId: p.warehouseId || '',
      issueDate: p.issueDate || today(),
      validityDate: p.validityDate || '',
      currency: p.currency || 'CAD',
      poReference: p.poReference || '',
      billTo: p.billTo || '',
      shipTo: p.shipTo || '',
      origin: p.origin || '',
      destination: p.destination || '',
      incoterm: p.incoterm || '',
      incotermLocation: p.incotermLocation || '',
      shippingTerms: p.shippingTerms || '',
      notes: p.notes || '',
      commercialTerms: p.commercialTerms || '',
      status: p.status || 'draft',
      convertedInvoiceId: p.convertedInvoiceId || null,
      convertedAt: p.convertedAt || null,
      subtotal: p.subtotal != null ? Number(p.subtotal) : 0,
      taxTotal: p.taxTotal != null ? Number(p.taxTotal) : 0,
      total: p.total != null ? Number(p.total) : 0,
      totalWeight: p.totalWeight != null ? Number(p.totalWeight) : 0,
      weightUnit: p.weightUnit || 'kg',
      items: (p.items && p.items.length) ? p.items.map(function (it) {
        return {
          id: it.id,
          materialId: it.materialId || null,
          description: it.description || '',
          quantity: Number(it.quantity) || 0,
          unit: it.unit || 'kg',
          unitPrice: Number(it.unitPrice) || 0,
          discount: Number(it.discount) || 0,
          // A saved 0% rate is a real value -- never substitute a default.
          taxRate: it.taxRate != null && it.taxRate !== '' ? Number(it.taxRate) : 0,
          total: Number(it.total) || 0,
          weight: it.weight != null && it.weight !== '' ? Number(it.weight) : null
        };
      }) : [blankProformaLine()]
    };
  }

  /* Same arithmetic as ProformasService (per-line rounding), so the live
     preview matches the saved document to the cent. */
  function pfLineCalc(it) {
    var sub = pfRound((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0) - (Number(it.discount) || 0));
    var tax = pfRound(sub * ((Number(it.taxRate) || 0) / 100));
    return { sub: sub, tax: tax, total: pfRound(sub + tax) };
  }

  function pfTotals(items) {
    var t = { subtotal: 0, tax: 0, total: 0, weight: 0, rates: {} };
    (items || []).forEach(function (it) {
      var c = pfLineCalc(it);
      t.subtotal = pfRound(t.subtotal + c.sub);
      t.tax = pfRound(t.tax + c.tax);
      if (it.weight) t.weight += Number(it.weight) || 0;
      if (it.description) t.rates[String(Number(it.taxRate) || 0)] = true;
    });
    t.total = pfRound(t.subtotal + t.tax);
    t.mixedRates = Object.keys(t.rates).length > 1;
    return t;
  }

  function downloadProformaPdf(id, number) {
    toast('Preparing ' + (number || 'proforma') + ' PDF…');
    return Api.downloadProformaPdf(id).then(function (blob) {
      var url = window.URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = (number || 'proforma') + '.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { window.URL.revokeObjectURL(url); }, 1000);
    }).catch(function (err) {
      toast('Could not generate the PDF: ' + (err.message || err));
    });
  }

  function openFinalInvoice(invoiceId) {
    if (!invoiceId) return;
    Api.getInvoice(invoiceId).then(function (inv) {
      draft = invoiceToDraft(inv);
      editorViewMode = true;
      show('editor');
    }).catch(function (err) {
      toast('Could not open the invoice: ' + (err.message || err));
    });
  }

  function openSendProformaModal(pf, onSent) {
    var email = (pf && pf.customer && pf.customer.email) || (pf && pf.customerEmail) || '';
    openModal('Email ' + (pf.proformaNumber || 'proforma'),
      '<p class="pf-modal-note">The PDF is attached. The email states that this is a proforma and not a demand for payment. It contains no payment link.</p>' +
      field('email', 'Recipient email', { type: 'email', required: true, value: email, placeholder: 'purchasing@customer.com', autocomplete: 'email' }),
      function (fd) {
        return Api.sendProforma(pf.id, { email: fd.email }).then(function (res) {
          if (res && res.sent === false) {
            // The API answers 200 with sent:false when no mail transport is
            // configured -- that must not read as success.
            throw new Error('Email was not sent' + (res.note ? ': ' + res.note : '. Email delivery is not configured.'));
          }
          toast(pf.proformaNumber + ' emailed to ' + fd.email + '.');
          if (onSent) onSent();
        });
      },
      { okLabel: 'Send email', savingLabel: 'Sending…' }
    );
  }

  function confirmCancelProforma(pf, onDone) {
    openModal('Cancel ' + pf.proformaNumber + '?',
      '<div class="delete-confirm">' +
        '<p class="delete-confirm-lead">' + esc(pf.proformaNumber) + ' will be marked <strong>Cancelled</strong>.</p>' +
        '<p class="pf-modal-note">It stays on record for reference but can no longer be edited, sent or converted. No accounting entries exist for a proforma, so nothing else changes.</p>' +
      '</div>',
      function () {
        return Api.updateProforma(pf.id, { status: 'cancelled' }).then(function (res) {
          toast(pf.proformaNumber + ' cancelled.');
          if (onDone) onDone(res);
        });
      },
      { okLabel: 'Cancel proforma', okClass: 'danger', cancelLabel: 'Keep it', savingLabel: 'Cancelling…' }
    );
  }

  function setProformaStatus(pf, status, onDone) {
    return Api.updateProforma(pf.id, { status: status }).then(function (res) {
      toast(pf.proformaNumber + ' marked ' + PF_STATUS[status].label.toLowerCase() + '.');
      if (onDone) onDone(res);
    }).catch(function (err) {
      toast('Could not update status: ' + (err.message || err));
    });
  }

  /* Conversion creates a real, numbered invoice with a receivable, so it is
     confirmed with a plain statement of what happens -- and afterwards the
     proforma is shown in its converted, read-only state with a direct link
     to the new invoice. */
  function confirmConvertProforma(pf, onDone) {
    var totals = pfTotals(pf.items || []);
    var mixed = totals.mixedRates;
    var bodyHtml =
      '<div class="pf-convert">' +
        '<div class="pf-convert-sum">' +
          '<div><span>Proforma</span><strong class="mono">' + esc(pf.proformaNumber) + '</strong></div>' +
          '<div><span>Customer</span><strong>' + esc(pf.customerName || '—') + '</strong></div>' +
          '<div><span>Invoice total</span><strong class="mono">' + esc(pfMoney(pf.total, pf.currency)) + '</strong></div>' +
        '</div>' +
        '<p class="pf-modal-note">Converting will:</p>' +
        '<ul class="pf-convert-list">' +
          '<li>Create a <strong>final invoice</strong> with the next invoice number, dated today.</li>' +
          '<li>Enter it into normal accounting and create an <strong>Accounts Receivable</strong> balance for the customer.</li>' +
          '<li>Mark ' + esc(pf.proformaNumber) + ' as <strong>Converted</strong> and link it to the invoice. The proforma becomes read-only.</li>' +
        '</ul>' +
        '<p class="pf-modal-note">A proforma can be converted only once. Any later change is made on the invoice itself.</p>' +
        (mixed ? '<p class="pf-convert-warn" role="alert">These items use different tax rates. Conversion needs a single rate — edit the items first.</p>' : '') +
      '</div>';

    openModal('Convert to final invoice', bodyHtml, function () {
      if (mixed) return Promise.reject(new Error('Use a single tax rate on all items before converting.'));
      return Api.convertProforma(pf.id).then(function (res) {
        var invNo = res && res.invoice ? res.invoice.invoiceNumber : null;
        toast(pf.proformaNumber + ' converted' + (invNo ? ' to invoice #' + invNo : '') + '.');
        if (onDone) onDone(res);
      });
    }, { okLabel: 'Create final invoice', okClass: 'btn-primary', cancelLabel: 'Not now', savingLabel: 'Converting…' });

    // Nothing to focus in a confirmation body; start on the safe choice.
    var cancelBtn = $('#modalCancel'); if (cancelBtn) cancelBtn.focus();
    var okBtn = $('#modalOk'); if (okBtn && mixed) okBtn.disabled = true;
  }

  /* Which actions a proforma offers, by status and role. The list, the card
     menu and the editor header all read from this one table. */
  function proformaActions(pf) {
    var st = (pf.status || 'draft').toLowerCase();
    var manage = isAdminOrManager();
    var acts = [];
    acts.push({ key: 'open', label: pfIsEditable(st) && manage ? 'Edit' : 'View', icon: pfIsEditable(st) && manage ? 'edit' : 'doc' });
    if (st === 'converted' && pf.convertedInvoiceId) acts.push({ key: 'invoice', label: 'Open final invoice', icon: 'doc' });
    acts.push({ key: 'pdf', label: 'Download PDF', icon: 'download' });
    if (manage && (st === 'draft' || st === 'sent' || st === 'accepted')) acts.push({ key: 'send', label: 'Email to customer', icon: 'send' });
    if (manage && (st === 'draft' || st === 'sent')) acts.push({ key: 'accept', label: 'Mark accepted', icon: 'check' });
    if (manage && st === 'expired') acts.push({ key: 'reopen', label: 'Reopen as draft', icon: 'edit' });
    if (manage && pfIsConvertible(st)) acts.push({ key: 'convert', label: 'Convert to final invoice…', icon: 'check', divider: true });
    if (manage && pfIsEditable(st)) acts.push({ key: 'cancel', label: 'Cancel proforma…', icon: 'trash', danger: true });
    return acts;
  }

  function pfMenuHtml(pf, acts, extraClass) {
    var items = acts.filter(function (a) { return a.key !== 'open'; });
    if (!items.length) return '';
    return '<details class="row-menu ' + (extraClass || '') + '">' +
      '<summary class="btn ghost btn-sm" aria-label="More actions for ' + esc(pf.proformaNumber) + '">' +
        '<svg><use href="#i-more"></use></svg><span class="row-menu-text">More</span></summary>' +
      '<div class="row-menu-pop" role="menu">' +
        items.map(function (a) {
          return (a.divider ? '<hr>' : '') +
            '<button type="button" role="menuitem" class="' + (a.danger ? 'is-danger' : '') + '" data-pf-act="' + a.key + '" data-pf-id="' + esc(pf.id) + '">' +
              '<svg><use href="#i-' + a.icon + '"></use></svg>' + esc(a.label) + '</button>';
        }).join('') +
      '</div></details>';
  }

  function runProformaAction(key, id) {
    var pf = proformaListCache.filter(function (x) { return x.id === id; })[0];
    if (!pf && proformaDraft && proformaDraft.id === id) pf = proformaDraft;
    if (!pf) return;
    var refresh = function () { if (view === 'proformas') renderProformaList(); };
    if (key === 'open') {
      Api.getProforma(id).then(function (full) {
        proformaDraft = proformaToDraft(full);
        proformaDirty = false;
        show('proformaeditor');
      }).catch(function (err) { toast('Could not open proforma: ' + (err.message || err)); });
    } else if (key === 'pdf') downloadProformaPdf(pf.id, pf.proformaNumber);
    else if (key === 'invoice') openFinalInvoice(pf.convertedInvoiceId);
    else if (key === 'send') openSendProformaModal(pf, refresh);
    else if (key === 'accept') setProformaStatus(pf, 'accepted', refresh);
    else if (key === 'reopen') setProformaStatus(pf, 'draft', refresh);
    else if (key === 'cancel') confirmCancelProforma(pf, refresh);
    else if (key === 'convert') {
      // After converting, land on the proforma in its converted state, which
      // carries the "Open final invoice" action.
      confirmConvertProforma(pf, function () {
        return Api.getProforma(pf.id).then(function (full) {
          proformaDraft = proformaToDraft(full);
          proformaDirty = false;
          show('proformaeditor');
        });
      });
    }
  }

  /* Closes any other open row menu, and any menu on an outside click, so
     at most one popover is ever open. Bound once. */
  document.addEventListener('click', function (e) {
    var inside = e.target.closest ? e.target.closest('details.row-menu') : null;
    $$('details.row-menu[open]').forEach(function (d) { if (d !== inside) d.removeAttribute('open'); });
  });
  /* The popover is positioned against the viewport so no scrolling table
     wrapper can clip it; it opens upward when there is no room below. */
  document.addEventListener('toggle', function (e) {
    var d = e.target;
    if (!d || !d.classList || !d.classList.contains('row-menu') || !d.open) return;
    var pop = d.querySelector('.row-menu-pop');
    var sum = d.querySelector('summary');
    if (!pop || !sum) return;
    var r = sum.getBoundingClientRect();
    pop.style.position = 'fixed';
    pop.style.left = 'auto';
    pop.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
    pop.style.top = 'auto';
    pop.style.bottom = 'auto';
    var h = pop.offsetHeight;
    if (r.bottom + 6 + h > window.innerHeight - 8 && r.top - 6 - h > 8) {
      pop.style.bottom = (window.innerHeight - r.top + 6) + 'px';
    } else {
      pop.style.top = (r.bottom + 6) + 'px';
    }
    var first = pop.querySelector('button'); if (first) first.focus({ preventScroll: true });
  }, true);
  /* A fixed popover would float away from its row on scroll; close instead. */
  document.addEventListener('scroll', function () {
    $$('details.row-menu[open]').forEach(function (d) { d.removeAttribute('open'); });
  }, true);
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    $$('details.row-menu[open]').forEach(function (d) {
      d.removeAttribute('open');
      var s = d.querySelector('summary'); if (s) s.focus();
    });
  });

  function setupProformaFilters() {
    if (proformaFiltersBound) return;
    proformaFiltersBound = true;
    $$('#proformaFilterTabs [data-pf-filter]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('#proformaFilterTabs [data-pf-filter]').forEach(function (b) {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        proformaFilter = btn.dataset.pfFilter;
        paintProformaList();
      });
    });

    var s = $('#proformaSearch');
    if (s) {
      s.addEventListener('input', function () {
        proformaSearchQuery = s.value.trim().toLowerCase();
        paintProformaList();
      });
    }

    var newBtn = $('#newProforma');
    if (newBtn) {
      newBtn.onclick = function () {
        proformaDraft = newProformaDraft();
        proformaDirty = false;
        show('proformaeditor');
      };
    }

    var host = $('#proformaList');
    if (host) {
      host.addEventListener('click', function (e) {
        var actBtn = e.target.closest('[data-pf-act]');
        if (actBtn) {
          e.stopPropagation();
          var menu = actBtn.closest('details.row-menu'); if (menu) menu.removeAttribute('open');
          runProformaAction(actBtn.dataset.pfAct, actBtn.dataset.pfId);
          return;
        }
        if (e.target.closest('details.row-menu, a, button, summary')) return;
        var card = e.target.closest('[data-pf-row]');
        if (card) runProformaAction('open', card.dataset.pfRow);
      });
    }
  }

  function renderProformaList() {
    setupProformaFilters();
    if (!proformaListCache.length) loadingState('#proformaList');
    Api.listProformas().then(function (list) {
      proformaListCache = list || [];
      paintProformaList();
    }).catch(function (err) {
      apiErrorState('#proformaList', err);
    });
  }

  function paintProformaList() {
    var cList = $('#proformaList');
    if (!cList) return;
    var rows = proformaListCache.slice();

    if (proformaFilter && proformaFilter !== 'all') {
      rows = rows.filter(function (p) { return (p.status || '').toLowerCase() === proformaFilter; });
    }
    if (proformaSearchQuery) {
      var q = proformaSearchQuery;
      rows = rows.filter(function (p) {
        return [p.proformaNumber, p.customerName, p.poReference, p.incoterm, p.destination].some(function (v) {
          return (v || '').toLowerCase().indexOf(q) >= 0;
        });
      });
    }

    if (!rows.length) {
      var filtered = proformaListCache.length > 0;
      cList.innerHTML = filtered
        ? emptyState('search', 'No proformas match', 'Try another status tab or search term.')
        : emptyState('doc', 'No proforma invoices yet',
            'Quote a customer, freight forwarder or customs broker before invoicing. Proformas never touch accounting.',
            isAdminOrManager() ? 'New proforma' : null, 'newProformaEmpty');
      var emptyBtn = cList.querySelector('[data-action="newProformaEmpty"]');
      if (emptyBtn) emptyBtn.onclick = function () { var b = $('#newProforma'); if (b) b.click(); };
      return;
    }

    var tableRows = rows.map(function (pf) {
      var acts = proformaActions(pf);
      var inco = pf.incoterm ? pf.incoterm + (pf.incotermLocation ? ' · ' + pf.incotermLocation : '') : '—';
      return '<tr class="clickable-row" data-pf-row="' + esc(pf.id) + '">' +
        '<td><strong class="mono">' + esc(pf.proformaNumber) + '</strong>' +
          (pf.poReference ? '<div class="pf-sub">Ref ' + esc(pf.poReference) + '</div>' : '') + '</td>' +
        '<td class="pf-cust"><strong>' + esc(pf.customerName || '—') + '</strong>' +
          (pf.destination ? '<div class="pf-sub">To ' + esc(pf.destination) + '</div>' : '') + '</td>' +
        '<td class="pf-dates"><span class="mono">' + esc(pf.issueDate || '—') + '</span>' +
          '<div class="pf-sub">' + (pf.validityDate ? 'Valid to <span class="mono">' + esc(pf.validityDate) + '</span>' : 'No expiry') + '</div></td>' +
        '<td>' + esc(inco) + '</td>' +
        '<td class="num mono">' + esc(pfWeight(pf.totalWeight, pf.weightUnit)) + '</td>' +
        '<td class="num mono"><strong>' + esc(pfMoney(pf.total, pf.currency)) + '</strong></td>' +
        '<td>' + pfStatusChip(pf.status) + '</td>' +
        '<td class="pf-actions-cell"><div class="pf-row-actions">' +
          '<button type="button" class="btn ghost btn-sm" data-pf-act="open" data-pf-id="' + esc(pf.id) + '">' + esc(acts[0].label) + '</button>' +
          pfMenuHtml(pf, acts) +
        '</div></td>' +
      '</tr>';
    }).join('');

    /* Phones get purpose-built cards instead of the generic stacked table:
       number and status on top, customer, then the two figures that matter
       (value and weight), then one line of shipping context. */
    var cards = rows.map(function (pf) {
      var acts = proformaActions(pf);
      var meta = ['Issued ' + (pf.issueDate || '—')];
      if (pf.validityDate) meta.push('Valid to ' + pf.validityDate);
      if (pf.incoterm) meta.push(pf.incoterm + (pf.incotermLocation ? ' ' + pf.incotermLocation : ''));
      return '<article class="pf-card" data-pf-row="' + esc(pf.id) + '">' +
        '<div class="pf-card-top"><strong class="mono">' + esc(pf.proformaNumber) + '</strong>' + pfStatusChip(pf.status) + '</div>' +
        '<div class="pf-card-cust">' + esc(pf.customerName || 'No customer') + '</div>' +
        '<div class="pf-card-figs"><span class="mono pf-card-total">' + esc(pfMoney(pf.total, pf.currency)) + '</span>' +
          '<span class="mono pf-card-weight">' + esc(pfWeight(pf.totalWeight, pf.weightUnit)) + '</span></div>' +
        '<div class="pf-card-meta">' + esc(meta.join(' · ')) + '</div>' +
        '<div class="pf-card-actions">' +
          '<button type="button" class="btn ghost btn-sm" data-pf-act="open" data-pf-id="' + esc(pf.id) + '">' + esc(acts[0].label) + '</button>' +
          pfMenuHtml(pf, acts, 'row-menu-up') +
        '</div>' +
      '</article>';
    }).join('');

    cList.innerHTML =
      '<div class="card pf-table-card"><div class="tablewrap"><table class="table no-stack pf-table" aria-label="Proforma invoices">' +
        '<thead><tr><th>Proforma #</th><th>Customer</th><th>Issued / validity</th><th>Incoterm</th>' +
        '<th class="num">Weight</th><th class="num">Est. total</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>' +
        '<tbody>' + tableRows + '</tbody></table></div></div>' +
      '<div class="pf-cards">' + cards + '</div>';
  }

  function pfField(id, label, control, cls) {
    return '<div class="field ' + (cls || '') + '"><label for="' + id + '">' + label + '</label>' + control + '</div>';
  }

  function renderProformaEditor() {
    var body = $('#proformaEditorBody');
    if (!body) return;
    if (!proformaDraft) { proformaDraft = newProformaDraft(); proformaDirty = false; }

    var d = proformaDraft;
    var st = (d.status || 'draft').toLowerCase();
    var manage = isAdminOrManager();
    var ro = !pfIsEditable(st) || !manage;
    var dis = ro ? ' disabled' : '';

    var titleEl = $('#pfEdTitle');
    if (titleEl) titleEl.innerHTML = (d.proformaNumber ? 'Proforma ' + esc(d.proformaNumber) : 'New proforma invoice') +
      (d.id ? ' ' + pfStatusChip(st) : '');

    function inp(id, value, attrs) {
      if (ro) attrs = '';
      return '<input id="' + id + '" type="text" class="input" value="' + esc(value || '') + '"' + (attrs || '') + dis + '>';
    }
    function area(id, value, rows, attrs) {
      if (ro) attrs = '';
      return '<textarea id="' + id + '" class="input" rows="' + rows + '"' + (attrs || '') + dis + '>' + esc(value || '') + '</textarea>';
    }
    function sel(id, value, options, blank) {
      return '<select id="' + id + '" class="input"' + dis + '>' + (blank ? '<option value="">' + blank + '</option>' : '') +
        options.map(function (o) { return '<option value="' + esc(o) + '"' + (o === value ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') +
        (value && options.indexOf(value) < 0 ? '<option value="' + esc(value) + '" selected>' + esc(value) + '</option>' : '') +
        '</select>';
    }

    /* ---- Status banner ------------------------------------------------ */
    var banner = '';
    if (st === 'converted') {
      banner = '<div class="pf-banner pf-banner-done" role="status"><svg><use href="#i-check"></use></svg><div>' +
        '<strong>Converted to a final invoice' + (d.convertedAt ? ' on ' + esc(String(d.convertedAt).slice(0, 10)) : '') + '.</strong> ' +
        'This proforma is now read-only. Payment, due dates and receivables are handled on the invoice.</div>' +
        (d.convertedInvoiceId ? '<button type="button" class="btn btn-primary btn-sm" id="pfOpenInvoice"><svg><use href="#i-doc"></use></svg>Open final invoice</button>' : '') +
        '</div>';
    } else if (st === 'cancelled') {
      banner = '<div class="pf-banner pf-banner-muted" role="status"><svg><use href="#i-alert"></use></svg><div><strong>Cancelled.</strong> Kept for reference; it cannot be edited, sent or converted.</div></div>';
    } else if (st === 'expired') {
      banner = '<div class="pf-banner pf-banner-warn" role="status"><svg><use href="#i-clock"></use></svg><div><strong>Expired.</strong> Update “Valid until”, save, then reopen it as a draft to send or convert it again.</div></div>';
    }

    /* ---- Customer ----------------------------------------------------- */
    var customerCard =
      '<section class="card pf-sec"><h2 class="pf-sec-title">Customer</h2>' +
        (ro ? '' : pfField('pfCustomerPick', 'Saved customer <span class="pf-opt">(fills the addresses)</span>',
          '<select id="pfCustomerPick" class="input"><option value="">— Type a new customer below —</option></select>')) +
        pfField('pfCustomerName', 'Customer / consignee', inp('pfCustomerName', d.customerName, ' autocomplete="organization" placeholder="Company name"')) +
        '<div class="pf-grid-2">' +
          pfField('pfBillTo', 'Bill to', area('pfBillTo', d.billTo, 4, ' placeholder="Name, street, city, country"')) +
          pfField('pfShipTo', 'Ship to', area('pfShipTo', d.shipTo, 4, ' placeholder="Delivery address or terminal"')) +
        '</div>' +
      '</section>';

    /* ---- Document ----------------------------------------------------- */
    var docCard =
      '<section class="card pf-sec"><h2 class="pf-sec-title">Document</h2>' +
        '<div class="pf-grid-2">' +
          pfField('pfNumber', 'Proforma #', '<input id="pfNumber" class="input mono" value="' + esc(d.proformaNumber || '') + '" placeholder="' + (d.id ? '' : 'Assigned on save') + '" readonly tabindex="-1">') +
          pfField('pfCurrency', 'Currency', sel('pfCurrency', d.currency, PF_CURRENCIES)) +
          pfField('pfIssueDate', 'Issue date', '<input type="date" id="pfIssueDate" class="input" value="' + esc(d.issueDate) + '"' + dis + '>') +
          pfField('pfValidityDate', 'Valid until', '<input type="date" id="pfValidityDate" class="input" value="' + esc(d.validityDate) + '"' + dis + '>') +
        '</div>' +
        pfField('pfPoRef', 'Customer PO / reference', inp('pfPoRef', d.poReference, ' placeholder="e.g. PO-2026-0412"')) +
      '</section>';

    /* ---- Shipping & customs ------------------------------------------ */
    var shipCard =
      '<section class="card pf-sec pf-sec-wide"><h2 class="pf-sec-title">Shipping &amp; customs</h2>' +
        '<div class="pf-grid-3">' +
          pfField('pfOrigin', 'Origin', inp('pfOrigin', d.origin, ' placeholder="e.g. Maple Ridge, BC, Canada"')) +
          pfField('pfDestination', 'Destination', inp('pfDestination', d.destination, ' placeholder="e.g. Busan, South Korea"')) +
          '<div class="pf-inco">' +
            pfField('pfIncoterm', 'Incoterm', sel('pfIncoterm', d.incoterm, INCOTERM_OPTIONS, '—')) +
            pfField('pfIncotermLoc', 'Named place / port', inp('pfIncotermLoc', d.incotermLocation, ' placeholder="e.g. Port of Vancouver"')) +
          '</div>' +
        '</div>' +
        '<div class="pf-grid-ship">' +
          pfField('pfShippingTerms', 'Shipping terms', inp('pfShippingTerms', d.shippingTerms, ' placeholder="e.g. Ocean freight, 2 × 40ft HC, booking by buyer"')) +
          pfField('pfWeightUnit', 'Weight unit', sel('pfWeightUnit', d.weightUnit || 'kg', PF_WEIGHT_UNITS)) +
        '</div>' +
      '</section>';

    /* ---- Items -------------------------------------------------------- */
    var wu = d.weightUnit || 'kg';
    function lineHtml(it, idx) {
      var c = pfLineCalc(it);
      function num(cls, label, value, step, extra) {
        var fid = 'pf' + cls + idx;
        return '<div class="pf-cell pf-c-' + cls + '"><label class="pf-l" for="' + fid + '">' + label + '</label>' +
          '<input id="' + fid + '" type="number" inputmode="decimal" step="' + step + '" min="0" class="input mono pf-f-' + cls + '" value="' + esc(value) + '"' + (extra || '') + dis + '></div>';
      }
      return '<div class="pf-line" data-pf-line="' + idx + '">' +
        '<div class="pf-cell pf-c-desc"><label class="pf-l" for="pfdesc' + idx + '">Item ' + (idx + 1) + ' description</label>' +
          '<input id="pfdesc' + idx + '" type="text" class="input pf-f-desc" value="' + esc(it.description) + '" placeholder="Material / item description"' + dis + '></div>' +
        num('qty', 'Qty', it.quantity, 'any') +
        '<div class="pf-cell pf-c-unit"><label class="pf-l" for="pfunit' + idx + '">Unit</label>' +
          '<input id="pfunit' + idx + '" type="text" class="input pf-f-unit" list="pfUnitList" value="' + esc(it.unit || 'kg') + '"' + dis + '></div>' +
        num('price', 'Unit price', it.unitPrice, 'any') +
        num('disc', 'Discount', it.discount || 0, '0.01') +
        num('tax', 'Tax %', it.taxRate != null ? it.taxRate : 0, 'any') +
        num('weight', 'Weight (' + esc(wu) + ')', it.weight != null ? it.weight : '', 'any', ' placeholder="—"') +
        '<div class="pf-cell pf-c-total"><span class="pf-l">Line total</span><span class="mono pf-line-total">' + esc(pfMoney(c.total, d.currency)) + '</span></div>' +
        '<div class="pf-cell pf-c-del">' + (ro ? '' : '<button type="button" class="btn ghost btn-sm pf-line-del" aria-label="Remove item ' + (idx + 1) + '" title="Remove item"><svg><use href="#i-trash"></use></svg></button>') + '</div>' +
      '</div>';
    }
    var itemsCard =
      '<section class="card pf-sec pf-sec-wide pf-items"><div class="pf-sec-head"><h2 class="pf-sec-title">Items <span class="pf-count" id="pfItemCount"></span></h2>' +
        (ro ? '' : '<button type="button" class="btn ghost btn-sm" id="pfAddLineTop"><svg><use href="#i-plus"></use></svg>Add item</button>') + '</div>' +
        '<div class="pf-lines-head" aria-hidden="true"><span>Description</span><span>Qty</span><span>Unit</span><span>Unit price</span><span>Discount</span><span>Tax %</span><span>Weight (' + esc(wu) + ')</span><span>Line total</span><span></span></div>' +
        '<div id="pfItemsWrap">' + d.items.map(lineHtml).join('') + '</div>' +
        '<datalist id="pfUnitList"><option value="kg"><option value="lb"><option value="t"><option value="bale"><option value="pallet"><option value="container"><option value="ea"></datalist>' +
        (ro ? '' : '<button type="button" class="btn ghost pf-add-line" id="pfAddLine"><svg><use href="#i-plus"></use></svg>Add item</button>') +
      '</section>';

    /* ---- Notes + summary ---------------------------------------------- */
    var notesCard =
      '<section class="card pf-sec"><h2 class="pf-sec-title">Notes &amp; terms</h2>' +
        pfField('pfNotes', 'Notes <span class="pf-opt">(printed on the proforma)</span>', area('pfNotes', d.notes, 3)) +
        pfField('pfCommercialTerms', 'Commercial terms', area('pfCommercialTerms', d.commercialTerms, 4)) +
      '</section>';
    var summaryCard =
      '<section class="card pf-sec pf-summary" aria-live="polite"><h2 class="pf-sec-title">Estimate</h2>' +
        '<dl class="pf-sum">' +
          '<div><dt>Total weight</dt><dd class="mono" id="pfSumWeight">—</dd></div>' +
          '<div><dt>Subtotal</dt><dd class="mono" id="pfSumSubtotal">—</dd></div>' +
          '<div><dt>Estimated tax</dt><dd class="mono" id="pfSumTax">—</dd></div>' +
          '<div class="pf-sum-total"><dt>Estimated total</dt><dd class="mono" id="pfSumTotal">—</dd></div>' +
        '</dl>' +
        '<p class="pf-convert-warn" id="pfMixedWarn" hidden>Items use different tax rates. Converting to a final invoice needs a single rate.</p>' +
        '<p class="pf-sum-note">Estimate only — no payment is requested and nothing is posted to accounting.</p>' +
      '</section>';

    var stickyBar = ro ? '' :
      '<div class="pf-sticky" id="pfSticky"><div><span class="pf-sticky-l">Estimated total</span><strong class="mono" id="pfStickyTotal">—</strong></div>' +
      '<button type="button" class="btn btn-primary" id="pfStickySave"><svg><use href="#i-check"></use></svg>' + (d.id ? 'Save' : 'Create') + '</button></div>';

    body.innerHTML = banner +
      '<div class="pf-layout">' + customerCard + docCard + shipCard + itemsCard + notesCard + summaryCard + '</div>' + stickyBar;

    /* ---- Header actions ------------------------------------------------ */
    var actionsEl = $('#pfEdActions');
    if (actionsEl) {
      var html = '';
      if (d.id) {
        var acts = proformaActions(d).filter(function (a) { return a.key !== 'open'; });
        // Converted: "Open final invoice" lives in the status banner, so the
        // header keeps only the PDF.
        var primaryKey = null;
        acts.forEach(function (a) {
          if (a.key === primaryKey) html += '<button type="button" class="btn btn-primary" data-pf-ed="' + a.key + '"><svg><use href="#i-' + a.icon + '"></use></svg>' + esc(a.label) + '</button>';
        });
        if (acts.some(function (a) { return a.key === 'pdf'; })) html += '<button type="button" class="btn ghost" data-pf-ed="pdf"><svg><use href="#i-download"></use></svg>PDF</button>';
        var menuActs = acts.filter(function (a) { return a.key !== 'pdf' && a.key !== 'invoice'; });
        if (menuActs.length) {
          html += '<details class="row-menu"><summary class="btn ghost" aria-label="More proforma actions"><svg><use href="#i-more"></use></svg><span class="row-menu-text">More</span></summary><div class="row-menu-pop" role="menu">' +
            menuActs.map(function (a) {
              return (a.divider ? '<hr>' : '') + '<button type="button" role="menuitem" class="' + (a.danger ? 'is-danger' : '') + '" data-pf-ed="' + a.key + '"><svg><use href="#i-' + a.icon + '"></use></svg>' + esc(a.label) + '</button>';
            }).join('') + '</div></details>';
        }
      }
      if (!ro) html += '<button type="button" class="btn btn-primary" id="pfEdSave"><svg><use href="#i-check"></use></svg>' + (d.id ? 'Save changes' : 'Create proforma') + '</button>';
      actionsEl.innerHTML = html;

      $$('[data-pf-ed]', actionsEl).forEach(function (b) {
        b.addEventListener('click', function () {
          var menu = b.closest('details'); if (menu) menu.removeAttribute('open');
          var key = b.dataset.pfEd;
          if (proformaDirty && (key === 'pdf' || key === 'send' || key === 'convert' || key === 'accept')) {
            toast('Save your changes first — the PDF, email and conversion use the saved proforma.');
            return;
          }
          var after = function () {
            return Api.getProforma(d.id).then(function (full) {
              proformaDraft = proformaToDraft(full);
              proformaDirty = false;
              renderProformaEditor();
            });
          };
          if (key === 'pdf') downloadProformaPdf(d.id, d.proformaNumber);
          else if (key === 'invoice') openFinalInvoice(d.convertedInvoiceId);
          else if (key === 'send') openSendProformaModal(d, after);
          else if (key === 'accept') setProformaStatus(d, 'accepted', after);
          else if (key === 'reopen') setProformaStatus(d, 'draft', after);
          else if (key === 'cancel') confirmCancelProforma(d, after);
          else if (key === 'convert') confirmConvertProforma(d, after);
        });
      });
      var saveBtn = $('#pfEdSave');
      if (saveBtn) saveBtn.addEventListener('click', doSaveProforma);
    }

    var openInv = $('#pfOpenInvoice');
    if (openInv) openInv.addEventListener('click', function () { openFinalInvoice(d.convertedInvoiceId); });
    var stickySave = $('#pfStickySave');
    if (stickySave) stickySave.addEventListener('click', doSaveProforma);

    /* ---- Saved-customer picker ----------------------------------------- */
    var pick = $('#pfCustomerPick');
    if (pick) {
      var pickList = [];
      var fillPick = function (list) {
        pickList = list || [];
        pick.innerHTML = '<option value="">— Type a new customer below —</option>' + pickList.map(function (c) {
          return '<option value="' + esc(c.id) + '"' + (c.id === d.customerId ? ' selected' : '') + '>' + esc(c.name) + '</option>';
        }).join('');
      };
      if (proformaCustomersCache && proformaCustomersCache.wh === warehouseId) fillPick(proformaCustomersCache.list);
      else Api.listCustomers(warehouseId).then(function (list) {
        fillPick(list);
        proformaCustomersCache = { wh: warehouseId, list: list || [] };
      }).catch(function () { fillPick([]); });
      pick.addEventListener('change', function () {
        var c = pickList.filter(function (x) { return x.id === pick.value; })[0];
        d.customerId = c ? c.id : '';
        if (!c) return;
        $('#pfCustomerName').value = c.name || '';
        if (c.billTo || c.bill_to) $('#pfBillTo').value = c.billTo || c.bill_to;
        if (c.shipTo || c.ship_to) $('#pfShipTo').value = c.shipTo || c.ship_to;
        proformaDirty = true;
      });
    }

    /* ---- Live recalculation ------------------------------------------- */
    function readLines() {
      return $$('#pfItemsWrap .pf-line').map(function (row) {
        function v(cls) { var el = row.querySelector('.pf-f-' + cls); return el ? el.value : ''; }
        var w = v('weight');
        return {
          description: v('desc').trim(),
          quantity: Number(v('qty')) || 0,
          unit: v('unit').trim() || 'kg',
          unitPrice: Number(v('price')) || 0,
          discount: Number(v('disc')) || 0,
          taxRate: Number(v('tax')) || 0,
          weight: w !== '' ? Number(w) : null
        };
      });
    }
    function syncAndCalc() {
      if (!ro) d.items = readLines();
      var cur = $('#pfCurrency') ? $('#pfCurrency').value : d.currency;
      var unit = $('#pfWeightUnit') ? $('#pfWeightUnit').value : wu;
      d.currency = cur;
      $$('#pfItemsWrap .pf-line').forEach(function (row, i) {
        var el = row.querySelector('.pf-line-total');
        if (el && d.items[i]) el.textContent = pfMoney(pfLineCalc(d.items[i]).total, cur);
      });
      var t = pfTotals(d.items);
      var set = function (id, txt) { var el = $(id); if (el) el.textContent = txt; };
      set('#pfSumWeight', pfWeight(t.weight, unit));
      set('#pfSumSubtotal', pfMoney(t.subtotal, cur));
      set('#pfSumTax', pfMoney(t.tax, cur));
      set('#pfSumTotal', pfMoney(t.total, cur));
      set('#pfStickyTotal', pfMoney(t.total, cur));
      set('#pfItemCount', d.items.length + (d.items.length === 1 ? ' item' : ' items'));
      var warn = $('#pfMixedWarn'); if (warn) warn.hidden = !t.mixedRates;
    }
    syncAndCalc();

    body.oninput = function (e) {
      if (e.target.closest('input, select, textarea') && e.target.id !== 'pfCustomerPick') {
        proformaDirty = true;
        e.target.classList.remove('is-invalid');
        syncAndCalc();
      }
    };
    body.onchange = function (e) {
      if (e.target.id === 'pfWeightUnit') {
        wu = e.target.value; d.weightUnit = wu;
        syncAndCalc();
        renderLinesOnly();
      } else if (e.target.id === 'pfCurrency') syncAndCalc();
    };

    function renderLinesOnly() {
      var wrap = $('#pfItemsWrap');
      if (!wrap) return;
      syncHeaderFields();
      renderProformaEditor();
    }

    /* Header fields are read into the draft before any full re-render so a
       re-render (add/remove line) never loses typed values. */
    function syncHeaderFields() {
      if (ro) return;
      function val(id) { var el = $('#' + id); return el ? el.value : ''; }
      d.customerName = val('pfCustomerName');
      d.poReference = val('pfPoRef');
      d.incoterm = val('pfIncoterm');
      d.incotermLocation = val('pfIncotermLoc');
      d.origin = val('pfOrigin');
      d.destination = val('pfDestination');
      d.shippingTerms = val('pfShippingTerms');
      d.issueDate = val('pfIssueDate');
      d.validityDate = val('pfValidityDate');
      d.currency = val('pfCurrency') || 'CAD';
      d.weightUnit = val('pfWeightUnit') || 'kg';
      d.billTo = val('pfBillTo');
      d.shipTo = val('pfShipTo');
      d.commercialTerms = val('pfCommercialTerms');
      d.notes = val('pfNotes');
      d.items = readLines();
    }

    function addLine() {
      syncHeaderFields();
      var last = d.items[d.items.length - 1];
      var line = blankProformaLine();
      // A new line inherits the unit and tax rate of the one above: quotes
      // are usually one unit and one rate throughout.
      if (last) { line.unit = last.unit || 'kg'; line.taxRate = last.taxRate || 0; }
      d.items.push(line);
      proformaDirty = true;
      renderProformaEditor();
      var rows = $$('#pfItemsWrap .pf-line');
      var desc = rows.length ? rows[rows.length - 1].querySelector('.pf-f-desc') : null;
      if (desc) { desc.focus(); if (desc.scrollIntoView) desc.scrollIntoView({ block: 'center' }); }
    }
    var addTop = $('#pfAddLineTop'); if (addTop) addTop.addEventListener('click', addLine);
    var addBottom = $('#pfAddLine'); if (addBottom) addBottom.addEventListener('click', addLine);

    $$('.pf-line-del').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var row = btn.closest('.pf-line');
        var idx = row ? Number(row.dataset.pfLine) : -1;
        if (idx < 0) return;
        syncHeaderFields();
        d.items.splice(idx, 1);
        if (!d.items.length) d.items.push(blankProformaLine());
        proformaDirty = true;
        renderProformaEditor();
      });
    });

    function flagInvalid(el, msg) {
      toast(msg);
      if (!el) return;
      el.classList.add('is-invalid');
      el.focus();
      if (el.scrollIntoView) el.scrollIntoView({ block: 'center' });
    }

    function doSaveProforma() {
      syncHeaderFields();
      // Fully blank rows are dropped rather than rejected.
      var items = d.items.filter(function (it) { return it.description || it.unitPrice || it.weight; });
      if (!d.customerName.trim()) return flagInvalid($('#pfCustomerName'), 'Enter the customer name.');
      if (!items.length) return flagInvalid($('#pfItemsWrap .pf-f-desc'), 'Add at least one item.');
      for (var i = 0; i < items.length; i++) {
        var rowIdx = d.items.indexOf(items[i]);
        var row = $$('#pfItemsWrap .pf-line')[rowIdx];
        if (!items[i].description) return flagInvalid(row && row.querySelector('.pf-f-desc'), 'Item ' + (rowIdx + 1) + ' needs a description.');
        if (!(items[i].quantity > 0)) return flagInvalid(row && row.querySelector('.pf-f-qty'), 'Item ' + (rowIdx + 1) + ' needs a quantity above zero.');
      }
      if (d.validityDate && d.issueDate && d.validityDate < d.issueDate) {
        return flagInvalid($('#pfValidityDate'), '“Valid until” is before the issue date.');
      }

      var updating = !!d.id;
      // On update an emptied field must be sent as empty, or the API keeps
      // the old value; on create it is simply left out.
      function opt(v) { v = (v || '').trim(); return v ? v : (updating ? '' : undefined); }
      var totals = pfTotals(items);
      var payload = {
        customerId: d.customerId || undefined,
        customerName: d.customerName.trim(),
        warehouseId: d.warehouseId || warehouseId || undefined,
        issueDate: d.issueDate || today(),
        validityDate: d.validityDate || (updating ? null : undefined),
        currency: d.currency || 'CAD',
        poReference: opt(d.poReference),
        billTo: opt(d.billTo),
        shipTo: opt(d.shipTo),
        origin: opt(d.origin),
        destination: opt(d.destination),
        incoterm: d.incoterm || undefined,
        incotermLocation: opt(d.incotermLocation),
        shippingTerms: opt(d.shippingTerms),
        notes: opt(d.notes),
        commercialTerms: opt(d.commercialTerms),
        totalWeight: totals.weight,
        weightUnit: d.weightUnit || 'kg',
        items: items.map(function (it) {
          return {
            description: it.description,
            quantity: Number(it.quantity),
            unit: it.unit || 'kg',
            unitPrice: Number(it.unitPrice),
            discount: Number(it.discount || 0),
            taxRate: Number(it.taxRate || 0),
            weight: it.weight != null && !isNaN(it.weight) ? Number(it.weight) : undefined
          };
        })
      };

      var btns = [$('#pfEdSave'), $('#pfStickySave')].filter(Boolean);
      btns.forEach(function (b) { b.disabled = true; b.dataset.label = b.innerHTML; b.textContent = 'Saving…'; });

      var req = updating ? Api.updateProforma(d.id, payload) : Api.createProforma(payload);
      req.then(function (res) {
        toast((updating ? 'Saved ' : 'Created ') + res.proformaNumber + '.');
        proformaDraft = proformaToDraft(res);
        proformaDirty = false;
        renderProformaEditor();
      }).catch(function (err) {
        btns.forEach(function (b) { b.disabled = false; b.innerHTML = b.dataset.label; });
        toast('Could not save the proforma: ' + (err.message || err));
      });
    }
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
    var w = warehouse();
    var noun = isRecycling() ? 'material' : 'product';
    var pSub = $('#prodSub');
    /* Catalog, not stock: a product listed here can have zero on hand, and
       the page says so rather than letting the list be read as inventory. */
    if (pSub) pSub.textContent = (isRecycling() ? 'Materials' : 'Products') + ' that can be received at this facility. ' +
      'This is the catalog only — stock on hand is under Inventory.';
    var pFac = $('#prodScopeFacility'); if (pFac) pFac.textContent = w ? w.name : 'No facility';
    var pDiv = $('#prodScopeDivision'); if (pDiv) pDiv.textContent = divisionLabel(entity);
    var pCta = $('#prodCta'); if (pCta) pCta.textContent = 'Add ' + noun;
    loadingState('#productBody');
    if (!w) { var pBody0 = $('#productBody'); if (pBody0) pBody0.innerHTML = ''; return; }
    Api.listMaterials({ warehouseId: w.id, division: entity, includeInactive: true }).then(function (all) {
      var list = all;
      var pBody = $('#productBody');
      if (!pBody) return;
      if (!list.length) {
        pBody.innerHTML = emptyState('tag', 'No ' + noun + 's in the ' + esc(w.name) + ' catalog',
          esc(divisionLabel(entity)) + ' ' + noun + 's are set up per facility. Add one here, or copy an existing catalog from another facility, before stock can be received.',
          'Add ' + noun, 'newProduct');
        return;
      }
      pBody.innerHTML = '<div class="card"><div class="tablewrap" tabindex="0" role="region" aria-label="Scrollable table"><table class="table"><thead><tr>' +
        '<th>' + (isRecycling() ? 'Material' : 'Product') + '</th><th>Category</th><th>Description</th><th>Division</th><th>Status</th><th>Actions</th></tr></thead><tbody>' +
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
              (isAdmin() ? '<button type="button" class="btn ghost btn-sm btn-danger-quiet" data-delete-material="' + esc(m.id) + '" aria-label="Delete ' + esc(m.name) + '">Delete Product</button>' : '') +
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
          '<td data-label="User"><strong class="staff-name">' + esc(u.name || u.fullName) + '</strong></td>' +
          '<td data-label="Email"><span class="mono staff-email" title="' + esc(u.email) + '">' + esc(u.email) + '</span></td>' +
          '<td data-label="Role"><span class="badge ' + (u.role === 'admin' ? 'badge-in' : (u.role === 'manager' ? 'badge-transit' : 'badge-received')) + '">' + esc(u.role) + '</span></td>' +
          '<td data-label="Status"><span class="badge ' + statusBadgeClass + '">' + statusLabel + '</span></td>' +
          // Division and warehouse are separate permissions and are shown as
          // separate columns on purpose — a user needs both to see anything.
          '<td data-label="Division access">' + divisionChips(u.divisions, true) + '</td>' +
          '<td data-label="Warehouse access"><div style="display:flex;flex-wrap:wrap;gap:4px">' + assignedWhNames + '</div></td>' +
          '<td data-label="Created" class="mono" style="font-size:12.5px">' + esc(createdDate) + '</td>' +
          '<td data-label="Last login" class="mono" style="font-size:12.5px">' + lastLoginHtml + '</td>' +
          '<td data-label="Actions" class="staff-actions-cell"><div class="staff-actions">' +
            '<button type="button" class="btn ghost btn-sm btn-view-user" data-user-id="' + esc(u.id) + '" title="View user details & permissions">View</button>' +
            '<button type="button" class="btn ghost btn-sm btn-edit-user" data-user-id="' + esc(u.id) + '" title="Edit user role, division and facility permissions">Edit</button>' +
          '</div></td></tr>';
      }).join('');

      sBody.innerHTML = toolbarHtml + '<div class="card"><div class="tablewrap tablewrap-fit"><table class="table table-staff stack-mobile"><thead><tr>' +
        '<th>User</th><th>Email</th><th>Role</th><th>Status</th><th>Division Access</th><th>Warehouse Access</th><th>Created</th><th>Last Login</th><th>Actions</th></tr></thead><tbody>' +
        (rowsHtml || '<tr><td colspan="9"><div class="empty"><div class="eico"><svg><use href="#i-users"></use></svg></div><h3>No matching staff accounts</h3><p>Try clearing the search or role filter, or create a new staff account.</p></div></td></tr>') +
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

          Promise.all([
            Api.getUserWarehouses(uid),
            Api.getUserDivisions(uid)
          ]).then(function (userAccess) {
            var userWhs = userAccess[0];
            var currentDivisions = userAccess[1] || [];
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
              divisionAccessSection(currentDivisions) +
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
                  warehouseIds: selectedWhIds,
                  // Division access is sent as an explicit list every time,
                  // including an empty one — that is how access is revoked.
                  // The API re-checks that the acting admin may grant each
                  // value, so this is a convenience, never the control.
                  divisions: selectedDivisionsFrom(fd)
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
    var divisionAccessHtml = divisionChips(u.divisions);
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
        '<div class="user-detail-field"><span class="user-detail-label">Division Access</span><span class="user-detail-val">' + divisionAccessHtml + '</span></div>' +
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

    // "Your access" states what this account can actually reach, read back
    // from the server profile rather than assumed from the role. It is
    // read-only for everyone: changing it is an administrator action in Staff
    // Management, so no admin-only control is exposed here.
    var accessCardHtml = '<div class="card pad" style="margin-bottom:24px">' +
      '<h3>Your access</h3>' +
      '<p style="color:var(--muted);font-size:13px;margin:6px 0 20px">' +
        'Granted by an administrator and enforced by the server. ' +
        'Contact an administrator to request a change.</p>' +
      '<div class="user-detail-grid">' +
        '<div class="user-detail-field">' +
          '<span class="user-detail-label">Role</span>' +
          '<span class="user-detail-val"><span class="badge ' +
            (me && me.role === 'admin' ? 'badge-in' : (me && me.role === 'manager' ? 'badge-transit' : 'badge-received')) +
            '">' + esc(me ? me.role : '—') + '</span></span>' +
        '</div>' +
        '<div class="user-detail-field">' +
          '<span class="user-detail-label">Division access</span>' +
          '<span class="user-detail-val">' + divisionChips(myDivisions) + '</span>' +
        '</div>' +
        '<div class="user-detail-field">' +
          '<span class="user-detail-label">Warehouse access</span>' +
          '<span class="user-detail-val">' + (
            (me && me.hasGlobalAccess)
              ? 'All facilities (global access)'
              : (deduplicateWarehouses(warehouses).length
                  ? deduplicateWarehouses(warehouses).map(function (w) {
                      return '<span class="audit-wh-badge">' + esc(w.name) + '</span>';
                    }).join(' ')
                  : '<span class="division-badge none">No facilities assigned</span>')
          ) + '</span>' +
        '</div>' +
      '</div>' +
    '</div>';

    // Company details are an administrator control and are simply not
    // rendered for anyone else — an ordinary user still gets the access card.
    if (!isAdmin()) {
      sBody.innerHTML = accessCardHtml;
      return;
    }

    sBody.innerHTML = accessCardHtml + '<div class="card pad">' +
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

    /* Focus the first field the user can actually type in -- not a read-only
       location box or a hidden file input. On touch screens focus stays on
       the dialog's close control instead: focusing an input there opens the
       keyboard over half the form before the user has read it. */
    var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    var firstField = (formEl && !coarse)
      ? $('input:not([readonly]):not([hidden]):not([type=hidden]):not([type=file]):not([disabled]), select:not([disabled]), textarea:not([readonly]):not([disabled])', formEl)
      : null;
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

  function closeModal() {
    var wrap = $('#modalWrap');
    if (wrap) {
      wrap.hidden = true;
      var formEl = $('#modalForm');
      if (formEl) formEl.innerHTML = '';
    }
  }

  /**
   * Renders the "no business unit assigned" state.
   *
   * This is a real, expected state: every account starts with no division
   * until an administrator grants one. It is shown instead of the normal
   * views, and critically nothing division-scoped is fetched while it is up —
   * hiding menus while still loading the data behind them would defeat the
   * whole point.
   */
  function renderNoDivisionState() {
    var scroll = $('#scroll');
    if (!scroll) return;
    $$('.view').forEach(function (v) { v.classList.remove('active'); });

    var existing = $('#noDivisionState');
    if (existing) { existing.hidden = false; return; }

    var el = document.createElement('div');
    el.id = 'noDivisionState';
    el.className = 'no-division-state';
    el.innerHTML =
      '<div class="eico"><svg><use href="#i-alert"></use></svg></div>' +
      '<h2>No business unit assigned</h2>' +
      '<p>Your account does not yet have access to a business division. ' +
      'An administrator needs to grant you GreenWave Recycling, Healthcare, ' +
      'or both before operational data becomes available.</p>';
    scroll.appendChild(el);
  }

  function clearNoDivisionState() {
    var el = $('#noDivisionState');
    if (el) el.hidden = true;
  }

  var RECYCLING_ONLY_FINANCIAL_VIEWS = [
    'invoices', 'editor', 'payments', 'araging', 'purchaseorders', 'poeditor',
    'banking', 'reconciliation', 'payables',
    'chartofaccounts', 'generalledger', 'profitloss', 'balancesheet',
    'proformas', 'proformaeditor'
  ];

  function render() {
    syncChrome();

    // Changing only `view` would leave the previous section marked active
    // (a Banking screen stayed visible in Healthcare); show() swaps the
    // visible section and re-enters render().
    if (!isRecycling() && RECYCLING_ONLY_FINANCIAL_VIEWS.indexOf(view) >= 0) {
      show('inventory');
      return;
    }

    // Guard every division-scoped view behind an actual grant. Settings, Staff,
    // and HR are company-wide and not division-scoped, so they stay usable.
    // Financial views are strictly GreenWave Recycling.
    var nonDivisionViews = [
      'settings', 'staff', 'employees', 'attendance', 'leaverequests'
    ];
    if (!hasAnyDivision() && nonDivisionViews.indexOf(view) < 0) {
      renderNoDivisionState();
      return;
    }
    clearNoDivisionState();

    if (view === 'dashboard') renderDashboard();
    else if (view === 'inventory') renderInventory();
    else if (view === 'chat') renderChat();
    else if (view === 'intake') renderIntake();
    else if (view === 'photos') renderPhotos();
    else if (view === 'timeclock') renderTimeclock();
    else if (view === 'proformas') renderProformaList();
    else if (view === 'proformaeditor') renderProformaEditor();
    else if (view === 'invoices') renderInvoiceList();
    else if (view === 'editor') renderEditor();
    else if (view === 'payments') renderPaymentsList();
    else if (view === 'araging') renderArAgingView();
    else if (view === 'purchaseorders') renderPurchaseOrderList();
    else if (view === 'poeditor') renderPoEditor();
    else if (view === 'banking') renderBankingView();
    else if (view === 'reconciliation') renderReconciliationView();
    else if (view === 'payables') renderPayablesView();
    else if (view === 'chartofaccounts') renderChartOfAccountsView();
    else if (view === 'generalledger') renderGeneralLedgerView();
    else if (view === 'profitloss') renderProfitLossView();
    else if (view === 'balancesheet') renderBalanceSheetView();
    else if (view === 'employees') renderEmployeesView();
    else if (view === 'attendance') renderAttendanceView();
    else if (view === 'leaverequests') renderLeaveRequestsView();
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
        role: user.role,
        // Carried through for display only. Every one of these is re-derived
        // and re-enforced server-side on each request; the client copy exists
        // so the UI can reflect authorization, never to decide it.
        permissions: user.permissions || [],
        hasGlobalAccess: !!user.hasGlobalAccess
      };
      S.setServerSession(me);

      var gate = $('#gate');
      if (gate) gate.hidden = true;
      var app = $('#app');
      if (app) app.hidden = false;

      // Division access comes from the server, resolved before anything
      // division-scoped is fetched. The profile already carries the grants,
      // so there is no second round trip; GET /divisions returns the same
      // list and stays available for other clients.
      //
      // A stored preference is honoured only if it is still granted;
      // otherwise the first granted division becomes active. With no grants
      // at all `entity` stays empty and render() shows the "no business unit
      // assigned" state rather than issuing requests that would 403.
      myDivisions = (user.divisions || [])
        .map(function (d) { return entityFromApiKey(d.key || d); })
        .filter(function (e, i, a) { return a.indexOf(e) === i; });

      var storedEntity = db.entity;
      entity = hasDivision(storedEntity) ? storedEntity : (myDivisions[0] || '');
      db.entity = entity;
      S.save(db);
      syncDivisionChrome();

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
        // The client cannot invent a division. Even if a button were injected
        // or un-hidden in the DOM, switching to a division this session was
        // not granted is refused here — and the API would refuse it anyway.
        if (!hasDivision(newEntity)) {
          toast('You are not authorized for that business division.');
          return;
        }
        entity = newEntity;
        db.entity = entity;
        S.save(db);
        // Close any open form so a product/material selected under the
        // previous division can't linger after switching divisions.
        var modalWrap = $('#modalWrap');
        if (modalWrap && !modalWrap.hidden) {
          modalWrap.hidden = true;
          var modalFormEl = $('#modalForm');
          if (modalFormEl) modalFormEl.innerHTML = '';
        }
        // show() re-validates the current view for the new division (finance
        // screens fall back to Inventory) and swaps the visible section.
        show(view);
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

    /* The dashboard's two header actions are the same operations, not a
       second implementation: they open the identical modals, so scope,
       division/facility inheritance and the server-side authorization on
       POST /inventory/transactions are shared with the Inventory view. */
    var dashInBtn = $('#dashBtnAddInbound');
    if (dashInBtn) dashInBtn.addEventListener('click', openReceiveModal);
    var dashOutBtn = $('#dashBtnAddOutbound');
    if (dashOutBtn) dashOutBtn.addEventListener('click', openShipModal);
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
    var lbPrevBtn = $('#lbPrev');
    if (lbPrevBtn) lbPrevBtn.addEventListener('click', function () { navigateLightbox(-1); });
    var lbNextBtn = $('#lbNext');
    if (lbNextBtn) lbNextBtn.addEventListener('click', function () { navigateLightbox(1); });
    var lbRetryBtn = $('#lbRetry');
    if (lbRetryBtn) lbRetryBtn.addEventListener('click', retryLightboxImage);

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
      if (lbOpen) {
        if (e.key === 'ArrowLeft') {
          navigateLightbox(-1);
          return;
        }
        if (e.key === 'ArrowRight') {
          navigateLightbox(1);
          return;
        }
      }
      if (e.key === 'Tab') {
        trapFocus(lbOpen ? lb : modalWrap, e);
      }
    });

    bindAction($('#newInvoice'), 'newInvoice');
    bindAction($('#newPurchaseOrder'), 'newPurchaseOrder');
    bindAction($('#newCustomer'), 'newCustomer');
    bindAction($('#newProduct'), 'newProduct');

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
            // New accounts start with nothing checked: no division access is
            // the deliberate default, and an admin has to opt in.
            divisionAccessSection([]) +
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

              var selectedDivisions = selectedDivisionsFrom(fd);

              return Api.createUser({
                fullName: fd.fullName.trim(),
                email: fd.email.trim(),
                password: fd.password,
                role: fd.role,
                warehouseIds: selectedWhIds,
                divisions: selectedDivisions
              }).then(function () {
                toast(selectedDivisions.length === 0
                  ? 'User created with no division access \u2014 assign one before they can see operational data.'
                  : 'User account created successfully.');
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
        // Toolbar buttons bind their own listener via bindAction(); skip them
        // here so a click on one does not run the action twice.
        if (!act.hasAttribute('data-action-bound')) {
          if (runAction(act.dataset.action)) e.preventDefault();
        }
      }
    });

    setupInvoiceFilters();
    setupPurchaseOrderFilters();
  }

  var stripeJsPromise = null;
  function loadStripeJs() {
    if (window.Stripe) return Promise.resolve(window.Stripe);
    if (!stripeJsPromise) {
      stripeJsPromise = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = 'https://js.stripe.com/v3/';
        s.async = true;
        s.onload = function () { resolve(window.Stripe); };
        s.onerror = function () { reject(new Error('Unable to load Stripe checkout SDK')); };
        document.head.appendChild(s);
      });
    }
    return stripeJsPromise;
  }

  function checkPublicPaymentRoute() {
    var path = window.location.pathname;
    var hash = window.location.hash;
    var token = null;

    if (path.indexOf('/pay/') === 0) {
      token = path.replace('/pay/', '').split('/')[0];
    } else if (path.indexOf('/p/') === 0) {
      token = path.replace('/p/', '').split('/')[0];
    } else if (hash.indexOf('#pay/') === 0) {
      token = hash.replace('#pay/', '').split('?')[0];
    } else if (hash.indexOf('#p/') === 0) {
      token = hash.replace('#p/', '').split('?')[0];
    }

    if (!token) return false;

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
      var isPaid = inv.state === 'paid';
      var isRefunded = inv.state === 'refunded';
      var isProcessing = inv.state === 'processing';
      var isNotPayable = inv.state === 'not_payable';

      var statusBadge = '';
      if (isPaid) {
        statusBadge = '<span class="badge badge-paid" style="font-size:13px;padding:4px 10px">PAID IN FULL</span>';
      } else if (isRefunded) {
        statusBadge = '<span class="badge badge-refunded" style="font-size:13px;padding:4px 10px">REFUNDED</span>';
      } else if (isProcessing) {
        statusBadge = '<span class="badge badge-pending" style="font-size:13px;padding:4px 10px">PROCESSING</span>';
      } else if (isNotPayable) {
        statusBadge = '<span class="badge badge-failed" style="font-size:13px;padding:4px 10px">NOT PAYABLE</span>';
      } else {
        statusBadge = '<span class="badge badge-unpaid" style="font-size:13px;padding:4px 10px">AMOUNT DUE</span>';
      }

      var actionContent = '';
      if (isPaid) {
        actionContent =
          '<div class="payportal-paid-banner">' +
            '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>' +
            '<span>PAID IN FULL · Thank you for your payment' + (inv.paidAt ? ' on ' + ddmmyyyy(inv.paidAt) : '') + '</span>' +
          '</div>';
      } else if (isRefunded) {
        actionContent =
          '<div class="payportal-paid-banner" style="background:#EDE9FE;border-color:#DDD6FE;color:#5B21B6">' +
            '<span>REFUNDED · This transaction was refunded to the original payment method.</span>' +
          '</div>';
      } else if (isProcessing) {
        actionContent =
          '<div class="payportal-paid-banner" style="background:#FEF3C7;border-color:#FDE68A;color:#92400E">' +
            '<span class="spin" style="margin-right:8px"></span>' +
            '<span>PROCESSING · Your payment is being verified. Please refresh in a moment.</span>' +
          '</div>';
      } else if (isNotPayable) {
        actionContent =
          '<div class="payportal-paid-banner" style="background:#FEE2E2;border-color:#FECACA;color:#991B1B">' +
            '<span>Online payment is unavailable for this invoice. Please contact sales@greenwaverecycling.ca</span>' +
          '</div>';
      } else {
        actionContent =
          '<div id="stripePaymentSection" style="margin-top:24px">' +
            '<div id="stripeMountLoading" style="text-align:center;padding:20px;color:var(--muted)"><div class="spin" style="margin:0 auto 10px"></div>Preparing secure payment form…</div>' +
            '<div id="stripe-payment-element"></div>' +
            '<div id="stripe-pay-message" style="color:var(--crit);font-size:13px;margin-top:12px;text-align:center" hidden></div>' +
            '<div class="payportal-actions" style="margin-top:20px">' +
              '<button type="button" class="payportal-pay-btn" id="btnCustomerPayNow" disabled>' +
                '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>' +
                '<span id="btnPayText">PAY ' + esc(inv.amountDue || '$0.00') + ' ' + esc(inv.currency) + '</span>' +
              '</button>' +
              '<div style="font-size:12px;color:var(--muted)">End-to-end encrypted via GreenWave Secure Gateway (Stripe PCI Level 1)</div>' +
            '</div>' +
          '</div>';
      }

      pBody.innerHTML =
        '<div class="payportal-title-bar">' +
          '<div>' +
            '<div class="payportal-inv-num">Invoice #' + esc(inv.invoiceNumber) + '</div>' +
            '<div style="color:var(--muted);font-size:13px;margin-top:2px">Issued: ' + esc(inv.invoiceDate || '—') + (inv.dueDate ? ' · Due: ' + esc(inv.dueDate) : '') + '</div>' +
          '</div>' +
          '<div>' + statusBadge + '</div>' +
        '</div>' +

        '<div class="payportal-meta-grid">' +
          '<div class="payportal-meta-item">' +
            '<label>BILLED TO</label>' +
            '<span>' + esc(inv.customerName || 'Customer') + '</span>' +
          '</div>' +
          '<div class="payportal-meta-item">' +
            '<label>PAYMENT METHOD</label>' +
            '<span>Credit / Debit Card</span>' +
          '</div>' +
          '<div class="payportal-meta-item">' +
            '<label>CURRENCY</label>' +
            '<span>' + esc(inv.currency || 'CAD') + '</span>' +
          '</div>' +
          '<div class="payportal-meta-item">' +
            '<label>AMOUNT DUE</label>' +
            '<span class="mono" style="font-weight:700;color:var(--ink)">' + esc(inv.amountDue || '$0.00') + ' ' + esc(inv.currency) + '</span>' +
          '</div>' +
        '</div>' +

        '<div class="payportal-totals-box">' +
          '<div class="payportal-total-row payportal-grand-total">' +
            '<span>Total Amount Due</span>' +
            '<span class="mono">' + esc(inv.amountDue || '$0.00') + ' ' + esc(inv.currency) + '</span>' +
          '</div>' +
        '</div>' +

        actionContent;

      if (!isPaid && !isRefunded && !isProcessing && !isNotPayable && inv.onlinePaymentsAvailable && inv.publishableKey) {
        loadStripeJs().then(function (StripeSDK) {
          Api.createPaymentIntent(token).then(function (intent) {
            var loader = $('#stripeMountLoading');
            if (loader) loader.hidden = true;

            if (intent.state === 'paid') {
              renderPublicPaymentPortal(token);
              return;
            }

            if (!intent.clientSecret) {
              var msg = $('#stripe-pay-message');
              if (msg) { msg.hidden = false; msg.textContent = 'Payment could not be prepared. Please refresh.'; }
              return;
            }

            var stripeInstance = StripeSDK(inv.publishableKey);
            var elements = stripeInstance.elements({
              clientSecret: intent.clientSecret,
              appearance: {
                theme: 'stripe',
                variables: {
                  colorPrimary: '#0F7A4C',
                  colorBackground: '#FFFFFF',
                  colorText: '#0F172A',
                  borderRadius: '6px'
                }
              }
            });

            var paymentElement = elements.create('payment');
            paymentElement.mount('#stripe-payment-element');

            var payBtn = $('#btnCustomerPayNow');
            paymentElement.on('ready', function () {
              if (payBtn) payBtn.disabled = false;
            });

            if (payBtn) {
              payBtn.onclick = function () {
                payBtn.disabled = true;
                payBtn.innerHTML = '<span class="spin" style="margin-right:8px"></span>Processing Payment…';
                var errMsg = $('#stripe-pay-message');
                if (errMsg) errMsg.hidden = true;

                stripeInstance.confirmPayment({
                  elements: elements,
                  confirmParams: {
                    return_url: window.location.origin + '/pay/' + token
                  },
                  redirect: 'if_required'
                }).then(function (res) {
                  if (res.error) {
                    payBtn.disabled = false;
                    payBtn.innerHTML = 'PAY ' + esc(inv.amountDue || '$0.00') + ' ' + esc(inv.currency);
                    if (errMsg) {
                      errMsg.hidden = false;
                      errMsg.textContent = res.error.message || 'Payment submission failed. Please check card details.';
                    }
                  } else {
                    renderPublicPaymentPortal(token);
                  }
                }).catch(function (err) {
                  payBtn.disabled = false;
                  payBtn.innerHTML = 'PAY ' + esc(inv.amountDue || '$0.00') + ' ' + esc(inv.currency);
                  if (errMsg) {
                    errMsg.hidden = false;
                    errMsg.textContent = err.message || 'Payment submission error.';
                  }
                });
              };
            }
          }).catch(function (err) {
            var loader = $('#stripeMountLoading');
            if (loader) loader.innerHTML = '<span style="color:var(--crit)">Unable to initialize payment: ' + esc(err.message || 'Error') + '</span>';
          });
        }).catch(function () {
          var loader = $('#stripeMountLoading');
          if (loader) loader.innerHTML = '<span style="color:var(--crit)">Could not load secure checkout SDK. Please check network connection.</span>';
        });
      }
    }).catch(function (err) {
      pBody.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--crit)">' +
        '<div style="font-size:18px;font-weight:700;margin-bottom:8px">Unable to load invoice</div>' +
        '<div>' + esc(err.message || 'Invalid or expired payment link.') + '</div>' +
      '</div>';
    });
  }

  // ==========================================================================
  // PAYMENTS & SETTLEMENT
  // ==========================================================================
  var payFilterState = 'all';
  var paySearchState = '';
  function renderPaymentsList() {
    var host = $('#paymentsList');
    if (!host) return;

    var tabs = $$('#payFilterTabs button');
    tabs.forEach(function (tab) {
      if (!tab.dataset.bound) {
        tab.dataset.bound = 'true';
        tab.addEventListener('click', function () {
          tabs.forEach(function (t) { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
          tab.classList.add('active');
          tab.setAttribute('aria-selected', 'true');
          payFilterState = tab.dataset.payFilter || 'all';
          renderPaymentsList();
        });
      }
    });

    var sInput = $('#paySearch');
    if (sInput && !sInput.dataset.bound) {
      sInput.dataset.bound = 'true';
      sInput.addEventListener('input', function () {
        paySearchState = sInput.value.trim().toLowerCase();
        renderPaymentsList();
      });
    }

    var btnSync = $('#btnSyncStripe');
    if (btnSync && !btnSync.dataset.bound) {
      btnSync.dataset.bound = 'true';
      btnSync.addEventListener('click', function () {
        btnSync.disabled = true;
        btnSync.innerHTML = '<span class="spin" style="margin-right:6px"></span>Syncing…';
        Api.syncStripe({ full: false }).then(function () {
          btnSync.disabled = false;
          btnSync.innerHTML = '<svg><use href="#i-history"></use></svg>Sync Stripe';
          toast('Stripe synchronization complete.');
          renderPaymentsList();
        }).catch(function (err) {
          btnSync.disabled = false;
          btnSync.innerHTML = '<svg><use href="#i-history"></use></svg>Sync Stripe';
          toast(err.message || 'Stripe synchronization finished.');
          renderPaymentsList();
        });
      });
    }

    host.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted)"><div class="spin" style="margin:0 auto 10px"></div>Loading payments…</div>';

    Promise.all([
      Api.getPaymentSummary().catch(function () { return null; }),
      Api.listPayments({ status: payFilterState === 'all' ? undefined : payFilterState, q: paySearchState || undefined })
    ]).then(function (results) {
      var summary = results[0];
      var payments = (results[1] && results[1].items) ? results[1].items : (Array.isArray(results[1]) ? results[1] : []);

      if (summary) {
        var elS = $('#kpiPaySettled'); if (elS) elS.textContent = money(summary.settledTotalMinor || 0);
        var elP = $('#kpiPayProcessing'); if (elP) elP.textContent = money(summary.processingTotalMinor || 0);
        var elR = $('#kpiPayRefunded'); if (elR) elR.textContent = money(summary.refundedTotalMinor || 0);
        var elF = $('#kpiPayFailed'); if (elF) elF.textContent = num(summary.failedCount || 0);
      }

      if (!payments.length) {
        host.innerHTML = '<div class="card pad" style="text-align:center;color:var(--muted)">No payment records matching filter.</div>';
        return;
      }

      var rows = payments.map(function (p) {
        var statusCls = 'badge-pending';
        var statusLabel = p.status || 'CREATED';
        if (p.status === 'SUCCEEDED') { statusCls = 'badge-paid'; statusLabel = 'SUCCEEDED'; }
        else if (p.status === 'REFUNDED') { statusCls = 'badge-refunded'; statusLabel = 'REFUNDED'; }
        else if (p.status === 'PARTIALLY_REFUNDED') { statusCls = 'badge-refunded'; statusLabel = 'PARTIAL REFUND'; }
        else if (p.status === 'FAILED') { statusCls = 'badge-failed'; statusLabel = 'FAILED'; }
        else if (p.status === 'PROCESSING') { statusCls = 'badge-pending'; statusLabel = 'PROCESSING'; }
        else if (p.status === 'CANCELED') { statusCls = 'badge-neutral'; statusLabel = 'CANCELED'; }

        var amtMinor = p.amountMinor != null ? p.amountMinor : Math.round((Number(p.amount) || 0) * 100);
        var refMinor = p.refundedMinor || 0;
        var remMinor = Math.max(0, amtMinor - refMinor);
        var canRefund = (me && (me.role === 'admin' || (me.permissions && me.permissions.indexOf('payments:refund') !== -1))) && (p.status === 'SUCCEEDED' || p.status === 'PARTIALLY_REFUNDED') && remMinor > 0;
        var refundBtn = canRefund ?
          '<button type="button" class="btn ghost btn-sm btn-refund" data-pay-id="' + esc(p.id) + '" data-pay-rem-minor="' + remMinor + '" data-pay-curr="' + esc(p.currency || 'CAD') + '" title="Issue Stripe refund">Refund</button>' : '';

        var copyBtn = p.paymentToken ?
          '<button type="button" class="btn ghost btn-sm btn-copylink" data-token="' + esc(p.paymentToken) + '" title="Copy customer payment link">Copy Link</button>' : '';

        var detailBtn = '<button type="button" class="btn ghost btn-sm btn-pay-detail" data-pay-id="' + esc(p.id) + '" title="View Stripe and ledger details">Details</button>';

        var feeNetDisplay = (p.feeMinor != null && p.netMinor != null) ?
          '<span style="font-size:12px;color:var(--muted)">Fee: ' + money(p.feeMinor) + '<br>Net: ' + money(p.netMinor) + '</span>' :
          '<span style="color:var(--muted)">—</span>';

        var refundInfoDisplay = '<span style="color:var(--muted)">—</span>';
        if (p.status === 'FAILED' && p.failureReason) {
          refundInfoDisplay = '<span class="text-crit" style="font-size:12px;display:block" title="' + esc(p.failureReason) + '">' + esc(p.failureReason.slice(0, 24)) + '</span>';
        } else if (refMinor > 0) {
          refundInfoDisplay = '<span class="text-warning" style="font-size:12px;font-weight:600">Refunded: ' + money(refMinor) + '</span>';
        }

        var stripeIdDisplay = p.providerPaymentId ?
          '<code class="mono" style="font-size:11px">' + esc(p.providerPaymentId) + '</code>' :
          '<span style="color:var(--muted)">—</span>';

        return '<tr>' +
          '<td>' + (p.invoiceNumber ? '<a href="#invoices" class="link-inv" data-inv-id="' + esc(p.invoiceId) + '">#' + esc(p.invoiceNumber) + '</a>' : (p.invoiceId ? '#' + esc(p.invoiceId.slice(0, 8)) : '—')) + '</td>' +
          '<td>' + esc(p.customerName || (p.metadata && p.metadata.customerName) || 'Customer') + '</td>' +
          '<td class="mono" style="font-weight:600">' + money(amtMinor) + ' <small>' + esc(p.currency || 'CAD') + '</small></td>' +
          '<td><span class="badge ' + statusCls + '">' + statusLabel + '</span></td>' +
          '<td class="mono">' + ddmmyyyy(p.paidAt || p.createdAt) + '</td>' +
          '<td>' + esc(p.paymentMethodDisplay || p.paymentMethodType || '—') + '</td>' +
          '<td>' + stripeIdDisplay + '</td>' +
          '<td>' + feeNetDisplay + '</td>' +
          '<td>' + refundInfoDisplay + '</td>' +
          '<td style="text-align:right;white-space:nowrap">' + detailBtn + ' ' + copyBtn + ' ' + refundBtn + '</td>' +
        '</tr>';
      }).join('');

      host.innerHTML =
        '<div class="card"><div class="tablewrap"><table class="table">' +
          '<thead><tr><th>Invoice</th><th>Customer</th><th>Amount</th><th>Status</th><th>Date</th><th>Method</th><th>Stripe Payment ID</th><th>Fee / Net</th><th>Refund / Info</th><th style="text-align:right">Actions</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table></div></div>';

      $$('.btn-copylink', host).forEach(function (btn) {
        btn.onclick = function () {
          var url = window.location.origin + '/pay/' + btn.dataset.token;
          if (navigator.clipboard) {
            navigator.clipboard.writeText(url).then(function () { toast('Copied payment link to clipboard!'); });
          } else {
            prompt('Copy payment link:', url);
          }
        };
      });

      $$('.btn-pay-detail', host).forEach(function (btn) {
        btn.onclick = function () {
          var pId = btn.dataset.payId;
          Api.getPayment(pId).then(function (data) {
            var p = data.payment || {};
            var refunds = data.refunds || [];
            var events = data.providerEvents || [];

            var refundRows = refunds.length ? refunds.map(function (r) {
              return '<tr><td class="mono">' + esc(r.providerRefundId || r.id.slice(0, 8)) + '</td>' +
                '<td>' + money(r.amountMinor) + ' ' + esc(r.currency) + '</td>' +
                '<td><span class="badge ' + (r.status === 'SUCCEEDED' ? 'badge-paid' : 'badge-pending') + '">' + esc(r.status) + '</span></td>' +
                '<td>' + esc(r.reason || '—') + '</td>' +
                '<td class="mono">' + ddmmyyyy(r.createdAt) + '</td></tr>';
            }).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--muted)">No refunds issued for this payment.</td></tr>';

            var eventRows = events.length ? events.map(function (ev) {
              return '<tr><td class="mono" style="font-size:11px">' + esc(ev.providerEventId) + '</td>' +
                '<td class="mono" style="font-size:11px">' + esc(ev.eventType) + '</td>' +
                '<td><span class="badge ' + (ev.status === 'PROCESSED' ? 'badge-paid' : 'badge-neutral') + '">' + esc(ev.status) + '</span></td>' +
                '<td class="mono">' + ddmmyyyy(ev.receivedAt) + '</td></tr>';
            }).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--muted)">No webhook events recorded.</td></tr>';

            var html =
              '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;font-size:13px">' +
                '<div><strong>Stripe Payment ID:</strong> <code class="mono" style="font-size:12px">' + esc(p.providerPaymentId || '—') + '</code></div>' +
                '<div><strong>Stripe Charge ID:</strong> <code class="mono" style="font-size:12px">' + esc(p.providerChargeId || '—') + '</code></div>' +
                '<div><strong>Invoice:</strong> #' + esc(p.invoiceNumber || '—') + '</div>' +
                '<div><strong>Customer:</strong> ' + esc(p.customerName || '—') + '</div>' +
                '<div><strong>Payment Method:</strong> ' + esc(p.paymentMethodDisplay || p.paymentMethodType || 'Credit / Debit Card') + '</div>' +
                '<div><strong>Gross Amount:</strong> ' + money(p.amountMinor) + ' ' + esc(p.currency || 'CAD') + '</div>' +
                '<div><strong>Stripe Processing Fee:</strong> ' + (p.feeMinor != null ? money(p.feeMinor) : '—') + '</div>' +
                '<div><strong>Net Settlement:</strong> ' + (p.netMinor != null ? money(p.netMinor) : '—') + '</div>' +
                '<div><strong>Total Refunded:</strong> ' + money(p.refundedMinor || 0) + '</div>' +
                '<div><strong>Remaining Refundable:</strong> ' + money(p.refundableMinor != null ? p.refundableMinor : (p.amountMinor - (p.refundedMinor || 0))) + '</div>' +
                '<div><strong>Status:</strong> <span class="badge badge-paid">' + esc(p.status) + '</span></div>' +
                '<div><strong>Date Paid:</strong> ' + (p.paidAt ? ddmmyyyy(p.paidAt) : '—') + '</div>' +
                (p.failureReason ? '<div style="grid-column:1/-1" class="text-crit"><strong>Failure Reason:</strong> ' + esc(p.failureReason) + '</div>' : '') +
              '</div>' +
              '<h4 style="margin:16px 0 8px;font-size:13px;font-weight:700">Refund History</h4>' +
              '<div class="tablewrap"><table class="table" style="font-size:12px">' +
                '<thead><tr><th>Refund ID</th><th>Amount</th><th>Status</th><th>Reason</th><th>Date</th></tr></thead>' +
                '<tbody>' + refundRows + '</tbody>' +
              '</table></div>' +
              '<h4 style="margin:16px 0 8px;font-size:13px;font-weight:700">Stripe Webhook Audit History</h4>' +
              '<div class="tablewrap"><table class="table" style="font-size:12px">' +
                '<thead><tr><th>Event ID</th><th>Type</th><th>Status</th><th>Received</th></tr></thead>' +
                '<tbody>' + eventRows + '</tbody>' +
              '</table></div>';

            openModal('Payment & Stripe Provider Details', html, null, { okLabel: 'Close', okClass: 'btn-secondary' });
          }).catch(function (err) {
            toast(err.message || 'Could not load payment details');
          });
        };
      });

      $$('.btn-refund', host).forEach(function (btn) {
        btn.onclick = function () {
          var pId = btn.dataset.payId;
          var pCurr = btn.dataset.payCurr || 'CAD';
          var pRemMinor = Number(btn.dataset.payRemMinor || 0);
          var pRemDollars = (pRemMinor / 100).toFixed(2);

          openModal('Issue Payment Refund',
            '<div class="field">' +
              '<label>Refund Amount (' + esc(pCurr) + ')</label>' +
              '<input type="number" step="0.01" min="0.01" max="' + esc(pRemDollars) + '" name="amount" value="' + esc(pRemDollars) + '" required>' +
              '<small style="color:var(--muted)">Max refundable: $' + esc(pRemDollars) + ' ' + esc(pCurr) + '</small>' +
            '</div>' +
            '<div class="field">' +
              '<label>Reason for Refund</label>' +
              '<select name="reason">' +
                '<option value="requested_by_customer">Customer Request</option>' +
                '<option value="duplicate">Duplicate Transaction</option>' +
                '<option value="fraudulent">Suspected Fraud</option>' +
              '</select>' +
            '</div>',
            function (fd) {
              var minor = Math.round(Number(fd.amount) * 100);
              if (!minor || minor <= 0 || minor > pRemMinor) {
                toast('Please enter a valid refund amount up to $' + pRemDollars);
                return Promise.reject();
              }
              return Api.refundPayment(pId, minor, fd.reason).then(function () {
                toast('Refund requested successfully.');
                renderPaymentsList();
              }).catch(function (err) {
                toast(err.message || 'Refund failed');
              });
            },
            { okLabel: 'Issue Refund', okClass: 'btn-primary' }
          );
        };
      });
    }).catch(function (err) {
      host.innerHTML = '<div class="card pad" style="color:var(--crit)">Failed to load payments: ' + esc(err.message || 'Error') + '</div>';
    });
  }

  // ==========================================================================
  // ACCOUNTS RECEIVABLE AGING
  // ==========================================================================
  function renderArAgingView() {
    var host = $('#arAgingBody');
    if (!host) return;

    var asOfInput = $('#arAgingAsOf');
    if (asOfInput && !asOfInput.value) asOfInput.value = today();

    var btnRefresh = $('#btnRefreshArAging');
    if (btnRefresh && !btnRefresh.dataset.bound) {
      btnRefresh.dataset.bound = 'true';
      btnRefresh.onclick = function () { renderArAgingView(); };
    }

    var asOf = asOfInput ? asOfInput.value : today();
    host.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted)"><div class="spin" style="margin:0 auto 10px"></div>Calculating AR aging…</div>';

    Api.getAccountsReceivableAging({ asOf: asOf }).then(function (res) {
      var summary = res.summary || {};
      var buckets = res.buckets || [];

      var kCurrent = $('#kpiArCurrent'); if (kCurrent) kCurrent.textContent = money(summary.current || 0);
      var k30 = $('#kpiAr30'); if (k30) k30.textContent = money(summary.days1_30 || 0);
      var k60 = $('#kpiAr60'); if (k60) k60.textContent = money(summary.days31_60 || 0);
      var k90 = $('#kpiAr90'); if (k90) k90.textContent = money(summary.days90Plus || 0);

      var btnExport = $('#btnExportArAging');
      if (btnExport && !btnExport.dataset.bound) {
        btnExport.dataset.bound = 'true';
        btnExport.onclick = function () {
          var csv = 'Customer,Current,1-30 Days,31-60 Days,61-90 Days,90+ Days,Total Due\n' +
            buckets.map(function (b) {
              return '"' + (b.customerName || '').replace(/"/g, '""') + '",' +
                (b.current / 100).toFixed(2) + ',' +
                (b.days1_30 / 100).toFixed(2) + ',' +
                (b.days31_60 / 100).toFixed(2) + ',' +
                (b.days61_90 / 100).toFixed(2) + ',' +
                (b.days90Plus / 100).toFixed(2) + ',' +
                (b.total / 100).toFixed(2);
            }).join('\n');
          var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
          var link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = 'greenwave-ar-aging-' + asOf + '.csv';
          link.click();
        };
      }

      if (!buckets.length) {
        host.innerHTML = '<div class="card pad" style="text-align:center;color:var(--muted)">No outstanding accounts receivable found as of ' + esc(asOf) + '.</div>';
        return;
      }

      var rows = buckets.map(function (b) {
        return '<tr>' +
          '<td><strong>' + esc(b.customerName || 'Customer') + '</strong></td>' +
          '<td class="mono num">' + money(b.current || 0) + '</td>' +
          '<td class="mono num">' + money(b.days1_30 || 0) + '</td>' +
          '<td class="mono num">' + money(b.days31_60 || 0) + '</td>' +
          '<td class="mono num">' + money(b.days61_90 || 0) + '</td>' +
          '<td class="mono num" style="color:var(--crit)">' + money(b.days90Plus || 0) + '</td>' +
          '<td class="mono num" style="font-weight:700">' + money(b.total || 0) + '</td>' +
          '<td style="text-align:center"><span class="badge">' + num(b.invoiceCount || 0) + ' inv</span></td>' +
        '</tr>';
      }).join('');

      var totalsRow = '<tr style="font-weight:700;background:var(--panel-2)">' +
        '<td>TOTAL RECEIVABLES</td>' +
        '<td class="mono num">' + money(summary.current || 0) + '</td>' +
        '<td class="mono num">' + money(summary.days1_30 || 0) + '</td>' +
        '<td class="mono num">' + money(summary.days31_60 || 0) + '</td>' +
        '<td class="mono num">' + money(summary.days61_90 || 0) + '</td>' +
        '<td class="mono num" style="color:var(--crit)">' + money(summary.days90Plus || 0) + '</td>' +
        '<td class="mono num" style="color:var(--accent)">' + money(summary.total || 0) + '</td>' +
        '<td></td>' +
      '</tr>';

      host.innerHTML =
        '<div class="card"><div class="tablewrap"><table class="table">' +
          '<thead><tr><th>Customer Name</th><th class="num">Current</th><th class="num">1–30 Days</th><th class="num">31–60 Days</th><th class="num">61–90 Days</th><th class="num">90+ Days</th><th class="num">Total Outstanding</th><th style="text-align:center">Invoices</th></tr></thead>' +
          '<tbody>' + rows + totalsRow + '</tbody>' +
        '</table></div></div>';
    }).catch(function (err) {
      host.innerHTML = '<div class="card pad" style="color:var(--crit)">Failed to calculate AR aging: ' + esc(err.message || 'Error') + '</div>';
    });
  }

  // ==========================================================================
  // BANKING & CORPORATE CREDIT CARDS
  // ==========================================================================
  var selectedBankAccountId = null;
  var bankSubTab = 'transactions';
  var bankTxStatus = '';
  var bankTxQ = '';

  function renderBankingView() {
    var cardsHost = $('#bankAccountsContainer');
    var txHost = $('#bankTransactionsBody');
    if (!cardsHost || !txHost) return;

    var btnAdd = $('#btnAddBankAccount');
    if (btnAdd && !btnAdd.dataset.bound) {
      btnAdd.dataset.bound = 'true';
      btnAdd.onclick = function () {
        openModal('Add Financial Account',
          '<div class="field">' +
            '<label>Account Name</label>' +
            '<input type="text" name="name" placeholder="e.g. Operating Checking" required>' +
          '</div>' +
          '<div class="field">' +
            '<label>Account Type</label>' +
            '<select name="type">' +
              '<option value="checking">Checking Account</option>' +
              '<option value="savings">Savings Account</option>' +
              '<option value="credit_card">Corporate Credit Card</option>' +
            '</select>' +
          '</div>' +
          '<div class="formgrid-2">' +
            '<div class="field"><label>Institution Name</label><input type="text" name="institutionName" placeholder="e.g. RBC, TD, Stripe"></div>' +
            '<div class="field"><label>Last 4 Digits</label><input type="text" name="accountNumberLast4" maxlength="4" placeholder="1234"></div>' +
          '</div>' +
          '<div class="formgrid-2">' +
            '<div class="field"><label>Currency</label><select name="currency"><option value="CAD">CAD</option><option value="USD">USD</option></select></div>' +
            '<div class="field"><label>Opening Balance ($)</label><input type="number" step="0.01" name="openingBalance" value="0.00"></div>' +
          '</div>',
          function (fd) {
            return Api.createFinancialAccount(fd).then(function (acc) {
              toast('Financial account added.');
              selectedBankAccountId = acc.id;
              renderBankingView();
            });
          }
        );
      };
    }

    var tabs = $$('#bankTabSelector button');
    tabs.forEach(function (tab) {
      if (!tab.dataset.bound) {
        tab.dataset.bound = 'true';
        tab.onclick = function () {
          tabs.forEach(function (t) { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
          tab.classList.add('active');
          tab.setAttribute('aria-selected', 'true');
          bankSubTab = tab.dataset.bankTab || 'transactions';
          var txFilters = $('#bankTxFilters');
          if (txFilters) txFilters.hidden = (bankSubTab !== 'transactions');
          renderBankingSubTab();
        };
      }
    });

    var sInput = $('#bankTxSearch');
    if (sInput && !sInput.dataset.bound) {
      sInput.dataset.bound = 'true';
      sInput.addEventListener('input', function () {
        bankTxQ = sInput.value.trim().toLowerCase();
        renderBankingSubTab();
      });
    }

    var stFilter = $('#bankTxStatusFilter');
    if (stFilter && !stFilter.dataset.bound) {
      stFilter.dataset.bound = 'true';
      stFilter.addEventListener('change', function () {
        bankTxStatus = stFilter.value;
        renderBankingSubTab();
      });
    }

    Api.listFinancialAccounts().then(function (accounts) {
      accounts = accounts || [];
      var totalCashMinor = 0;
      var totalCreditMinor = 0;

      accounts.forEach(function (a) {
        var bal = Number(a.currentBalanceMinor || 0);
        if (a.type === 'credit_card') totalCreditMinor += bal;
        else totalCashMinor += bal;
      });

      var kCash = $('#kpiBankTotalCash'); if (kCash) kCash.textContent = money(totalCashMinor);
      var kCredit = $('#kpiBankTotalCredit'); if (kCredit) kCredit.textContent = money(totalCreditMinor);
      var kNet = $('#kpiBankNetLiquid'); if (kNet) kNet.textContent = money(totalCashMinor - totalCreditMinor);

      if (!accounts.length) {
        cardsHost.innerHTML = '<div class="card pad" style="text-align:center;color:var(--muted)">No financial accounts set up yet. Click "Add Account" above.</div>';
        txHost.innerHTML = '';
        return;
      }

      if (!selectedBankAccountId || !accounts.some(function (a) { return a.id === selectedBankAccountId; })) {
        selectedBankAccountId = accounts[0].id;
      }

      var cardsHtml = accounts.map(function (a) {
        var isSel = a.id === selectedBankAccountId;
        var typeBadge = a.type === 'credit_card' ? 'Credit Card' : (a.type === 'savings' ? 'Savings' : 'Checking');
        return '<div class="card pad bank-card-item' + (isSel ? ' active-bank-card' : '') + '" data-acc-id="' + esc(a.id) + '" style="cursor:pointer;flex:1;min-width:240px;border:' + (isSel ? '2px solid var(--accent)' : '1px solid var(--line)') + '">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
            '<span style="font-weight:600;font-size:14px">' + esc(a.name) + '</span>' +
            '<span class="badge">' + typeBadge + '</span>' +
          '</div>' +
          '<div style="font-size:12px;color:var(--muted);margin-bottom:8px">' + esc(a.institutionName || 'Bank') + ' · •••• ' + esc(a.accountNumberLast4 || '0000') + ' (' + esc(a.currency || 'CAD') + ')</div>' +
          '<div style="display:flex;justify-content:space-between;align-items:baseline">' +
            '<span style="font-size:11px;color:var(--muted)">GL BALANCE</span>' +
            '<span class="mono" style="font-size:18px;font-weight:700;color:var(--ink)">' + money(a.currentBalanceMinor || 0) + '</span>' +
          '</div>' +
        '</div>';
      }).join('');

      cardsHost.innerHTML = '<div style="display:flex;gap:12px;overflow-x:auto;padding-bottom:6px">' + cardsHtml + '</div>';

      $$('.bank-card-item', cardsHost).forEach(function (card) {
        card.onclick = function () {
          selectedBankAccountId = card.dataset.accId;
          renderBankingView();
        };
      });

      renderBankingSubTab();
    }).catch(function (err) {
      cardsHost.innerHTML = '<div class="card pad" style="color:var(--crit)">Failed to load financial accounts: ' + esc(err.message || 'Error') + '</div>';
    });
  }

  function renderBankingSubTab() {
    var txHost = $('#bankTransactionsBody');
    if (!txHost || !selectedBankAccountId) return;

    if (bankSubTab === 'import') {
      txHost.innerHTML =
        '<div class="card pad">' +
          '<h3>Import Statement (CSV)</h3>' +
          '<p style="color:var(--muted);font-size:13px;margin-bottom:16px">Upload bank or credit card statements in CSV format to synchronize transactions with the general ledger.</p>' +
          '<div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:var(--r);padding:12px 16px;margin-bottom:18px;display:flex;align-items:center;gap:12px">' +
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#16A34A" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>' +
            '<div style="font-size:12.5px;color:#166534">' +
              '<strong>PCI-DSS Safe Masking &amp; Deduplication:</strong> All 13–19 digit payment card numbers are automatically sanitized before storage. Duplicate statement rows are detected and filtered via SHA-256 fingerprinting.' +
            '</div>' +
          '</div>' +
          '<div class="field">' +
            '<label>Select CSV Statement File</label>' +
            '<input type="file" id="bankCsvFileInput" accept=".csv,text/csv">' +
          '</div>' +
          '<div id="bankImportPreviewArea"></div>' +
        '</div>';

      var fileInput = $('#bankCsvFileInput');
      if (fileInput) {
        fileInput.onchange = function (e) {
          var file = e.target.files && e.target.files[0];
          if (!file) return;
          var prevArea = $('#bankImportPreviewArea');
          if (prevArea) prevArea.innerHTML = '<div style="text-align:center;padding:20px"><div class="spin" style="margin:0 auto 8px"></div>Analyzing and parsing statement CSV…</div>';

          Api.previewStatementImport(selectedBankAccountId, file, {}).then(function (prev) {
            if (!prevArea) return;
            var rows = (prev.sampleRows || prev.rows || []).slice(0, 10).map(function (r) {
              return '<tr>' +
                '<td class="mono">' + esc(r.date) + '</td>' +
                '<td>' + esc(r.description) + '</td>' +
                '<td class="mono num" style="color:var(--good)">' + (r.inflowMinor ? money(r.inflowMinor) : '—') + '</td>' +
                '<td class="mono num" style="color:var(--crit)">' + (r.outflowMinor ? money(r.outflowMinor) : '—') + '</td>' +
                '<td class="mono"><small>' + esc((r.dedupeHash || '').slice(0, 10)) + '…</small></td>' +
              '</tr>';
            }).join('');

            prevArea.innerHTML =
              '<div style="margin-top:16px">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
                  '<span style="font-weight:600;font-size:14px">Statement Preview (' + num(prev.totalRows || 0) + ' rows, ' + num(prev.newRowsCount || prev.totalRows || 0) + ' new)</span>' +
                  '<button type="button" class="btn btn-primary" id="btnCommitStatementImport">Commit Import (' + num(prev.newRowsCount || prev.totalRows || 0) + ' Rows)</button>' +
                '</div>' +
                '<div class="tablewrap"><table class="table">' +
                  '<thead><tr><th>Date</th><th>Description</th><th class="num">Inflow</th><th class="num">Outflow</th><th>Hash</th></tr></thead>' +
                  '<tbody>' + rows + '</tbody>' +
                '</table></div>' +
              '</div>';

            var btnCommit = $('#btnCommitStatementImport');
            if (btnCommit) {
              btnCommit.onclick = function () {
                btnCommit.disabled = true;
                btnCommit.innerHTML = '<span class="spin" style="margin-right:6px"></span>Committing…';
                Api.commitStatementImport(prev.batchId).then(function () {
                  toast('Statement imported successfully.');
                  bankSubTab = 'transactions';
                  var tabs = $$('#bankTabSelector button');
                  tabs.forEach(function (t) { t.classList.toggle('active', t.dataset.bankTab === 'transactions'); });
                  renderBankingView();
                }).catch(function (err) {
                  btnCommit.disabled = false;
                  btnCommit.textContent = 'Commit Import';
                  toast(err.message || 'Import failed.');
                });
              };
            }
          }).catch(function (err) {
            if (prevArea) prevArea.innerHTML = '<div style="color:var(--crit);padding:14px">Could not parse CSV: ' + esc(err.message || 'Invalid format') + '</div>';
          });
        };
      }
      return;
    }

    // Transactions tab
    txHost.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted)"><div class="spin" style="margin:0 auto 10px"></div>Loading transactions…</div>';

    Api.listFinancialTransactions({
      accountId: selectedBankAccountId,
      status: bankTxStatus || undefined,
      q: bankTxQ || undefined
    }).then(function (txs) {
      txs = txs || [];
      if (!txs.length) {
        txHost.innerHTML = '<div class="card pad" style="text-align:center;color:var(--muted)">No transactions found for this account.</div>';
        return;
      }

      var rows = txs.map(function (tx) {
        var isInflow = tx.type === 'CREDIT' || (tx.amountMinor > 0 && tx.direction !== 'OUTFLOW');
        var amtFormatted = money(Math.abs(tx.amountMinor));
        var amtCls = isInflow ? 'text-success' : 'text-ink';
        var sign = isInflow ? '+' : '-';

        var catBtn = '<button type="button" class="btn ghost btn-sm btn-categorize" data-tx-id="' + esc(tx.id) + '">Categorize</button>';

        return '<tr>' +
          '<td class="mono">' + ddmmyyyy(tx.transactionDate) + '</td>' +
          '<td><strong>' + esc(tx.payee || tx.description) + '</strong>' + (tx.payee && tx.description ? '<br><small style="color:var(--muted)">' + esc(tx.description) + '</small>' : '') + '</td>' +
          '<td class="mono num ' + amtCls + '" style="font-weight:600">' + sign + amtFormatted + '</td>' +
          '<td>' + (tx.categorizedAccountName ? '<span class="mono">' + esc(tx.categorizedAccountCode || '') + ' ' + esc(tx.categorizedAccountName) + '</span>' : '<span style="color:var(--muted)">Uncategorized</span>') + '</td>' +
          '<td><span class="badge ' + (tx.status === 'RECONCILED' ? 'badge-paid' : 'badge-pending') + '">' + esc(tx.status || 'UNCATEGORIZED') + '</span></td>' +
          '<td style="text-align:right">' + catBtn + '</td>' +
        '</tr>';
      }).join('');

      txHost.innerHTML =
        '<div class="card"><div class="tablewrap"><table class="table">' +
          '<thead><tr><th>Date</th><th>Description / Payee</th><th class="num">Amount</th><th>GL Category</th><th>Status</th><th style="text-align:right">Action</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table></div></div>';

      $$('.btn-categorize', txHost).forEach(function (btn) {
        btn.onclick = function () {
          var txId = btn.dataset.txId;
          Api.listLedgerAccounts().then(function (accounts) {
            var opts = (accounts || []).map(function (a) {
              return '<option value="' + esc(a.id) + '">' + esc(a.code) + ' - ' + esc(a.name) + ' (' + esc(a.classification) + ')</option>';
            }).join('');

            openModal('Categorize Transaction',
              '<div class="field">' +
                '<label>General Ledger Account</label>' +
                '<select name="accountId" required>' + opts + '</select>' +
              '</div>' +
              '<div class="field">' +
                '<label>Memo / Notes</label>' +
                '<input type="text" name="memo" placeholder="Optional categorization notes">' +
              '</div>',
              function (fd) {
                return Api.categorizeTransaction(txId, {
                  accountId: fd.accountId,
                  memo: fd.memo
                }).then(function () {
                  toast('Transaction categorized.');
                  renderBankingSubTab();
                });
              }
            );
          });
        };
      });
    }).catch(function (err) {
      txHost.innerHTML = '<div class="card pad" style="color:var(--crit)">Failed to load transactions: ' + esc(err.message || 'Error') + '</div>';
    });
  }

  // ==========================================================================
  // STATEMENT RECONCILIATION
  // ==========================================================================
  var currentReconSession = null;
  function renderReconciliationView() {
    var acctSelect = $('#reconAccountSelect');
    var dateInput = $('#reconStatementDate');
    var balInput = $('#reconStatementBalance');
    var btnStart = $('#btnStartRecon');
    var worksheet = $('#reconciliationWorksheet');
    var listHost = $('#reconciliationItemsList');
    var btnComplete = $('#btnCompleteReconciliation');
    var btnSelectAll = $('#btnReconSelectAll');

    if (!acctSelect) return;
    if (dateInput && !dateInput.value) dateInput.value = today();

    Api.listFinancialAccounts().then(function (accounts) {
      accounts = accounts || [];
      acctSelect.innerHTML = accounts.map(function (a) {
        return '<option value="' + esc(a.id) + '">' + esc(a.name) + ' (' + esc(a.institutionName || 'Bank') + ' •••• ' + esc(a.accountNumberLast4 || '') + ')</option>';
      }).join('');
    });

    if (btnStart && !btnStart.dataset.bound) {
      btnStart.dataset.bound = 'true';
      btnStart.onclick = function () {
        var acctId = acctSelect.value;
        var stDate = dateInput ? dateInput.value : today();
        var stBalVal = balInput ? parseFloat(balInput.value || '0') : 0;
        if (!acctId) { toast('Please select a financial account.'); return; }
        if (isNaN(stBalVal)) { toast('Please enter a valid statement balance.'); return; }

        if (worksheet) worksheet.hidden = false;
        if (listHost) listHost.innerHTML = '<div style="text-align:center;padding:24px"><div class="spin" style="margin:0 auto 10px"></div>Loading unreconciled items…</div>';

        Api.listFinancialTransactions({ accountId: acctId, limit: 200 }).then(function (txs) {
          txs = (txs || []).filter(function (t) { return t.status !== 'RECONCILED'; });
          currentReconSession = {
            accountId: acctId,
            statementEndingDate: stDate,
            statementEndingBalance: stBalVal,
            statementEndingBalanceMinor: Math.round(stBalVal * 100),
            transactions: txs,
            clearedIds: {}
          };

          function updateWorksheet() {
            var clearedMinor = 0;
            currentReconSession.transactions.forEach(function (t) {
              if (currentReconSession.clearedIds[t.id]) {
                var isCredit = t.type === 'CREDIT' || (t.amountMinor > 0 && t.direction !== 'OUTFLOW');
                if (isCredit) clearedMinor += Math.abs(t.amountMinor);
                else clearedMinor -= Math.abs(t.amountMinor);
              }
            });

            var diffMinor = currentReconSession.statementEndingBalanceMinor - clearedMinor;
            var isBalanced = Math.abs(diffMinor) === 0;

            var kStmt = $('#reconKpiStatement'); if (kStmt) kStmt.textContent = money(currentReconSession.statementEndingBalanceMinor);
            var kClr = $('#reconKpiCleared'); if (kClr) kClr.textContent = money(clearedMinor);
            var kDiff = $('#reconKpiDiff');
            var kSub = $('#reconKpiDiffSub');

            if (kDiff) {
              kDiff.textContent = money(diffMinor);
              kDiff.className = 'kpi-value ' + (isBalanced ? 'text-success' : 'text-crit');
            }
            if (kSub) {
              kSub.textContent = isBalanced ? '✓ Reconciled to $0.00 difference' : 'Difference must equal $0.00 to complete';
            }
            if (btnComplete) {
              btnComplete.disabled = !isBalanced;
            }
          }

          if (!txs.length) {
            if (listHost) listHost.innerHTML = '<div class="card pad" style="text-align:center;color:var(--muted)">No unreconciled transactions for this period.</div>';
            updateWorksheet();
            return;
          }

          var rows = txs.map(function (t) {
            var isCredit = t.type === 'CREDIT' || (t.amountMinor > 0 && t.direction !== 'OUTFLOW');
            var amtCls = isCredit ? 'text-success' : 'text-ink';
            var sign = isCredit ? '+' : '-';

            return '<tr>' +
              '<td style="width:40px;text-align:center"><input type="checkbox" class="recon-chk" data-tx-id="' + esc(t.id) + '"></td>' +
              '<td class="mono">' + ddmmyyyy(t.transactionDate) + '</td>' +
              '<td><strong>' + esc(t.payee || t.description) + '</strong></td>' +
              '<td>' + (t.categorizedAccountName ? '<span class="mono">' + esc(t.categorizedAccountCode || '') + ' ' + esc(t.categorizedAccountName) + '</span>' : '—') + '</td>' +
              '<td class="mono num ' + amtCls + '" style="font-weight:600">' + sign + money(Math.abs(t.amountMinor)) + '</td>' +
            '</tr>';
          }).join('');

          if (listHost) {
            listHost.innerHTML =
              '<div class="card"><div class="tablewrap"><table class="table">' +
                '<thead><tr><th style="text-align:center">Cleared</th><th>Date</th><th>Payee / Description</th><th>Category</th><th class="num">Amount</th></tr></thead>' +
                '<tbody>' + rows + '</tbody>' +
              '</table></div></div>';

            $$('.recon-chk', listHost).forEach(function (chk) {
              chk.onchange = function () {
                currentReconSession.clearedIds[chk.dataset.txId] = chk.checked;
                updateWorksheet();
              };
            });
          }

          if (btnSelectAll) {
            btnSelectAll.onclick = function () {
              var allChecked = Object.keys(currentReconSession.clearedIds).length === currentReconSession.transactions.length;
              $$('.recon-chk', listHost).forEach(function (chk) {
                chk.checked = !allChecked;
                currentReconSession.clearedIds[chk.dataset.txId] = !allChecked;
              });
              updateWorksheet();
            };
          }

          updateWorksheet();
        });
      };
    }

    if (btnComplete && !btnComplete.dataset.bound) {
      btnComplete.dataset.bound = 'true';
      btnComplete.onclick = function () {
        if (!currentReconSession) return;
        btnComplete.disabled = true;
        btnComplete.textContent = 'Posting Reconciliation…';

        var clearedIds = Object.keys(currentReconSession.clearedIds).filter(function (id) {
          return currentReconSession.clearedIds[id];
        });

        Api.startReconciliation({
          accountId: currentReconSession.accountId,
          statementEndingDate: currentReconSession.statementEndingDate,
          statementEndingBalance: currentReconSession.statementEndingBalance
        }).then(function (rec) {
          return Api.completeReconciliation(rec.id, { clearedTransactionIds: clearedIds });
        }).then(function () {
          toast('Reconciliation successfully finalized and posted.');
          btnComplete.textContent = 'Complete Reconciliation';
          renderReconciliationView();
        }).catch(function (err) {
          btnComplete.disabled = false;
          btnComplete.textContent = 'Complete Reconciliation';
          toast(err.message || 'Reconciliation failed.');
        });
      };
    }
  }

  // ==========================================================================
  // ACCOUNTS PAYABLE & BILLS
  // ==========================================================================
  var apSubTab = 'bills';
  var apSearchQ = '';
  function renderPayablesView() {
    var host = $('#payablesBody');
    if (!host) return;

    var tabs = $$('#payablesTabs button');
    tabs.forEach(function (tab) {
      if (!tab.dataset.bound) {
        tab.dataset.bound = 'true';
        tab.onclick = function () {
          tabs.forEach(function (t) { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
          tab.classList.add('active');
          tab.setAttribute('aria-selected', 'true');
          apSubTab = tab.dataset.apTab || 'bills';
          renderPayablesSubTab();
        };
      }
    });

    var sInput = $('#apSearch');
    if (sInput && !sInput.dataset.bound) {
      sInput.dataset.bound = 'true';
      sInput.addEventListener('input', function () {
        apSearchQ = sInput.value.trim().toLowerCase();
        renderPayablesSubTab();
      });
    }

    var btnNew = $('#btnNewBill');
    if (btnNew && !btnNew.dataset.bound) {
      btnNew.dataset.bound = 'true';
      btnNew.onclick = function () {
        Promise.all([
          Api.listVendors(),
          Api.listLedgerAccounts({ classification: 'EXPENSE' })
        ]).then(function (results) {
          var vendors = results[0] || [];
          var accounts = results[1] || [];

          var vendorOpts = vendors.map(function (v) {
            return '<option value="' + esc(v.id) + '">' + esc(v.name) + '</option>';
          }).join('');

          var acctOpts = accounts.map(function (a) {
            return '<option value="' + esc(a.id) + '">' + esc(a.code) + ' - ' + esc(a.name) + '</option>';
          }).join('');

          openModal('New Vendor Bill',
            '<div class="field">' +
              '<label>Vendor</label>' +
              '<select name="vendorId" required>' + vendorOpts + '</select>' +
            '</div>' +
            '<div class="formgrid-2">' +
              '<div class="field"><label>Bill / Invoice #</label><input type="text" name="billNumber" placeholder="INV-001" required></div>' +
              '<div class="field"><label>Total Amount ($)</label><input type="number" step="0.01" min="0.01" name="total" placeholder="0.00" required></div>' +
            '</div>' +
            '<div class="formgrid-2">' +
              '<div class="field"><label>Bill Date</label><input type="date" name="billDate" value="' + today() + '" required></div>' +
              '<div class="field"><label>Due Date</label><input type="date" name="dueDate" value="' + today() + '" required></div>' +
            '</div>' +
            '<div class="field">' +
              '<label>Expense Account</label>' +
              '<select name="expenseAccountId" required>' + acctOpts + '</select>' +
            '</div>' +
            '<div class="field">' +
              '<label>Notes / Memo</label>' +
              '<input type="text" name="notes" placeholder="Optional notes">' +
            '</div>',
            function (fd) {
              var amt = parseFloat(fd.total || '0');
              var payload = {
                vendorId: fd.vendorId,
                billNumber: fd.billNumber,
                billDate: fd.billDate,
                dueDate: fd.dueDate,
                total: amt.toFixed(2),
                currency: 'CAD',
                notes: fd.notes,
                lines: [{
                  description: fd.notes || 'Vendor Bill ' + fd.billNumber,
                  amount: amt.toFixed(2),
                  expenseAccountId: fd.expenseAccountId
                }]
              };
              return Api.createBill(payload).then(function () {
                toast('Vendor bill created.');
                renderPayablesView();
              });
            }
          );
        });
      };
    }

    var btnVendor = $('#btnAddVendor');
    if (btnVendor && !btnVendor.dataset.bound) {
      btnVendor.dataset.bound = 'true';
      btnVendor.onclick = function () {
        openModal('Add Supplier / Vendor',
          '<div class="field"><label>Vendor Name</label><input type="text" name="name" required></div>' +
          '<div class="formgrid-2">' +
            '<div class="field"><label>Email</label><input type="email" name="email"></div>' +
            '<div class="field"><label>Phone</label><input type="tel" name="phone"></div>' +
          '</div>' +
          '<div class="formgrid-2">' +
            '<div class="field"><label>Payment Terms</label><select name="paymentTerms"><option value="net_30">Net 30</option><option value="net_15">Net 15</option><option value="due_on_receipt">Due on Receipt</option></select></div>' +
            '<div class="field"><label>Currency</label><select name="currency"><option value="CAD">CAD</option><option value="USD">USD</option></select></div>' +
          '</div>',
          function (fd) {
            return Api.createVendor(fd).then(function () {
              toast('Vendor added.');
              renderPayablesView();
            });
          }
        );
      };
    }

    // Load AP aging KPIs
    Api.getPayablesAging().then(function (aging) {
      var s = aging.summary || {};
      var kTot = $('#kpiApTotal'); if (kTot) kTot.textContent = money(s.total || 0);
      var kOver = $('#kpiApOverdue'); if (kOver) kOver.textContent = money((s.days1_30 || 0) + (s.days31_60 || 0) + (s.days61_90 || 0) + (s.days90Plus || 0));
    }).catch(function () {});

    renderPayablesSubTab();
  }

  function renderPayablesSubTab() {
    var host = $('#payablesBody');
    if (!host) return;

    if (apSubTab === 'vendors') {
      host.innerHTML = '<div style="text-align:center;padding:24px"><div class="spin" style="margin:0 auto 10px"></div>Loading vendors…</div>';
      Api.listVendors().then(function (vendors) {
        vendors = vendors || [];
        var kCount = $('#kpiApVendorsCount'); if (kCount) kCount.textContent = num(vendors.length);
        if (!vendors.length) {
          host.innerHTML = '<div class="card pad" style="text-align:center;color:var(--muted)">No vendors found. Click "Add Vendor" above.</div>';
          return;
        }

        var rows = vendors.map(function (v) {
          return '<tr>' +
            '<td><strong>' + esc(v.name) + '</strong></td>' +
            '<td>' + esc(v.email || '—') + '</td>' +
            '<td>' + esc(v.phone || '—') + '</td>' +
            '<td><span class="badge">' + esc(v.paymentTerms || 'net_30') + '</span></td>' +
            '<td>' + esc(v.currency || 'CAD') + '</td>' +
            '<td><span class="badge ' + (v.isActive !== false ? 'badge-paid' : 'badge-failed') + '">' + (v.isActive !== false ? 'ACTIVE' : 'INACTIVE') + '</span></td>' +
          '</tr>';
        }).join('');

        host.innerHTML =
          '<div class="card"><div class="tablewrap"><table class="table">' +
            '<thead><tr><th>Vendor Name</th><th>Email</th><th>Phone</th><th>Terms</th><th>Currency</th><th>Status</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table></div></div>';
      });
      return;
    }

    if (apSubTab === 'aging') {
      host.innerHTML = '<div style="text-align:center;padding:24px"><div class="spin" style="margin:0 auto 10px"></div>Calculating AP aging…</div>';
      Api.getPayablesAging().then(function (res) {
        var buckets = res.buckets || [];
        if (!buckets.length) {
          host.innerHTML = '<div class="card pad" style="text-align:center;color:var(--muted)">No accounts payable balances currently due.</div>';
          return;
        }

        var rows = buckets.map(function (b) {
          return '<tr>' +
            '<td><strong>' + esc(b.vendorName) + '</strong></td>' +
            '<td class="mono num">' + money(b.current || 0) + '</td>' +
            '<td class="mono num">' + money(b.days1_30 || 0) + '</td>' +
            '<td class="mono num">' + money(b.days31_60 || 0) + '</td>' +
            '<td class="mono num">' + money(b.days61_90 || 0) + '</td>' +
            '<td class="mono num" style="color:var(--crit)">' + money(b.days90Plus || 0) + '</td>' +
            '<td class="mono num" style="font-weight:700">' + money(b.total || 0) + '</td>' +
          '</tr>';
        }).join('');

        host.innerHTML =
          '<div class="card"><div class="tablewrap"><table class="table">' +
            '<thead><tr><th>Vendor</th><th class="num">Current</th><th class="num">1–30 Days</th><th class="num">31–60 Days</th><th class="num">61–90 Days</th><th class="num">90+ Days</th><th class="num">Total AP</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table></div></div>';
      });
      return;
    }

    // Bills tab
    host.innerHTML = '<div style="text-align:center;padding:24px"><div class="spin" style="margin:0 auto 10px"></div>Loading bills…</div>';
    Api.listBills({ q: apSearchQ || undefined }).then(function (bills) {
      // GET /payables/bills is paginated ({ page, pageSize, total, items }).
      bills = Array.isArray(bills) ? bills : ((bills && bills.items) || []);
      var pendingCount = bills.filter(function (b) { return b.status === 'PENDING_APPROVAL'; }).length;
      var kPend = $('#kpiApPending'); if (kPend) kPend.textContent = num(pendingCount);

      if (!bills.length) {
        host.innerHTML = '<div class="card pad" style="text-align:center;color:var(--muted)">No bills recorded. Click "New Bill" to enter a supplier invoice.</div>';
        return;
      }

      var rows = bills.map(function (b) {
        var statusCls = 'badge-pending';
        if (b.status === 'PAID') statusCls = 'badge-paid';
        else if (b.status === 'APPROVED') statusCls = 'badge-received';
        else if (b.status === 'VOID') statusCls = 'badge-failed';

        var actBtns = '';
        if (isAdmin() && b.status === 'PENDING_APPROVAL') {
          actBtns += '<button type="button" class="btn ghost btn-sm btn-approve-bill" data-bill-id="' + esc(b.id) + '">Approve</button> ';
        }
        if (isAdmin() && b.status !== 'PAID' && b.status !== 'VOID') {
          actBtns += '<button type="button" class="btn ghost btn-sm btn-void-bill" data-bill-id="' + esc(b.id) + '">Void</button>';
        }

        return '<tr>' +
          '<td class="mono"><strong>' + esc(b.billNumber) + '</strong></td>' +
          '<td>' + esc(b.vendor ? b.vendor.name : 'Supplier') + '</td>' +
          '<td class="mono">' + ddmmyyyy(b.billDate) + '</td>' +
          '<td class="mono">' + ddmmyyyy(b.dueDate) + '</td>' +
          '<td class="mono num" style="font-weight:600">' + moneyDollars(b.total) + '</td>' +
          '<td class="mono num">' + moneyDollars(b.balanceDue || b.total) + '</td>' +
          '<td><span class="badge ' + statusCls + '">' + esc(b.status) + '</span></td>' +
          '<td style="text-align:right">' + actBtns + '</td>' +
        '</tr>';
      }).join('');

      host.innerHTML =
        '<div class="card"><div class="tablewrap"><table class="table">' +
          '<thead><tr><th>Bill #</th><th>Vendor</th><th>Bill Date</th><th>Due Date</th><th class="num">Total</th><th class="num">Balance Due</th><th>Status</th><th style="text-align:right">Actions</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table></div></div>';

      $$('.btn-approve-bill', host).forEach(function (btn) {
        btn.onclick = function () {
          Api.approveBill(btn.dataset.billId).then(function () {
            toast('Bill approved for payment.');
            renderPayablesSubTab();
          });
        };
      });

      $$('.btn-void-bill', host).forEach(function (btn) {
        btn.onclick = function () {
          if (!confirm('Are you sure you want to void this bill?')) return;
          Api.voidBill(btn.dataset.billId).then(function () {
            toast('Bill voided.');
            renderPayablesSubTab();
          });
        };
      });
    });
  }

  // ==========================================================================
  // CHART OF ACCOUNTS
  // ==========================================================================
  var coaFilterType = 'all';
  function renderChartOfAccountsView() {
    var host = $('#chartOfAccountsBody');
    if (!host) return;

    var tabs = $$('#coaTabs button');
    tabs.forEach(function (tab) {
      if (!tab.dataset.bound) {
        tab.dataset.bound = 'true';
        tab.onclick = function () {
          tabs.forEach(function (t) { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
          tab.classList.add('active');
          tab.setAttribute('aria-selected', 'true');
          coaFilterType = tab.dataset.coaTab || 'all';
          renderChartOfAccountsView();
        };
      }
    });

    var btnNew = $('#btnNewCoaAccount');
    if (btnNew && !btnNew.dataset.bound) {
      btnNew.dataset.bound = 'true';
      btnNew.onclick = function () {
        openModal('Add Ledger Account',
          '<div class="formgrid-2">' +
            '<div class="field"><label>Account Code</label><input type="text" name="code" placeholder="e.g. 1020, 5030" required></div>' +
            '<div class="field"><label>Classification</label><select name="classification">' +
              '<option value="ASSET">ASSET (1000s)</option>' +
              '<option value="LIABILITY">LIABILITY (2000s)</option>' +
              '<option value="EQUITY">EQUITY (3000s)</option>' +
              '<option value="REVENUE">REVENUE (4000s)</option>' +
              '<option value="EXPENSE">EXPENSE (5000s)</option>' +
            '</select></div>' +
          '</div>' +
          '<div class="field"><label>Account Name</label><input type="text" name="name" placeholder="e.g. Card Clearing Account" required></div>' +
          '<div class="formgrid-2">' +
            '<div class="field"><label>Normal Balance</label><select name="normalBalance"><option value="DEBIT">Debit</option><option value="CREDIT">Credit</option></select></div>' +
            '<div class="field"><label>Currency</label><select name="currency"><option value="CAD">CAD</option><option value="USD">USD</option></select></div>' +
          '</div>' +
          '<div class="field"><label>Description</label><input type="text" name="description" placeholder="Optional description"></div>',
          function (fd) {
            return Api.createLedgerAccount(fd).then(function () {
              toast('Chart of accounts updated.');
              renderChartOfAccountsView();
            });
          }
        );
      };
    }

    host.innerHTML = '<div style="text-align:center;padding:24px"><div class="spin" style="margin:0 auto 10px"></div>Loading chart of accounts…</div>';

    Api.listLedgerAccounts().then(function (accounts) {
      accounts = accounts || [];

      var assetSum = 0, liabSum = 0, eqSum = 0, revSum = 0, expSum = 0;
      accounts.forEach(function (a) {
        var bal = Number(a.currentBalanceMinor || 0);
        if (a.classification === 'ASSET') assetSum += bal;
        else if (a.classification === 'LIABILITY') liabSum += bal;
        else if (a.classification === 'EQUITY') eqSum += bal;
        else if (a.classification === 'REVENUE') revSum += bal;
        else if (a.classification === 'EXPENSE') expSum += bal;
      });

      var kA = $('#kpiCoaAssets'); if (kA) kA.textContent = money(assetSum);
      var kL = $('#kpiCoaLiabilities'); if (kL) kL.textContent = money(liabSum);
      var kE = $('#kpiCoaEquity'); if (kE) kE.textContent = money(eqSum);
      var kR = $('#kpiCoaNetRevenue'); if (kR) kR.textContent = money(revSum - expSum);

      var filtered = accounts.filter(function (a) {
        if (coaFilterType === 'all') return true;
        return a.classification === coaFilterType;
      });

      if (!filtered.length) {
        host.innerHTML = '<div class="card pad" style="text-align:center;color:var(--muted)">No accounts found in this category.</div>';
        return;
      }

      var rows = filtered.map(function (a) {
        return '<tr>' +
          '<td class="mono"><strong>' + esc(a.code) + '</strong></td>' +
          '<td>' + esc(a.name) + (a.description ? '<br><small style="color:var(--muted)">' + esc(a.description) + '</small>' : '') + '</td>' +
          '<td><span class="badge">' + esc(a.classification) + '</span></td>' +
          '<td class="mono"><small>' + esc(a.normalBalance) + '</small></td>' +
          '<td class="mono num" style="font-weight:600">' + money(a.currentBalanceMinor || 0) + '</td>' +
          '<td><span class="badge ' + (a.isActive !== false ? 'badge-paid' : 'badge-failed') + '">' + (a.isActive !== false ? 'ACTIVE' : 'ARCHIVED') + '</span></td>' +
        '</tr>';
      }).join('');

      host.innerHTML =
        '<div class="card"><div class="tablewrap"><table class="table">' +
          '<thead><tr><th>Code</th><th>Account Name</th><th>Classification</th><th>Normal</th><th class="num">GL Balance</th><th>Status</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table></div></div>';
    }).catch(function (err) {
      host.innerHTML = '<div class="card pad" style="color:var(--crit)">Failed to load Chart of Accounts: ' + esc(err.message || 'Error') + '</div>';
    });
  }

  // ==========================================================================
  // GENERAL LEDGER & JOURNAL
  // ==========================================================================
  function renderGeneralLedgerView() {
    var host = $('#generalLedgerBody');
    if (!host) return;

    var btnFilter = $('#btnFilterGl');
    if (btnFilter && !btnFilter.dataset.bound) {
      btnFilter.dataset.bound = 'true';
      btnFilter.onclick = function () { renderGeneralLedgerView(); };
    }

    var btnNew = $('#btnNewJournalEntry');
    if (btnNew && !btnNew.dataset.bound) {
      btnNew.dataset.bound = 'true';
      btnNew.onclick = function () {
        Api.listLedgerAccounts().then(function (accounts) {
          var opts = (accounts || []).map(function (a) {
            return '<option value="' + esc(a.id) + '">' + esc(a.code) + ' - ' + esc(a.name) + '</option>';
          }).join('');

          openModal('New Journal Entry',
            '<div class="formgrid-2">' +
              '<div class="field"><label>Date</label><input type="date" name="entryDate" value="' + today() + '" required></div>' +
              '<div class="field"><label>Reference</label><input type="text" name="reference" placeholder="e.g. ADJ-001"></div>' +
            '</div>' +
            '<div class="field"><label>Memo</label><input type="text" name="memo" placeholder="Journal entry description" required></div>' +
            '<div style="font-weight:600;margin:14px 0 8px;font-size:13px">DEBIT LINE (LINE 1)</div>' +
            '<div class="formgrid-2">' +
              '<div class="field"><label>Account (Debit)</label><select name="debitAccountId" required>' + opts + '</select></div>' +
              '<div class="field"><label>Amount ($)</label><input type="number" step="0.01" min="0.01" name="debitAmount" placeholder="0.00" required></div>' +
            '</div>' +
            '<div style="font-weight:600;margin:14px 0 8px;font-size:13px">CREDIT LINE (LINE 2)</div>' +
            '<div class="formgrid-2">' +
              '<div class="field"><label>Account (Credit)</label><select name="creditAccountId" required>' + opts + '</select></div>' +
              '<div class="field"><label>Amount ($)</label><input type="number" step="0.01" min="0.01" name="creditAmount" placeholder="0.00" required></div>' +
            '</div>',
            function (fd) {
              var dAmt = parseFloat(fd.debitAmount || '0');
              var cAmt = parseFloat(fd.creditAmount || '0');
              if (Math.abs(dAmt - cAmt) > 0.001) {
                toast('Journal entries must balance: Debits ($' + dAmt.toFixed(2) + ') must equal Credits ($' + cAmt.toFixed(2) + ').');
                return Promise.reject();
              }
              var payload = {
                entryDate: fd.entryDate,
                memo: fd.memo,
                reference: fd.reference,
                lines: [
                  { accountId: fd.debitAccountId, type: 'DEBIT', amount: dAmt.toFixed(2), description: fd.memo },
                  { accountId: fd.creditAccountId, type: 'CREDIT', amount: cAmt.toFixed(2), description: fd.memo }
                ]
              };
              return Api.createJournalEntry(payload).then(function (entry) {
                return Api.postJournalEntry(entry.id);
              }).then(function () {
                toast('Journal entry posted to General Ledger.');
                renderGeneralLedgerView();
              });
            }
          );
        });
      };
    }

    host.innerHTML = '<div style="text-align:center;padding:24px"><div class="spin" style="margin:0 auto 10px"></div>Loading journal records…</div>';

    var sDate = $('#glStartDate') ? $('#glStartDate').value : undefined;
    var eDate = $('#glEndDate') ? $('#glEndDate').value : undefined;
    var q = $('#glSearch') ? $('#glSearch').value.trim() : undefined;

    Api.listJournalEntries({ startDate: sDate || undefined, endDate: eDate || undefined, q: q || undefined }).then(function (entries) {
      entries = entries || [];
      if (!entries.length) {
        host.innerHTML = '<div class="card pad" style="text-align:center;color:var(--muted)">No journal entries found for this period.</div>';
        return;
      }

      var rows = entries.map(function (e) {
        var linesHtml = (e.lines || []).map(function (l) {
          return '<tr style="background:var(--panel-2);font-size:12.5px">' +
            '<td style="padding-left:36px" class="mono">' + esc(l.accountCode || '') + ' ' + esc(l.accountName || 'Account') + '</td>' +
            '<td>' + esc(l.description || '') + '</td>' +
            '<td class="mono num">' + (l.type === 'DEBIT' ? money(l.amountMinor) : '—') + '</td>' +
            '<td class="mono num">' + (l.type === 'CREDIT' ? money(l.amountMinor) : '—') + '</td>' +
            '<td></td>' +
          '</tr>';
        }).join('');

        return '<tr>' +
          '<td class="mono"><strong>' + esc(e.entryNumber) + '</strong></td>' +
          '<td class="mono">' + ddmmyyyy(e.entryDate) + '</td>' +
          '<td>' + esc(e.memo) + (e.reference ? ' <small style="color:var(--muted)">(' + esc(e.reference) + ')</small>' : '') + '</td>' +
          '<td class="mono num" style="font-weight:600">' + money(e.totalDebitMinor || 0) + '</td>' +
          '<td class="mono num" style="font-weight:600">' + money(e.totalCreditMinor || 0) + '</td>' +
          '<td><span class="badge ' + (e.status === 'POSTED' ? 'badge-paid' : 'badge-pending') + '">' + esc(e.status) + '</span></td>' +
        '</tr>' + linesHtml;
      }).join('');

      host.innerHTML =
        '<div class="card"><div class="tablewrap"><table class="table">' +
          '<thead><tr><th>Entry #</th><th>Date</th><th>Memo / Details</th><th class="num">Debits</th><th class="num">Credits</th><th>Status</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table></div></div>';
    }).catch(function (err) {
      host.innerHTML = '<div class="card pad" style="color:var(--crit)">Failed to load General Ledger: ' + esc(err.message || 'Error') + '</div>';
    });
  }

  // ==========================================================================
  // FINANCIAL REPORTS: PROFIT & LOSS AND BALANCE SHEET
  // ==========================================================================
  function renderProfitLossView() {
    var host = $('#profitLossBody');
    if (!host) return;

    var sInput = $('#plStartDate');
    var eInput = $('#plEndDate');
    var preset = $('#plPreset');

    if (preset && !preset.dataset.bound) {
      preset.dataset.bound = 'true';
      preset.onchange = function () {
        var p = preset.value;
        var now = new Date();
        var y = now.getFullYear();
        var m = now.getMonth();
        if (p === 'this_month') {
          sInput.value = new Date(y, m, 1).toISOString().slice(0, 10);
          eInput.value = new Date(y, m + 1, 0).toISOString().slice(0, 10);
        } else if (p === 'last_month') {
          sInput.value = new Date(y, m - 1, 1).toISOString().slice(0, 10);
          eInput.value = new Date(y, m, 0).toISOString().slice(0, 10);
        } else if (p === 'ytd') {
          sInput.value = new Date(y, 0, 1).toISOString().slice(0, 10);
          eInput.value = now.toISOString().slice(0, 10);
        }
        renderProfitLossView();
      };
    }

    if (!sInput.value) sInput.value = new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
    if (!eInput.value) eInput.value = today();

    var btnApply = $('#btnApplyPL');
    if (btnApply && !btnApply.dataset.bound) {
      btnApply.dataset.bound = 'true';
      btnApply.onclick = function () { renderProfitLossView(); };
    }

    var btnPrint = $('#btnPrintPL');
    if (btnPrint && !btnPrint.dataset.bound) {
      btnPrint.dataset.bound = 'true';
      btnPrint.onclick = function () { window.print(); };
    }

    host.innerHTML = '<div style="text-align:center;padding:24px"><div class="spin" style="margin:0 auto 10px"></div>Computing Profit &amp; Loss statement…</div>';

    Api.getProfitAndLoss({ startDate: sInput.value, endDate: eInput.value }).then(function (pl) {
      var revRows = (pl.revenueLines || []).map(function (l) {
        return '<tr><td style="padding-left:24px">' + esc(l.accountName) + '</td><td class="mono num">' + money(l.amountMinor) + '</td></tr>';
      }).join('') || '<tr><td style="padding-left:24px;color:var(--muted)">No revenue recorded</td><td class="mono num">$0.00</td></tr>';

      var cogsRows = (pl.cogsLines || []).map(function (l) {
        return '<tr><td style="padding-left:24px">' + esc(l.accountName) + '</td><td class="mono num">' + money(l.amountMinor) + '</td></tr>';
      }).join('') || '<tr><td style="padding-left:24px;color:var(--muted)">No COGS recorded</td><td class="mono num">$0.00</td></tr>';

      var expRows = (pl.expenseLines || []).map(function (l) {
        return '<tr><td style="padding-left:24px">' + esc(l.accountName) + '</td><td class="mono num">' + money(l.amountMinor) + '</td></tr>';
      }).join('') || '<tr><td style="padding-left:24px;color:var(--muted)">No operating expenses recorded</td><td class="mono num">$0.00</td></tr>';

      var grossMargin = pl.totalRevenueMinor > 0 ? ((pl.grossProfitMinor / pl.totalRevenueMinor) * 100).toFixed(1) + '%' : '0.0%';

      host.innerHTML =
        '<div class="card" style="max-width:800px;margin:0 auto;padding:24px 32px">' +
          '<div style="text-align:center;border-bottom:1px solid var(--line);padding-bottom:16px;margin-bottom:20px">' +
            '<h2 style="margin-bottom:4px">GreenWave Recycling Inc.</h2>' +
            '<div style="font-size:16px;font-weight:600;color:var(--ink)">Statement of Profit and Loss (Income Statement)</div>' +
            '<div style="font-size:13px;color:var(--muted)">Period: ' + esc(sInput.value) + ' to ' + esc(eInput.value) + ' · Currency: CAD</div>' +
          '</div>' +
          '<table class="table" style="font-size:14px">' +
            '<tbody>' +
              '<tr style="font-weight:700;background:var(--panel-2)"><td>OPERATING REVENUE</td><td class="num"></td></tr>' +
              revRows +
              '<tr style="font-weight:700"><td>Total Operating Revenue</td><td class="mono num">' + money(pl.totalRevenueMinor || 0) + '</td></tr>' +
              '<tr><td colspan="2" style="height:12px;border:0"></td></tr>' +
              '<tr style="font-weight:700;background:var(--panel-2)"><td>COST OF GOODS SOLD (COGS)</td><td class="num"></td></tr>' +
              cogsRows +
              '<tr style="font-weight:700"><td>Total Cost of Goods Sold</td><td class="mono num">' + money(pl.totalCogsMinor || 0) + '</td></tr>' +
              '<tr><td colspan="2" style="height:12px;border:0"></td></tr>' +
              '<tr style="font-weight:700;background:#F0FDF4;font-size:15px"><td>GROSS PROFIT (Gross Margin ' + grossMargin + ')</td><td class="mono num" style="color:var(--good)">' + money(pl.grossProfitMinor || 0) + '</td></tr>' +
              '<tr><td colspan="2" style="height:12px;border:0"></td></tr>' +
              '<tr style="font-weight:700;background:var(--panel-2)"><td>OPERATING EXPENSES</td><td class="num"></td></tr>' +
              expRows +
              '<tr style="font-weight:700"><td>Total Operating Expenses</td><td class="mono num">' + money(pl.totalExpensesMinor || 0) + '</td></tr>' +
              '<tr><td colspan="2" style="height:12px;border:0"></td></tr>' +
              '<tr style="font-weight:700;background:#EBF5FF;font-size:16px;border-top:2px solid var(--accent)"><td>NET OPERATING INCOME</td><td class="mono num" style="color:var(--accent)">' + money(pl.netIncomeMinor || 0) + '</td></tr>' +
            '</tbody>' +
          '</table>' +
        '</div>';
    }).catch(function (err) {
      host.innerHTML = '<div class="card pad" style="color:var(--crit)">Failed to compute Profit &amp; Loss: ' + esc(err.message || 'Error') + '</div>';
    });
  }

  function renderBalanceSheetView() {
    var host = $('#balanceSheetBody');
    if (!host) return;

    var asOfInput = $('#bsAsOfDate');
    if (asOfInput && !asOfInput.value) asOfInput.value = today();

    var btnApply = $('#btnApplyBS');
    if (btnApply && !btnApply.dataset.bound) {
      btnApply.dataset.bound = 'true';
      btnApply.onclick = function () { renderBalanceSheetView(); };
    }

    var btnPrint = $('#btnPrintBS');
    if (btnPrint && !btnPrint.dataset.bound) {
      btnPrint.dataset.bound = 'true';
      btnPrint.onclick = function () { window.print(); };
    }

    host.innerHTML = '<div style="text-align:center;padding:24px"><div class="spin" style="margin:0 auto 10px"></div>Computing Balance Sheet…</div>';

    Api.getBalanceSheet({ asOfDate: asOfInput ? asOfInput.value : today() }).then(function (bs) {
      var assetRows = (bs.assetLines || []).map(function (l) {
        return '<tr><td style="padding-left:24px">' + esc(l.accountName) + '</td><td class="mono num">' + money(l.amountMinor) + '</td></tr>';
      }).join('') || '<tr><td style="padding-left:24px;color:var(--muted)">None</td><td class="mono num">$0.00</td></tr>';

      var liabRows = (bs.liabilityLines || []).map(function (l) {
        return '<tr><td style="padding-left:24px">' + esc(l.accountName) + '</td><td class="mono num">' + money(l.amountMinor) + '</td></tr>';
      }).join('') || '<tr><td style="padding-left:24px;color:var(--muted)">None</td><td class="mono num">$0.00</td></tr>';

      var eqRows = (bs.equityLines || []).map(function (l) {
        return '<tr><td style="padding-left:24px">' + esc(l.accountName) + '</td><td class="mono num">' + money(l.amountMinor) + '</td></tr>';
      }).join('') || '<tr><td style="padding-left:24px;color:var(--muted)">None</td><td class="mono num">$0.00</td></tr>';

      var isBalanced = (bs.totalAssetsMinor === (bs.totalLiabilitiesMinor + bs.totalEquityMinor));

      host.innerHTML =
        '<div class="card" style="max-width:800px;margin:0 auto;padding:24px 32px">' +
          '<div style="text-align:center;border-bottom:1px solid var(--line);padding-bottom:16px;margin-bottom:20px">' +
            '<h2 style="margin-bottom:4px">GreenWave Recycling Inc.</h2>' +
            '<div style="font-size:16px;font-weight:600;color:var(--ink)">Statement of Financial Position (Balance Sheet)</div>' +
            '<div style="font-size:13px;color:var(--muted)">As of: ' + esc(asOfInput ? asOfInput.value : today()) + ' · Currency: CAD</div>' +
            '<div style="margin-top:8px"><span class="badge ' + (isBalanced ? 'badge-paid' : 'badge-failed') + '">' + (isBalanced ? '✓ Equation Balanced (Assets = Liabilities + Equity)' : 'Equation Imbalance') + '</span></div>' +
          '</div>' +
          '<table class="table" style="font-size:14px">' +
            '<tbody>' +
              '<tr style="font-weight:700;background:var(--panel-2)"><td>ASSETS</td><td class="num"></td></tr>' +
              assetRows +
              '<tr style="font-weight:700;border-top:1px solid var(--line)"><td>TOTAL ASSETS</td><td class="mono num" style="color:var(--good)">' + money(bs.totalAssetsMinor || 0) + '</td></tr>' +
              '<tr><td colspan="2" style="height:14px;border:0"></td></tr>' +
              '<tr style="font-weight:700;background:var(--panel-2)"><td>LIABILITIES</td><td class="num"></td></tr>' +
              liabRows +
              '<tr style="font-weight:700;border-top:1px solid var(--line)"><td>TOTAL LIABILITIES</td><td class="mono num" style="color:var(--crit)">' + money(bs.totalLiabilitiesMinor || 0) + '</td></tr>' +
              '<tr><td colspan="2" style="height:14px;border:0"></td></tr>' +
              '<tr style="font-weight:700;background:var(--panel-2)"><td>EQUITY &amp; RETAINED EARNINGS</td><td class="num"></td></tr>' +
              eqRows +
              '<tr style="font-weight:700;border-top:1px solid var(--line)"><td>TOTAL EQUITY</td><td class="mono num">' + money(bs.totalEquityMinor || 0) + '</td></tr>' +
              '<tr><td colspan="2" style="height:14px;border:0"></td></tr>' +
              '<tr style="font-weight:700;background:#EBF5FF;font-size:15px;border-top:2px solid var(--accent)"><td>TOTAL LIABILITIES &amp; SHAREHOLDERS’ EQUITY</td><td class="mono num" style="color:var(--accent)">' + money((bs.totalLiabilitiesMinor || 0) + (bs.totalEquityMinor || 0)) + '</td></tr>' +
            '</tbody>' +
          '</table>' +
        '</div>';
    }).catch(function (err) {
      host.innerHTML = '<div class="card pad" style="color:var(--crit)">Failed to compute Balance Sheet: ' + esc(err.message || 'Error') + '</div>';
    });
  }

  // ==========================================================================
  // EMPLOYEE OPERATIONS, ATTENDANCE & LEAVE
  // ==========================================================================
  var empDeptFilter = 'all';
  var empSearchQ = '';
  function renderEmployeesView() {
    var host = $('#employeesBody');
    if (!host) return;

    var tabs = $$('#empDeptTabs button');
    tabs.forEach(function (tab) {
      if (!tab.dataset.bound) {
        tab.dataset.bound = 'true';
        tab.onclick = function () {
          tabs.forEach(function (t) { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
          tab.classList.add('active');
          tab.setAttribute('aria-selected', 'true');
          empDeptFilter = tab.dataset.empDept || 'all';
          renderEmployeesView();
        };
      }
    });

    var sInput = $('#empSearch');
    if (sInput && !sInput.dataset.bound) {
      sInput.dataset.bound = 'true';
      sInput.addEventListener('input', function () {
        empSearchQ = sInput.value.trim().toLowerCase();
        renderEmployeesView();
      });
    }

    var btnAdd = $('#btnAddEmployee');
    if (btnAdd && !btnAdd.dataset.bound) {
      btnAdd.dataset.bound = 'true';
      btnAdd.onclick = function () {
        var whOpts = (warehouses || []).map(function (w) {
          return '<option value="' + esc(w.id) + '">' + esc(w.name) + '</option>';
        }).join('');

        openModal('Add Team Member',
          '<div class="formgrid-2">' +
            '<div class="field"><label>First Name</label><input type="text" name="firstName" required></div>' +
            '<div class="field"><label>Last Name</label><input type="text" name="lastName" required></div>' +
          '</div>' +
          '<div class="field"><label>Work Email</label><input type="email" name="email" required></div>' +
          '<div class="formgrid-2">' +
            '<div class="field"><label>Job Title</label><input type="text" name="jobTitle" placeholder="e.g. Lead Sorter, Driver" required></div>' +
            '<div class="field"><label>Department</label><select name="department"><option value="Operations">Operations</option><option value="Logistics">Logistics</option><option value="Administration">Administration</option><option value="Sales">Sales</option></select></div>' +
          '</div>' +
          '<div class="formgrid-2">' +
            '<div class="field"><label>Employment Type</label><select name="employmentType"><option value="full_time">Full-Time</option><option value="part_time">Part-Time</option><option value="contractor">Contractor</option></select></div>' +
            '<div class="field"><label>Facility</label><select name="warehouseId"><option value="">Company-Wide</option>' + whOpts + '</select></div>' +
          '</div>' +
          '<div class="field"><label>Start Date</label><input type="date" name="startDate" value="' + today() + '" required></div>',
          function (fd) {
            return Api.createEmployee(fd).then(function () {
              toast('Employee profile registered.');
              renderEmployeesView();
            });
          }
        );
      };
    }

    host.innerHTML = '<div style="text-align:center;padding:24px"><div class="spin" style="margin:0 auto 10px"></div>Loading employee directory…</div>';

    Api.listEmployees({ department: empDeptFilter === 'all' ? undefined : empDeptFilter, q: empSearchQ || undefined }).then(function (employees) {
      employees = employees || [];

      var kTot = $('#kpiEmpTotal'); if (kTot) kTot.textContent = num(employees.length);
      var actCount = employees.filter(function (e) { return e.status === 'active'; }).length;
      var kAct = $('#kpiEmpActive'); if (kAct) kAct.textContent = num(actCount);
      var opsCount = employees.filter(function (e) { return e.department === 'Operations' || e.department === 'Logistics'; }).length;
      var kOps = $('#kpiEmpOps'); if (kOps) kOps.textContent = num(opsCount);
      var offCount = employees.filter(function (e) { return e.department === 'Administration' || e.department === 'Sales'; }).length;
      var kOff = $('#kpiEmpOffice'); if (kOff) kOff.textContent = num(offCount);

      if (!employees.length) {
        host.innerHTML = '<div class="card pad" style="text-align:center;color:var(--muted)">No employee records found. Click "Add Employee" above.</div>';
        return;
      }

      var rows = employees.map(function (e) {
        var wName = e.warehouseId ? warehouseName(e.warehouseId) : 'All Facilities';
        return '<tr>' +
          '<td><strong>' + esc(e.firstName + ' ' + e.lastName) + '</strong></td>' +
          '<td>' + esc(e.jobTitle || 'Team Member') + '</td>' +
          '<td><span class="badge">' + esc(e.department || 'Operations') + '</span></td>' +
          '<td>' + esc((e.employmentType || 'full_time').replace('_', ' ')) + '</td>' +
          '<td>' + esc(wName) + '</td>' +
          '<td>' + esc(e.email) + '</td>' +
          '<td><span class="badge ' + (e.status === 'active' ? 'badge-paid' : 'badge-failed') + '">' + esc((e.status || 'active').toUpperCase()) + '</span></td>' +
        '</tr>';
      }).join('');

      host.innerHTML =
        '<div class="card"><div class="tablewrap"><table class="table">' +
          '<thead><tr><th>Name</th><th>Title</th><th>Department</th><th>Type</th><th>Facility</th><th>Email</th><th>Status</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table></div></div>';
    }).catch(function (err) {
      host.innerHTML = '<div class="card pad" style="color:var(--crit)">Failed to load employees: ' + esc(err.message || 'Error') + '</div>';
    });
  }

  function renderAttendanceView() {
    var host = $('#attendanceBody');
    if (!host) return;

    var dInput = $('#attDateFilter');
    if (dInput && !dInput.value) dInput.value = today();

    var btnRef = $('#btnRefreshAttendance');
    if (btnRef && !btnRef.dataset.bound) {
      btnRef.dataset.bound = 'true';
      btnRef.onclick = function () { renderAttendanceView(); };
    }

    host.innerHTML = '<div style="text-align:center;padding:24px"><div class="spin" style="margin:0 auto 10px"></div>Loading attendance records…</div>';

    var date = dInput ? dInput.value : today();
    Api.listAttendance({ date: date }).then(function (records) {
      records = records || [];

      var presCount = records.filter(function (r) { return r.status === 'PRESENT' || !r.clockOut; }).length;
      var kPres = $('#kpiAttPresent'); if (kPres) kPres.textContent = num(presCount);

      var totHours = 0;
      var otHours = 0;
      records.forEach(function (r) {
        totHours += Number(r.hoursWorked || 0);
        otHours += Number(r.overtimeHours || 0);
      });
      var kH = $('#kpiAttHours'); if (kH) kH.textContent = totHours.toFixed(1) + 'h';
      var kOT = $('#kpiAttOvertime'); if (kOT) kOT.textContent = otHours.toFixed(1) + 'h';
      var kL = $('#kpiAttOnLeave'); if (kL) kL.textContent = num(records.filter(function (r) { return r.status === 'ON_LEAVE'; }).length);

      if (!records.length) {
        host.innerHTML = '<div class="card pad" style="text-align:center;color:var(--muted)">No attendance records found for ' + esc(date) + '.</div>';
        return;
      }

      var rows = records.map(function (r) {
        var empName = r.employee ? (r.employee.firstName + ' ' + r.employee.lastName) : 'Staff Member';
        var statusCls = r.status === 'PRESENT' ? 'badge-paid' : (r.status === 'LATE' ? 'badge-failed' : 'badge-pending');

        return '<tr>' +
          '<td class="mono">' + ddmmyyyy(r.workDate) + '</td>' +
          '<td><strong>' + esc(empName) + '</strong></td>' +
          '<td>' + esc(r.warehouseId ? warehouseName(r.warehouseId) : 'Facility') + '</td>' +
          '<td class="mono">' + (r.clockIn ? new Date(r.clockIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—') + '</td>' +
          '<td class="mono">' + (r.clockOut ? new Date(r.clockOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '<span class="badge badge-received">ACTIVE</span>') + '</td>' +
          '<td class="mono num">' + (r.hoursWorked ? Number(r.hoursWorked).toFixed(2) + ' hrs' : '—') + '</td>' +
          '<td class="mono num">' + (r.overtimeHours && Number(r.overtimeHours) > 0 ? Number(r.overtimeHours).toFixed(2) + ' hrs' : '0.00') + '</td>' +
          '<td><span class="badge ' + statusCls + '">' + esc(r.status || 'PRESENT') + '</span></td>' +
        '</tr>';
      }).join('');

      host.innerHTML =
        '<div class="card"><div class="tablewrap"><table class="table">' +
          '<thead><tr><th>Date</th><th>Employee</th><th>Facility</th><th>Clock In</th><th>Clock Out</th><th class="num">Hours</th><th class="num">Overtime</th><th>Status</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table></div></div>';
    }).catch(function (err) {
      host.innerHTML = '<div class="card pad" style="color:var(--crit)">Failed to load attendance: ' + esc(err.message || 'Error') + '</div>';
    });
  }

  var leaveSubTab = 'my';
  function renderLeaveRequestsView() {
    var host = $('#leaveRequestsBody');
    if (!host) return;

    var tabs = $$('#leaveTabs button');
    tabs.forEach(function (tab) {
      if (!tab.dataset.bound) {
        tab.dataset.bound = 'true';
        tab.onclick = function () {
          tabs.forEach(function (t) { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
          tab.classList.add('active');
          tab.setAttribute('aria-selected', 'true');
          leaveSubTab = tab.dataset.leaveTab || 'my';
          renderLeaveRequestsView();
        };
      }
    });

    var btnReq = $('#btnRequestLeave');
    if (btnReq && !btnReq.dataset.bound) {
      btnReq.dataset.bound = 'true';
      btnReq.onclick = function () {
        openModal('Request Time Off',
          '<div class="field">' +
            '<label>Leave Type</label>' +
            '<select name="leaveType">' +
              '<option value="VACATION">Vacation Leave</option>' +
              '<option value="SICK">Sick Leave</option>' +
              '<option value="PERSONAL">Personal Leave</option>' +
              '<option value="OTHER">Other / Bereavement</option>' +
            '</select>' +
          '</div>' +
          '<div class="formgrid-2">' +
            '<div class="field"><label>Start Date</label><input type="date" name="startDate" value="' + today() + '" required></div>' +
            '<div class="field"><label>End Date</label><input type="date" name="endDate" value="' + today() + '" required></div>' +
          '</div>' +
          '<div class="field">' +
            '<label>Reason / Notes</label>' +
            '<textarea name="reason" placeholder="Brief reason for the leave request" rows="2"></textarea>' +
          '</div>',
          function (fd) {
            return Api.submitLeaveRequest(fd).then(function () {
              toast('Leave request submitted.');
              renderLeaveRequestsView();
            });
          }
        );
      };
    }

    host.innerHTML = '<div style="text-align:center;padding:24px"><div class="spin" style="margin:0 auto 10px"></div>Loading leave records…</div>';

    Api.getEmployeeMe().then(function (meEmp) {
      if (meEmp && meEmp.id) {
        Api.getLeaveBalances(meEmp.id).then(function (balances) {
          (balances || []).forEach(function (b) {
            var rem = Math.max(0, Number(b.allocatedDays || 0) - Number(b.usedDays || 0));
            if (b.leaveType === 'VACATION') {
              var elV = $('#kpiLeaveVacation'); if (elV) elV.textContent = rem + 'd';
              var subV = $('#kpiLeaveVacationSub'); if (subV) subV.textContent = (b.usedDays || 0) + 'd used of ' + (b.allocatedDays || 0) + 'd';
            } else if (b.leaveType === 'SICK') {
              var elS = $('#kpiLeaveSick'); if (elS) elS.textContent = rem + 'd';
              var subS = $('#kpiLeaveSickSub'); if (subS) subS.textContent = (b.usedDays || 0) + 'd used of ' + (b.allocatedDays || 0) + 'd';
            } else if (b.leaveType === 'PERSONAL') {
              var elP = $('#kpiLeavePersonal'); if (elP) elP.textContent = rem + 'd';
              var subP = $('#kpiLeavePersonalSub'); if (subP) subP.textContent = (b.usedDays || 0) + 'd used of ' + (b.allocatedDays || 0) + 'd';
            }
          });
        }).catch(function () {});
      }

      var qParams = {};
      if (leaveSubTab === 'my' && meEmp) qParams.employeeId = meEmp.id;
      else if (leaveSubTab === 'pending') qParams.status = 'PENDING';

      return Api.listLeaveRequests(qParams);
    }).then(function (requests) {
      requests = requests || [];

      var pendCount = requests.filter(function (r) { return r.status === 'PENDING'; }).length;
      var kPend = $('#kpiLeavePending'); if (kPend) kPend.textContent = num(pendCount);

      if (!requests.length) {
        host.innerHTML = '<div class="card pad" style="text-align:center;color:var(--muted)">No leave requests matching filter.</div>';
        return;
      }

      var rows = requests.map(function (r) {
        var empName = r.employee ? (r.employee.firstName + ' ' + r.employee.lastName) : 'Staff';
        var statusCls = r.status === 'APPROVED' ? 'badge-paid' : (r.status === 'REJECTED' ? 'badge-failed' : 'badge-pending');

        var actions = '';
        if (isAdminOrManager() && r.status === 'PENDING') {
          actions = '<button type="button" class="btn ghost btn-sm btn-approve-leave" data-req-id="' + esc(r.id) + '">Approve</button> ' +
                    '<button type="button" class="btn ghost btn-sm btn-reject-leave" data-req-id="' + esc(r.id) + '">Reject</button>';
        }

        return '<tr>' +
          '<td><strong>' + esc(empName) + '</strong></td>' +
          '<td><span class="badge">' + esc(r.leaveType) + '</span></td>' +
          '<td class="mono">' + ddmmyyyy(r.startDate) + '</td>' +
          '<td class="mono">' + ddmmyyyy(r.endDate) + '</td>' +
          '<td class="mono num" style="font-weight:600">' + num(r.totalDays || 1) + 'd</td>' +
          '<td>' + esc(r.reason || '—') + '</td>' +
          '<td><span class="badge ' + statusCls + '">' + esc(r.status) + '</span></td>' +
          '<td style="text-align:right">' + actions + '</td>' +
        '</tr>';
      }).join('');

      host.innerHTML =
        '<div class="card"><div class="tablewrap"><table class="table">' +
          '<thead><tr><th>Employee</th><th>Type</th><th>Start</th><th>End</th><th class="num">Days</th><th>Reason</th><th>Status</th><th style="text-align:right">Actions</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table></div></div>';

      $$('.btn-approve-leave', host).forEach(function (btn) {
        btn.onclick = function () {
          var notes = prompt('Approval notes (optional):', 'Approved');
          if (notes === null) return;
          Api.reviewLeaveRequest(btn.dataset.reqId, { decision: 'APPROVED', reviewNotes: notes }).then(function () {
            toast('Leave request approved.');
            renderLeaveRequestsView();
          });
        };
      });

      $$('.btn-reject-leave', host).forEach(function (btn) {
        btn.onclick = function () {
          var notes = prompt('Reason for rejection:', 'Not approved at this time');
          if (notes === null) return;
          Api.reviewLeaveRequest(btn.dataset.reqId, { decision: 'REJECTED', reviewNotes: notes }).then(function () {
            toast('Leave request rejected.');
            renderLeaveRequestsView();
          });
        };
      });
    }).catch(function (err) {
      host.innerHTML = '<div class="card pad" style="color:var(--crit)">Failed to load leave requests: ' + esc(err.message || 'Error') + '</div>';
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
    watchTablesForMobile();
    if (checkPublicPaymentRoute()) {
      return;
    }
    if (Api.isAuthenticated()) {
      boot();
    } else {
      showGate();
    }
  });

  global.__PO__ = {
    poDocumentHtml: poDocumentHtml,
    poLineAmountCents: poLineAmountCents,
    poMoney: poMoney,
    poTotalCents: poTotalCents,
    poFormatDate: poFormatDate,
    openNewPurchaseOrder: openNewPurchaseOrder,
    renderPoEditor: renderPoEditor,
    newPoDraft: newPoDraft,
    show: show,
    setMe: function (user) { me = user; }
  };

  global.__INVOICE__ = {
    invoiceDocumentHtml: invoiceDocumentHtml,
    downloadInvoicePdf: downloadInvoicePdf,
    printInvoiceDocument: printInvoiceDocument,
    renderInvoiceDocumentView: renderInvoiceDocumentView,
    newDraft: newDraft,
    totalsLocal: totalsLocal,
    setDraft: function (d) { draft = d; },
    getDraft: function () { return draft; }
  };

})(window);
