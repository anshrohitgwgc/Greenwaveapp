/* ==========================================================================
   Storage.

   Everything lives in this browser's localStorage. No server, no account.
   That means: it works offline and nobody else can see it, but it is also
   tied to this browser on this machine. Use Settings → Export to take a
   backup before you rely on it.

   Money is stored in CENTS as integers. Quantities are stored as entered
   (up to 3 decimals) and every product carries its own unit. Storing money
   as a float is how invoices end up a cent off their own line items.
   ========================================================================== */
(function (global) {
  'use strict';

  var KEY = 'greenwave.ops.v1';

  /* Seeded with facts you have actually given me — the legal identity from
     invoice 1114 and the three provinces you operate in. Nothing invented:
     no customers, no materials, no tickets, no invoices. */
  function blank() {
    return {
      version: 1,
      company: {
        name: 'Greenwave Recycling Inc.',
        line1: '23394 Fisherman Rd,',
        line2: 'Maple Ridge, BC V2W 1B9',
        email: 'sales@greenwaverecycling.ca',
        phone: '6724720423',
        bn: 'BN 751161951BC0001',
        gst: 'GST/HST Registration No. 751161951RT0001',
      },
      warehouses: [
        { id: 'w1', name: 'Maple Ridge, BC', province: 'BC' },
        { id: 'w2', name: 'Calgary, AB',     province: 'AB' },
        { id: 'w3', name: 'Ontario',         province: 'ON' },
      ],
      customers: [],   // { id, name, line1, line2, email, phone }
      products: [],    // { id, entity, name, unit, capture, rateCents, category }
      tickets: [],     // { id, entity, warehouseId, direction, productId, ... }
      invoices: [],    // { id, number, ... , lines: [] }
      counters: { invoice: 1115 },  // your last issued invoice was 1114
      lastEntity: 'recycling',
    };
  }

  var state = null;

  function load() {
    if (state) return state;
    try {
      var raw = global.localStorage.getItem(KEY);
      state = raw ? JSON.parse(raw) : blank();
    } catch (e) {
      // Private mode, disabled storage, or corrupt JSON — keep working in
      // memory rather than showing the user a broken app.
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

  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  global.Store = {
    KEY: KEY,
    get: load,
    save: save,
    uid: uid,
    reset: function () { state = blank(); save(); return state; },
    replace: function (next) { state = next; save(); return state; },
    nextInvoiceNumber: function () {
      var s = load();
      var n = s.counters.invoice;
      s.counters.invoice = n + 1;
      save();
      return n;
    },
  };
})(window);
