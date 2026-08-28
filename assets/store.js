/* ==========================================================================
   Storage.

   Everything lives in this browser. No server, no account service.
   Money is stored in CENTS as integers. Photos live in IndexedDB (see
   photos.js) because they are far too big for localStorage.
   ========================================================================== */
(function (global) {
  'use strict';

  var KEY = 'greenwave.ops.v2';

  /* Seeded with facts you have given me — the legal identity from invoice
     1114 and the three provinces you operate in. No demo customers,
     materials, tickets or invoices. */
  function blank() {
    return {
      version: 2,
      company: {
        name: 'Greenwave Recycling Inc.',
        line1: '23394 Fisherman Rd,',
        line2: 'Maple Ridge, BC V2W 1B9',
        email: 'sales@greenwaverecycling.ca',
        phone: '6724720423',
        bn: 'BN 751161951BC0001',
        gst: 'GST/HST Registration No. 751161951RT0001'
      },
      warehouses: [
        { id: 'w1', name: 'Maple Ridge, BC', province: 'BC' },
        { id: 'w2', name: 'Calgary, AB',     province: 'AB' },
        { id: 'w3', name: 'Ontario',         province: 'ON' }
      ],
      staff: [],       // legacy local roster — display only, see README V2 notes
      session: null,   // 'server' once signed in against the real API, else null
      serverUser: null, // { id, email, name, role } from the last successful /auth/login
      customers: [],
      products: [],
      tickets: [],
      shifts: [],      // { id, staffId, startAt, endAt, note }
      invoices: [],
      activity: [],    // { id, at, staffId, action, detail }
      counters: { invoice: 1115 },   // your last issued invoice was 1114
      lastEntity: 'recycling'
    };
  }

  var state = null;

  function load() {
    if (state) return state;
    var d = blank();
    try {
      var raw = global.localStorage.getItem(KEY);
      state = raw ? JSON.parse(raw) : d;
      if (!state || typeof state !== 'object') state = d;

      Object.keys(d).forEach(function (k) {
        if (state[k] === undefined || state[k] === null) state[k] = d[k];
      });

      if (!Array.isArray(state.warehouses) || state.warehouses.length === 0) {
        state.warehouses = d.warehouses;
      }

      if (!Array.isArray(state.staff)) state.staff = [];
      state.staff = state.staff.map(function (x) {
        if (typeof x === 'string') {
          return { id: uid('stf'), email: x.toLowerCase(), name: x, role: 'admin', active: true, createdAt: new Date().toISOString() };
        }
        if (x && typeof x === 'object') {
          return {
            id: x.id || uid('stf'),
            email: String(x.email || '').toLowerCase(),
            name: String(x.name || x.email || 'Staff Member'),
            role: x.role || 'staff',
            active: x.active !== false,
            createdAt: x.createdAt || new Date().toISOString()
          };
        }
        return null;
      }).filter(Boolean);

      ['customers', 'products', 'tickets', 'shifts', 'invoices', 'activity'].forEach(function (k) {
        if (!Array.isArray(state[k])) state[k] = [];
      });

      if (!state.counters || typeof state.counters !== 'object') {
        state.counters = { invoice: 1115 };
      } else if (!state.counters.invoice) {
        state.counters.invoice = 1115;
      }
    } catch (e) {
      state = d;
    }
    return state;
  }

  function save() {
    try {
      global.localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      return false;
    }
  }

  function uid(p) {
    return p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* Append-only history. Every write in the app goes through here so an
     admin can answer "who changed this, and when". */
  function log(action, detail) {
    var s = load();
    if (!Array.isArray(s.activity)) s.activity = [];
    var actor = s.serverUser;
    s.activity.push({
      id: uid('act'),
      at: new Date().toISOString(),
      // Denormalized at write time: db.session is just the literal string
      // 'server' now (one real session model for every user, see
      // setServerSession), so it can't be used as a per-user key any more.
      staffId: actor ? actor.id : null,
      staffName: actor ? actor.name : null,
      action: action,
      detail: detail || ''
    });
    if (s.activity.length > 5000) s.activity = s.activity.slice(-5000);
    save();
  }

  global.Store = {
    KEY: KEY,
    get: load,
    save: save,
    uid: uid,
    log: log,
    reset: function () { state = blank(); save(); return state; },
    replace: function (n) { state = n; save(); return state; },
    nextInvoiceNumber: function () {
      var s = load(), n = (s.counters && s.counters.invoice) || 1115;
      if (!s.counters) s.counters = {};
      s.counters.invoice = n + 1;
      save();
      return n;
    },
    /* Real session: whoever the server authenticated via POST /auth/login.
       Shaped like the old local staff record ({id, email, name, role,
       active}) so the rest of the app — which reads me.role, me.name,
       initials(me.name), etc. everywhere — doesn't need to change. */
    setServerSession: function (user) {
      var s = load();
      s.session = 'server';
      s.serverUser = {
        id: user.id,
        email: user.email,
        name: user.fullName,
        role: user.role,
        active: true
      };
      save();
      return s.serverUser;
    },
    clearSession: function () {
      var s = load();
      s.session = null;
      s.serverUser = null;
      save();
    },
    me: function () {
      var s = load();
      if (!s || s.session !== 'server' || !s.serverUser) return null;
      return s.serverUser;
    }
  };
})(window);
