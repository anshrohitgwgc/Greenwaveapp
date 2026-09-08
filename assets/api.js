/* ==========================================================================
   GreenWave API Client (V2)

   Full server-authoritative API client for GreenWave Operations.
   Communicates with the NestJS API backend for authentication, multi-warehouse
   inventory, containers, invoices, photos, timesheets, global chat, and audit.

   Base URL defaults to same-origin with optional localStorage override:
     localStorage.setItem('greenwave.apiBase', 'http://localhost:3000')

   The JWT token is securely kept in sessionStorage.
   ========================================================================== */
(function (global) {
  'use strict';

  var TOKEN_KEY = 'greenwave.session.token';

  function baseUrl() {
    try {
      var override = global.localStorage.getItem('greenwave.apiBase');
      if (override) return override.replace(/\/+$/, '');
    } catch (e) { /* localStorage unavailable in private modes */ }
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

  function handleResponse(res) {
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
  }

  function networkError() {
    var err = new Error('Unable to connect to GreenWave services. Please try again.');
    err.status = 0;
    throw err;
  }

  function request(method, path, body) {
    var headers = { 'Content-Type': 'application/json' };
    var token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;

    return global.fetch(baseUrl() + path, {
      method: method,
      headers: headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    }).then(handleResponse, networkError);
  }

  function upload(path, formData) {
    var headers = {};
    var token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;

    return global.fetch(baseUrl() + path, {
      method: 'POST',
      headers: headers,
      body: formData
    }).then(handleResponse, networkError);
  }

  function requestBlob(method, path, body) {
    var headers = { 'Content-Type': 'application/json' };
    var token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;

    return global.fetch(baseUrl() + path, {
      method: method,
      headers: headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (text) {
          var data = null;
          try { data = text ? JSON.parse(text) : null; } catch (e) {}
          var err = new Error((data && data.message) || ('PDF request failed (' + res.status + ')'));
          err.status = res.status;
          throw err;
        });
      }
      return res.blob();
    }, networkError);
  }

  var Api = {
    isAuthenticated: function () { return !!getToken(); },
    clearSession: function () { setToken(null); },
    getToken: getToken,
    getBaseUrl: baseUrl,

    // Authentication
    login: function (email, password) {
      return request('POST', '/auth/login', { email: email, password: password }).then(function (res) {
        setToken(res.access_token);
        return res.user;
      });
    },

    me: function () { return request('GET', '/auth/me'); },

    // Staff / Users
    listUsers: function (warehouseId) {
      return request('GET', '/users' + qs({ warehouseId: warehouseId }));
    },
    getUser: function (id) { return request('GET', '/users/' + id); },
    createUser: function (data) { return request('POST', '/users', data); },
    updateUser: function (id, data) { return request('PATCH', '/users/' + id, data); },
    getUserWarehouses: function (userId) { return request('GET', '/users/' + userId + '/warehouses'); },
    assignUserWarehouses: function (userId, warehouseIds) { return request('PUT', '/users/' + userId + '/warehouses', { warehouseIds: warehouseIds }); },
    getUserDivisions: function (userId) { return request('GET', '/users/' + userId + '/divisions'); },
    assignUserDivisions: function (userId, divisions) { return request('PUT', '/users/' + userId + '/divisions', { divisions: divisions }); },

    // Divisions / business units.
    //
    // `myDivisions()` is the ONLY source of truth for what the user may
    // operate in. The client never derives division access from a role, a
    // localStorage value, or anything else it can see -- it asks the server
    // and renders exactly what comes back.
    myDivisions: function () { return request('GET', '/divisions'); },
    divisionCatalog: function () { return request('GET', '/divisions/catalog'); },

    // Warehouses
    listWarehouses: function (includeInactive) {
      return request('GET', '/warehouses' + qs({ includeInactive: includeInactive ? 'true' : undefined }));
    },
    createWarehouse: function (data) { return request('POST', '/warehouses', data); },
    updateWarehouse: function (id, data) { return request('PATCH', '/warehouses/' + id, data); },

    // Customers
    listCustomers: function (warehouseId, division) {
      if (typeof warehouseId === 'object' && warehouseId !== null) {
        return request('GET', '/customers' + qs(warehouseId));
      }
      return request('GET', '/customers' + qs({ warehouseId: warehouseId, division: division }));
    },
    createCustomer: function (data) { return request('POST', '/customers', data); },
    updateCustomer: function (id, data) { return request('PATCH', '/customers/' + id, data); },

    // Materials
    listMaterials: function (params) {
      params = params || {};
      if (params === true || params === false) params = { includeInactive: params }; // legacy boolean call sites
      return request('GET', '/materials' + qs({
        includeInactive: params.includeInactive ? 'true' : undefined,
        warehouseId: params.warehouseId,
        division: params.division,
      }));
    },
    createMaterial: function (data) { return request('POST', '/materials', data); },
    updateMaterial: function (id, data) { return request('PATCH', '/materials/' + id, data); },
    deleteMaterial: function (id) { return request('DELETE', '/materials/' + id); },

    // Containers
    listContainers: function (params) {
      if (typeof params === 'string') params = { warehouseId: params };
      return request('GET', '/containers' + qs(params));
    },
    createContainer: function (data) { return request('POST', '/containers', data); },

    // Inventory Ledger & Balances
    listInventoryTransactions: function (params) {
      return request('GET', '/inventory/transactions' + qs(params));
    },
    getInventoryTransaction: function (id) {
      return request('GET', '/inventory/transactions/' + id);
    },
    createInventoryTransaction: function (data) {
      return request('POST', '/inventory/transactions', data);
    },
    getInventoryBalances: function (warehouseId, division) {
      if (typeof warehouseId === 'object') {
        return request('GET', '/inventory/balances' + qs(warehouseId));
      }
      return request('GET', '/inventory/balances' + qs({ warehouseId: warehouseId, division: division }));
    },

    // Global Staff Chat
    listChatMessages: function (params) {
      return request('GET', '/chat/messages' + qs(params));
    },
    sendChatMessage: function (message) {
      return request('POST', '/chat/messages', { message: message });
    },
    getOnlineStaff: function () {
      return request('GET', '/chat/online');
    },
    chatStreamUrl: function () {
      return baseUrl() + '/chat/stream?token=' + encodeURIComponent(getToken() || '');
    },

    // Invoices & Payments
    listInvoices: function (params) { return request('GET', '/invoices' + qs(params)); },
    getInvoice: function (id) { return request('GET', '/invoices/' + id); },
    createInvoice: function (data) { return request('POST', '/invoices', data); },
    nextInvoiceNumber: function () { return request('GET', '/invoices/next-number'); },
    updateInvoice: function (id, data) { return request('PATCH', '/invoices/' + id, data); },
    duplicateInvoice: function (id) { return request('POST', '/invoices/' + id + '/duplicate'); },
    renderInvoicePdf: function (data) { return requestBlob('POST', '/invoices/render-pdf', data); },
    getPaymentLink: function (invoiceId) { return request('POST', '/payments/invoices/' + invoiceId + '/link'); },
    sendInvoiceEmail: function (invoiceId, recipientEmail, customMessage) {
      return request('POST', '/payments/invoices/' + invoiceId + '/send', {
        recipientEmail: recipientEmail,
        customMessage: customMessage
      });
    },
    getPaymentMetrics: function (warehouseId) {
      return request('GET', '/payments/metrics' + qs({ warehouseId: warehouseId }));
    },
    refundPayment: function (paymentId, reason) {
      return request('POST', '/payments/refund/' + paymentId, { reason: reason });
    },
    // Purchase Orders (administrator-only server-side; see
    // purchase-orders.controller.ts). The client hiding the navigation is a
    // convenience -- every one of these 403s for a non-admin.
    listPurchaseOrders: function (params) { return request('GET', '/purchase-orders' + qs(params)); },
    getPurchaseOrder: function (id) { return request('GET', '/purchase-orders/' + id); },
    createPurchaseOrder: function (data) { return request('POST', '/purchase-orders', data); },
    updatePurchaseOrder: function (id, data) { return request('PATCH', '/purchase-orders/' + id, data); },
    deletePurchaseOrder: function (id) { return request('DELETE', '/purchase-orders/' + id); },
    nextPurchaseOrderNumber: function () { return request('GET', '/purchase-orders/next-number'); },
    renderPurchaseOrderPdf: function (data) { return requestBlob('POST', '/purchase-orders/render-pdf', data); },

    getPublicInvoice: function (token) {
      return request('GET', '/pay/' + token);
    },
    createCheckoutSession: function (token) {
      return request('POST', '/pay/' + token + '/checkout');
    },

    // Time clock
    clockIn: function (warehouseId) { return request('POST', '/timesheets/clock-in', { warehouseId: warehouseId }); },
    clockOut: function () { return request('POST', '/timesheets/clock-out'); },
    currentShift: function () { return request('GET', '/timesheets/me/current'); },
    shiftHistory: function (from, to) { return request('GET', '/timesheets/me/history' + qs({ from: from, to: to })); },
    teamShifts: function () { return request('GET', '/timesheets/team'); },

    // Photos
    listPhotos: function (params) { return request('GET', '/photos' + qs(params)); },
    getPhoto: function (id) { return request('GET', '/photos/' + id); },
    uploadPhoto: function (file, meta) {
      var fd = new FormData();
      fd.append('file', file, file.name || 'photo.jpg');
      Object.keys(meta || {}).forEach(function (k) {
        if (meta[k] !== undefined && meta[k] !== null && meta[k] !== '') fd.append(k, meta[k]);
      });
      return upload('/photos', fd);
    },
    deletePhoto: function (id) { return request('DELETE', '/photos/' + id); },

    // History / Audit
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
