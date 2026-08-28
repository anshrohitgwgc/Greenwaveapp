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
      staff: [],       // { id, email, name, role, active, createdAt }
      session: null,   // staff id of whoever is signed in on this device
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
    try {
      var raw = global.localStorage.getItem(KEY);
      state = raw ? JSON.parse(raw) : blank();
      // Fill in anything a older save is missing, so an upgrade never
      // lands the app on undefined.
      var d = blank();
      Object.keys(d).forEach(function (k) {
        if (state[k] === undefined) state[k] = d[k];
      });
    } catch (e) {
      state = blank();
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
    s.activity.push({
      id: uid('act'),
      at: new Date().toISOString(),
      staffId: s.session,
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
      var s = load(), n = s.counters.invoice;
      s.counters.invoice = n + 1;
      save();
      return n;
    },
    me: function () {
      var s = load();
      return s.staff.filter(function (x) { return x.id === s.session; })[0] || null;
    }
  };
})(window);
