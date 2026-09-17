/* ==========================================================================
   GreenWave API Client (V2 - Hardened)

   Full server-authoritative API client for GreenWave Operations.
   Communicates with the NestJS API backend for authentication, multi-warehouse
   inventory, containers, invoices, photos, timesheets, global chat, and audit.

   Base URL defaults to same-origin relative URLs (/api/...).
   Authenticates using server-issued HttpOnly session cookies with CSRF defense,
   with backward-compatible sessionStorage JWT preservation.
   ========================================================================== */
(function (global) {
  'use strict';

  var TOKEN_KEY = 'greenwave.session.token';
  var cachedCsrfToken = null;

  function baseUrl() {
    try {
      var override = global.localStorage.getItem('greenwave.apiBase');
      if (override) return override.replace(/\/+$/, '');
    } catch (e) { /* localStorage unavailable in private modes */ }
    return ''; // same-origin relative
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

  function getCsrfToken() {
    try {
      var match = global.document && global.document.cookie && global.document.cookie.match(/(?:^|;\s*)gw_csrf=([^;]*)/);
      if (match) return decodeURIComponent(match[1]);
    } catch (e) { /* ignore */ }
    return cachedCsrfToken || '';
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

  function request(method, path, body, customHeaders) {
    var headers = { 'Content-Type': 'application/json' };
    var token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;

    if (method !== 'GET' && method !== 'HEAD') {
      var csrf = getCsrfToken();
      if (csrf) headers['X-CSRF-Token'] = csrf;
    }

    if (customHeaders && typeof customHeaders === 'object') {
      for (var k in customHeaders) {
        if (Object.prototype.hasOwnProperty.call(customHeaders, k)) {
          headers[k] = customHeaders[k];
        }
      }
    }

    return global.fetch(baseUrl() + path, {
      method: method,
      headers: headers,
      credentials: 'same-origin',
      body: body !== undefined ? JSON.stringify(body) : undefined
    }).then(handleResponse, networkError);
  }

  function upload(path, formData) {
    var headers = {};
    var token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;

    var csrf = getCsrfToken();
    if (csrf) headers['X-CSRF-Token'] = csrf;

    return global.fetch(baseUrl() + path, {
      method: 'POST',
      headers: headers,
      credentials: 'same-origin',
      body: formData
    }).then(handleResponse, networkError);
  }

  function requestBlob(method, path, body) {
    var headers = { 'Content-Type': 'application/json' };
    var token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;

    if (method !== 'GET' && method !== 'HEAD') {
      var csrf = getCsrfToken();
      if (csrf) headers['X-CSRF-Token'] = csrf;
    }

    return global.fetch(baseUrl() + path, {
      method: method,
      headers: headers,
      credentials: 'same-origin',
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
    clearSession: function () {
      setToken(null);
      cachedCsrfToken = null;
    },
    getToken: getToken,
    getBaseUrl: baseUrl,

    // Authentication
    login: function (email, password) {
      return request('POST', '/api/auth/login', { email: email, password: password }).then(function (res) {
        if (res.access_token) {
          setToken(res.access_token);
        }
        if (res.csrfToken) {
          cachedCsrfToken = res.csrfToken;
        }
        return res.user;
      });
    },

    logout: function () {
      return request('POST', '/api/auth/logout', {}).catch(function () {
        // Silently swallow network errors so local state always gets cleared
      }).then(function () {
        Api.clearSession();
      });
    },

    me: function () { return request('GET', '/api/auth/me'); },

    // Staff / Users
    listUsers: function (warehouseId) {
      return request('GET', '/api/users' + qs({ warehouseId: warehouseId }));
    },
    getUser: function (id) { return request('GET', '/api/users/' + id); },
    createUser: function (data) { return request('POST', '/api/users', data); },
    updateUser: function (id, data) { return request('PATCH', '/api/users/' + id, data); },
    getUserWarehouses: function (userId) { return request('GET', '/api/users/' + userId + '/warehouses'); },
    assignUserWarehouses: function (userId, warehouseIds) { return request('PUT', '/api/users/' + userId + '/warehouses', { warehouseIds: warehouseIds }); },
    getUserDivisions: function (userId) { return request('GET', '/api/users/' + userId + '/divisions'); },
    assignUserDivisions: function (userId, divisions) { return request('PUT', '/api/users/' + userId + '/divisions', { divisions: divisions }); },

    // Divisions / business units.
    myDivisions: function () { return request('GET', '/api/divisions'); },
    divisionCatalog: function () { return request('GET', '/api/divisions/catalog'); },

    // Warehouses
    listWarehouses: function (includeInactive) {
      return request('GET', '/api/warehouses' + qs({ includeInactive: includeInactive ? 'true' : undefined }));
    },
    createWarehouse: function (data) { return request('POST', '/api/warehouses', data); },
    updateWarehouse: function (id, data) { return request('PATCH', '/api/warehouses/' + id, data); },

    // Customers
    listCustomers: function (warehouseId, division) {
      if (typeof warehouseId === 'object' && warehouseId !== null) {
        return request('GET', '/api/customers' + qs(warehouseId));
      }
      return request('GET', '/api/customers' + qs({ warehouseId: warehouseId, division: division }));
    },
    createCustomer: function (data) { return request('POST', '/api/customers', data); },
    updateCustomer: function (id, data) { return request('PATCH', '/api/customers/' + id, data); },

    // Materials
    listMaterials: function (params) {
      params = params || {};
      if (params === true || params === false) params = { includeInactive: params };
      return request('GET', '/api/materials' + qs({
        includeInactive: params.includeInactive ? 'true' : undefined,
        warehouseId: params.warehouseId,
        division: params.division,
      }));
    },
    createMaterial: function (data) { return request('POST', '/api/materials', data); },
    updateMaterial: function (id, data) { return request('PATCH', '/api/materials/' + id, data); },
    deleteMaterial: function (id) { return request('DELETE', '/api/materials/' + id); },

    // Containers
    listContainers: function (params) {
      if (typeof params === 'string') params = { warehouseId: params };
      return request('GET', '/api/containers' + qs(params));
    },
    createContainer: function (data) { return request('POST', '/api/containers', data); },

    // Inventory Ledger & Balances
    listInventoryTransactions: function (params) {
      return request('GET', '/api/inventory/transactions' + qs(params));
    },
    getInventoryTransaction: function (id) {
      return request('GET', '/api/inventory/transactions/' + id);
    },
    createInventoryTransaction: function (data) {
      return request('POST', '/api/inventory/transactions', data);
    },
    getInventoryBalances: function (warehouseId, division) {
      if (typeof warehouseId === 'object') {
        return request('GET', '/api/inventory/balances' + qs(warehouseId));
      }
      return request('GET', '/api/inventory/balances' + qs({ warehouseId: warehouseId, division: division }));
    },

    // Global Staff Chat
    listChatMessages: function (params) {
      return request('GET', '/api/chat/messages' + qs(params));
    },
    sendChatMessage: function (message) {
      return request('POST', '/api/chat/messages', { message: message });
    },
    getOnlineStaff: function () {
      return request('GET', '/api/chat/online');
    },
    chatStreamUrl: function () {
      return baseUrl() + '/api/chat/stream?token=' + encodeURIComponent(getToken() || '');
    },

    // Invoices & Payments
    listInvoices: function (params) { return request('GET', '/api/invoices' + qs(params)); },
    getInvoice: function (id) { return request('GET', '/api/invoices/' + id); },
    createInvoice: function (data) { return request('POST', '/api/invoices', data); },
    nextInvoiceNumber: function () { return request('GET', '/api/invoices/next-number'); },
    updateInvoice: function (id, data) { return request('PATCH', '/api/invoices/' + id, data); },
    duplicateInvoice: function (id) { return request('POST', '/api/invoices/' + id + '/duplicate'); },
    renderInvoicePdf: function (data) { return requestBlob('POST', '/api/invoices/render-pdf', data); },
    getPaymentLink: function (invoiceId) { return request('POST', '/api/payments/invoices/' + invoiceId + '/link'); },
    sendInvoiceEmail: function (invoiceId, recipientEmail, customMessage) {
      return request('POST', '/api/payments/invoices/' + invoiceId + '/send', {
        recipientEmail: recipientEmail,
        customMessage: customMessage
      });
    },
    listPayments: function (params) { return request('GET', '/api/payments' + qs(params)); },
    getPayment: function (id) { return request('GET', '/api/payments/' + id); },
    getPaymentSummary: function (params) { return request('GET', '/api/payments/summary' + qs(params)); },
    getPaymentMetrics: function (warehouseId) {
      return request('GET', '/api/payments/metrics' + qs({ warehouseId: warehouseId }));
    },
    getStripeOverview: function () { return request('GET', '/api/payments/stripe/overview'); },
    syncStripe: function (body) { return request('POST', '/api/payments/stripe/sync', body || {}); },
    refundPayment: function (paymentId, amountMinor, reason, idempotencyKey) {
      var key = (idempotencyKey && String(idempotencyKey).trim()) || ('gw-rf-' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36));
      return request('POST', '/api/payments/' + paymentId + '/refunds', { amountMinor: amountMinor, reason: reason }, { 'Idempotency-Key': key });
    },

    // Public Customer Checkout (Stripe Payment Element)
    getPublicInvoice: function (token) {
      return request('GET', '/api/public/pay/' + token);
    },
    getPublicPaymentStatus: function (token) {
      return request('GET', '/api/public/pay/' + token + '/status');
    },
    createPaymentIntent: function (token) {
      return request('POST', '/api/public/pay/' + token + '/intent');
    },
    createCheckoutSession: function (token) {
      return this.createPaymentIntent(token);
    },

    // Accounting Foundation
    listLedgerAccounts: function (params) { return request('GET', '/api/accounting/accounts' + qs(params)); },
    createLedgerAccount: function (data) { return request('POST', '/api/accounting/accounts', data); },
    updateLedgerAccount: function (id, data) { return request('PATCH', '/api/accounting/accounts/' + id, data); },
    listJournalEntries: function (params) { return request('GET', '/api/accounting/journal' + qs(params)); },
    getJournalEntry: function (id) { return request('GET', '/api/accounting/journal/' + id); },
    createJournalEntry: function (data) { return request('POST', '/api/accounting/journal', data); },
    postJournalEntry: function (id) { return request('POST', '/api/accounting/journal/' + id + '/post'); },
    reverseJournalEntry: function (id, data) { return request('POST', '/api/accounting/journal/' + id + '/reverse', data); },
    getGeneralLedger: function (params) { return request('GET', '/api/accounting/reports/general-ledger' + qs(params)); },
    getProfitAndLoss: function (params) { return request('GET', '/api/accounting/reports/profit-and-loss' + qs(params)); },
    getBalanceSheet: function (params) { return request('GET', '/api/accounting/reports/balance-sheet' + qs(params)); },
    getAccountsReceivableAging: function (params) { return request('GET', '/api/accounting/reports/ar-aging' + qs(params)); },

    // Accounts Payable
    listVendors: function (params) { return request('GET', '/api/payables/vendors' + qs(params)); },
    createVendor: function (data) { return request('POST', '/api/payables/vendors', data); },
    updateVendor: function (id, data) { return request('PATCH', '/api/payables/vendors/' + id, data); },
    listBills: function (params) { return request('GET', '/api/payables/bills' + qs(params)); },
    getBill: function (id) { return request('GET', '/api/payables/bills/' + id); },
    createBill: function (data) { return request('POST', '/api/payables/bills', data); },
    approveBill: function (id) { return request('POST', '/api/payables/bills/' + id + '/approve'); },
    voidBill: function (id) { return request('POST', '/api/payables/bills/' + id + '/void'); },
    getPayablesAging: function (params) { return request('GET', '/api/payables/aging' + qs(params)); },

    // Banking & Corporate Credit Cards
    listFinancialAccounts: function (params) { return request('GET', '/api/banking/accounts' + qs(params)); },
    getFinancialAccount: function (id) { return request('GET', '/api/banking/accounts/' + id); },
    createFinancialAccount: function (data) { return request('POST', '/api/banking/accounts', data); },
    updateFinancialAccount: function (id, data) { return request('PATCH', '/api/banking/accounts/' + id, data); },
    listFinancialTransactions: function (params) { return request('GET', '/api/banking/transactions' + qs(params)); },
    getFinancialTransaction: function (id) { return request('GET', '/api/banking/transactions/' + id); },
    previewStatementImport: function (accountId, file, mapping) {
      var fd = new FormData();
      fd.append('file', file, file.name || 'statement.csv');
      fd.append('accountId', accountId);
      fd.append('mapping', typeof mapping === 'string' ? mapping : JSON.stringify(mapping));
      return upload('/api/banking/import/preview', fd);
    },
    commitStatementImport: function (batchId) { return request('POST', '/api/banking/import/' + batchId + '/commit'); },
    discardStatementImport: function (batchId) { return request('POST', '/api/banking/import/' + batchId + '/discard'); },
    categorizeTransaction: function (id, data) { return request('POST', '/api/banking/transactions/' + id + '/categorize', data); },
    matchTransaction: function (id, data) { return request('POST', '/api/banking/transactions/' + id + '/match', data); },
    excludeTransaction: function (id, data) { return request('POST', '/api/banking/transactions/' + id + '/exclude', data); },
    startReconciliation: function (data) { return request('POST', '/api/banking/reconciliations', data); },
    getReconciliation: function (id) { return request('GET', '/api/banking/reconciliations/' + id); },
    completeReconciliation: function (id, data) { return request('POST', '/api/banking/reconciliations/' + id + '/complete', data); },

    // Employees, Attendance & Leave
    listEmployees: function (params) { return request('GET', '/api/employees' + qs(params)); },
    getEmployee: function (id) { return request('GET', '/api/employees/' + id); },
    getEmployeeMe: function () { return request('GET', '/api/employees/me'); },
    createEmployee: function (data) { return request('POST', '/api/employees', data); },
    updateEmployee: function (id, data) { return request('PATCH', '/api/employees/' + id, data); },
    listAttendance: function (params) { return request('GET', '/api/employees/attendance' + qs(params)); },
    recordAttendance: function (data) { return request('POST', '/api/employees/attendance', data); },
    getLeaveBalances: function (employeeId, year) {
      return request('GET', '/api/employees/' + employeeId + '/leave-balances' + qs({ year: year }));
    },
    listLeaveRequests: function (params) { return request('GET', '/api/employees/leave-requests' + qs(params)); },
    submitLeaveRequest: function (data) { return request('POST', '/api/employees/leave-requests', data); },
    reviewLeaveRequest: function (id, data) { return request('POST', '/api/employees/leave-requests/' + id + '/review', data); },
    cancelLeaveRequest: function (id) { return request('POST', '/api/employees/leave-requests/' + id + '/cancel'); },
    updateLeaveBalance: function (employeeId, leaveType, data) {
      return request('PATCH', '/api/employees/' + employeeId + '/leave-balances/' + leaveType, data);
    },

    // Time clock
    clockIn: function (warehouseId) { return request('POST', '/api/timesheets/clock-in', { warehouseId: warehouseId }); },
    clockOut: function () { return request('POST', '/api/timesheets/clock-out'); },
    currentShift: function () { return request('GET', '/api/timesheets/me/current'); },
    shiftHistory: function (from, to) { return request('GET', '/api/timesheets/me/history' + qs({ from: from, to: to })); },
    teamShifts: function () { return request('GET', '/api/timesheets/team'); },

    // Photos
    listPhotos: function (params) { return request('GET', '/api/photos' + qs(params)); },
    getPhoto: function (id) { return request('GET', '/api/photos/' + id); },
    uploadPhoto: function (file, meta) {
      var fd = new FormData();
      fd.append('file', file, file.name || 'photo.jpg');
      Object.keys(meta || {}).forEach(function (k) {
        if (meta[k] !== undefined && meta[k] !== null && meta[k] !== '') fd.append(k, meta[k]);
      });
      return upload('/api/photos', fd);
    },
    /* Batch upload for the inventory picker. Every selected file is appended
       under the same `files` field — the mistake this replaces was keeping
       only files[0], so photos 2-15 never left the browser. The server caps
       the count at 15 regardless of what is sent here. */
    uploadPhotos: function (files, meta) {
      var fd = new FormData();
      Array.prototype.slice.call(files || []).forEach(function (f, i) {
        fd.append('files', f, f.name || ('photo-' + (i + 1) + '.jpg'));
      });
      Object.keys(meta || {}).forEach(function (k) {
        if (meta[k] !== undefined && meta[k] !== null && meta[k] !== '') fd.append(k, meta[k]);
      });
      return upload('/api/photos/batch', fd);
    },
    deletePhoto: function (id) { return request('DELETE', '/api/photos/' + id); },
    photoUrl: function (id, variant) {
      if (!id) return '';
      var t = getToken();
      var p = (typeof id === 'string' && id.indexOf('/api/photos/') === 0)
        ? id
        : (baseUrl() + '/api/photos/' + encodeURIComponent(id) + (variant ? '/' + variant : '/view'));
      return t ? (p + (p.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(t)) : p;
    },
    photoThumbnailUrl: function (id) {
      return this.photoUrl(id, 'thumbnail');
    },
    photoDownloadUrl: function (id) {
      return this.photoUrl(id, 'download');
    },

    // Purchase Orders (administrator-only server-side; see
    // purchase-orders.controller.ts). The client hiding the navigation is a
    // convenience -- every one of these 403s for a non-admin.
    //
    // These paths carry the /api prefix like every other call in this file.
    // The block that existed before was written against bare /purchase-orders,
    // which only resolves when talking to the API process directly: in
    // production nginx routes /api/* to the API and everything else to the
    // static site, so those calls were served index.html and failed to parse.
    listPurchaseOrders: function (params) { return request('GET', '/api/purchase-orders' + qs(params)); },
    getPurchaseOrder: function (id) { return request('GET', '/api/purchase-orders/' + id); },
    createPurchaseOrder: function (data) { return request('POST', '/api/purchase-orders', data); },
    updatePurchaseOrder: function (id, data) { return request('PATCH', '/api/purchase-orders/' + id, data); },
    deletePurchaseOrder: function (id) { return request('DELETE', '/api/purchase-orders/' + id); },
    nextPurchaseOrderNumber: function () { return request('GET', '/api/purchase-orders/next-number'); },
    renderPurchaseOrderPdf: function (data) { return requestBlob('POST', '/api/purchase-orders/render-pdf', data); },

    // History / Audit
    listAudit: function (params) { return request('GET', '/api/audit' + qs(params)); }
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
