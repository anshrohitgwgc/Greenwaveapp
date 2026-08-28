/* ==========================================================================
   GreenWave API client.

   Talks to the real backend (app/api in the GreenWave-FULL-INFRA-V.0001
   repo) for authentication. The base URL defaults to same-origin (the
   production nginx config proxies /auth, /users, etc. straight through to
   the API cluster on the same host as this static site) but can be
   overridden for local development without a build step:

     localStorage.setItem('greenwave.apiBase', 'http://localhost:3000')

   Root routes only — no /api/v1 prefix, matching the real production API
   contract (see docs/V2_ARCHITECTURE.md).

   The JWT is kept in sessionStorage, not localStorage: it's cleared when
   the tab closes, and it is never written alongside a password. Passwords
   themselves are never stored anywhere in the browser.
   ========================================================================== */
(function (global) {
  'use strict';

  var TOKEN_KEY = 'greenwave.session.token';

  function baseUrl() {
    try {
      var override = global.localStorage.getItem('greenwave.apiBase');
      if (override) return override.replace(/\/+$/, '');
    } catch (e) { /* localStorage unavailable (private mode etc.) — fall through */ }
    return ''; // same-origin
  }

  function getToken() {
    try { return global.sessionStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
  }
  function setToken(t) {
    try {
      if (t) global.sessionStorage.setItem(TOKEN_KEY, t);
      else global.sessionStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* ignore */ }
  }

  function request(method, path, body) {
    var headers = { 'Content-Type': 'application/json' };
    var token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;

    return global.fetch(baseUrl() + path, {
      method: method,
      headers: headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { /* non-JSON response */ }
        if (!res.ok) {
          var err = new Error((data && data.message) || ('Request failed (' + res.status + ')'));
          err.status = res.status;
          err.body = data;
          throw err;
        }
        return data;
      });
    }, function () {
      // Network failure (API unreachable, offline, DNS, etc.) — never let
      // this bubble as an unhandled rejection that could blank the screen.
      var err = new Error('Could not reach the GreenWave server. Check your connection and try again.');
      err.status = 0;
      throw err;
    });
  }

  var Api = {
    isAuthenticated: function () { return !!getToken(); },
    clearSession: function () { setToken(null); },

    login: function (email, password) {
      return request('POST', '/auth/login', { email: email, password: password }).then(function (res) {
        setToken(res.access_token);
        return res.user;
      });
    },

    // Bootstrap only — the server refuses this once any account exists.
    registerFirstAdmin: function (fullName, email, password) {
      return request('POST', '/auth/register', { fullName: fullName, email: email, password: password })
        .then(function (res) {
          setToken(res.access_token);
          return res.user;
        });
    },

    me: function () { return request('GET', '/users/me'); },

    // Ready for the next wiring pass — the backend already implements all
    // of these (see docs/V2_ARCHITECTURE.md); the frontend does not call
    // them yet outside of auth. Kept here so that work is additive, not a
    // second round of API-client design.
    listUsers: function () { return request('GET', '/users'); },
    createUser: function (data) { return request('POST', '/users', data); },

    listWarehouses: function () { return request('GET', '/warehouses'); },
    listCustomers: function () { return request('GET', '/customers'); },
    listMaterials: function () { return request('GET', '/materials'); },

    listInventoryTransactions: function (params) {
      return request('GET', '/inventory/transactions' + qs(params));
    },
    createInventoryTransaction: function (data) {
      return request('POST', '/inventory/transactions', data);
    },
    getInventoryBalances: function (warehouseId) {
      return request('GET', '/inventory/balances' + qs({ warehouseId: warehouseId }));
    },

    listInvoices: function (params) { return request('GET', '/invoices' + qs(params)); },
    createInvoice: function (data) { return request('POST', '/invoices', data); },
    updateInvoice: function (id, data) { return request('PATCH', '/invoices/' + id, data); },
    duplicateInvoice: function (id) { return request('POST', '/invoices/' + id + '/duplicate'); },

    clockIn: function (warehouseId) { return request('POST', '/timesheets/clock-in', { warehouseId: warehouseId }); },
    clockOut: function () { return request('POST', '/timesheets/clock-out'); },
    currentShift: function () { return request('GET', '/timesheets/me/current'); },
    shiftHistory: function () { return request('GET', '/timesheets/me/history'); },

    listPhotos: function (params) { return request('GET', '/photos' + qs(params)); },

    listAudit: function (params) { return request('GET', '/audit' + qs(params)); }
  };

  function qs(params) {
    if (!params) return '';
    var parts = Object.keys(params)
      .filter(function (k) { return params[k] !== undefined && params[k] !== null && params[k] !== ''; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); });
    return parts.length ? '?' + parts.join('&') : '';
  }

  global.GreenwaveApi = Api;
})(window);
