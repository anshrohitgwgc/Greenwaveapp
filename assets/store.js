/* ==========================================================================
   Local storage.

   Production business data (invoices, inventory, customers, materials,
   staff, photos, time clock, history) is server-authoritative — see
   assets/api.js and docs/V2_ARCHITECTURE.md. What's left here is exactly
   the stuff that's legitimately local: the signed-in session pointer, UI
   preferences (which company/warehouse you last had open), the invoice
   letterhead defaults (the backend has no "company settings" of its own —
   each invoice just stores a snapshot of whatever was on screen when it was
   saved), and a client-only tag on materials (which of the two companies a
   material belongs to, and how its quantity is captured) that the backend's
   material record has no column for.
   ========================================================================== */
(function (global) {
  'use strict';

  var KEY = 'greenwave.ops.v2';

  function blank() {
    return {
      version: 3,
      company: {
        name: 'Greenwave Recycling Inc.',
        line1: '23394 Fisherman Rd',
        line2: 'Maple Ridge, BC V2W 1B9',
        email: 'sales@greenwaverecycling.ca',
        phone: '6724720423',
        bn: 'BN 751161951BC0001',
        gst: '751161951RT0001'
      },
      session: null,    // 'server' once signed in against the real API, else null
      serverUser: null, // { id, email, name, role } from the last successful /auth/login
      lastEntity: 'recycling',
      lastWarehouseId: null,
      materialMeta: {}  // materialId -> { entity, capture, sizes } — see assets/app.js
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
      if (!state.materialMeta || typeof state.materialMeta !== 'object') state.materialMeta = {};
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

  global.Store = {
    KEY: KEY,
    get: load,
    save: save,
    reset: function () { state = blank(); save(); return state; },
    replace: function (next) {
      var d = blank();
      state = next && typeof next === 'object' ? next : d;
      Object.keys(d).forEach(function (k) { if (state[k] === undefined || state[k] === null) state[k] = d[k]; });
      if (!state.materialMeta || typeof state.materialMeta !== 'object') state.materialMeta = {};
      save();
      return state;
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
        name: user.fullName || user.name || user.email,
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
    },

    getWarehouse: function () {
      var s = load();
      return s ? s.lastWarehouseId : null;
    },
    setWarehouse: function (id) {
      var s = load();
      s.lastWarehouseId = id;
      save();
    },

    materialMeta: function (id) { return load().materialMeta[id] || null; },
    setMaterialMeta: function (id, meta) {
      var s = load();
      s.materialMeta[id] = meta;
      save();
    }
  };
})(window);
