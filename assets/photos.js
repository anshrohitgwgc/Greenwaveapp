/* ==========================================================================
   Photo storage.

   Photos go in IndexedDB, not localStorage. localStorage caps out around
   5 MB and stores text only — a handful of phone photos would fill it and
   break the whole app. IndexedDB holds Blobs and is measured in hundreds
   of megabytes.

   Images are downscaled to 1600px on the long edge before saving. A modern
   phone photo is 4-8 MB; at that size it is roughly 300 KB and still easily
   good enough to read a plate, a seal number or a contaminated load.
   ========================================================================== */
(function (global) {
  'use strict';

  var DB = 'greenwave-photos';
  var STORE = 'photos';
  var MAX_EDGE = 1600;
  var QUALITY = 0.82;
  var memoryStore = [];

  function hasIDB() {
    try {
      return typeof window !== 'undefined' && 'indexedDB' in window && window.indexedDB !== null;
    } catch (e) {
      return false;
    }
  }

  function open() {
    return new Promise(function (resolve, reject) {
      if (!hasIDB()) {
        return reject(new Error('IndexedDB not available'));
      }
      try {
        var req = indexedDB.open(DB, 1);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains(STORE)) {
            var os = db.createObjectStore(STORE, { keyPath: 'id' });
            os.createIndex('at', 'at');
            os.createIndex('ticketId', 'ticketId');
          }
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error || new Error('Could not open photos database')); };
      } catch (err) {
        reject(err);
      }
    });
  }

  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode);
        var os = t.objectStore(STORE);
        var out = fn(os);
        t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  /* Downscale in a canvas. Also strips EXIF, which is a quiet privacy win:
     phone photos carry GPS coordinates and you probably don't want a
     customer's site location travelling with a picture of a bin. */
  function shrink(file) {
    return new Promise(function (resolve, reject) {
      try {
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
          try {
            var w = img.naturalWidth, h = img.naturalHeight;
            var scale = Math.min(1, MAX_EDGE / Math.max(w, h));
            var cw = Math.round(w * scale), ch = Math.round(h * scale);
            var c = document.createElement('canvas');
            c.width = cw; c.height = ch;
            c.getContext('2d').drawImage(img, 0, 0, cw, ch);
            URL.revokeObjectURL(url);
            c.toBlob(function (blob) {
              if (blob) resolve({ blob: blob, width: cw, height: ch });
              else reject(new Error('Could not process that image.'));
            }, 'image/jpeg', QUALITY);
          } catch (e) {
            URL.revokeObjectURL(url);
            reject(e);
          }
        };
        img.onerror = function () {
          URL.revokeObjectURL(url);
          reject(new Error('That file is not an image this browser can read.'));
        };
        img.src = url;
      } catch (err) {
        reject(err);
      }
    });
  }

  global.Photos = {
    add: function (file, meta) {
      return shrink(file).then(function (r) {
        var rec = {
          id: 'ph_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          at: new Date().toISOString(),
          name: file.name || 'photo.jpg',
          size: r.blob.size,
          width: r.width,
          height: r.height,
          blob: r.blob,
          staffId: (meta && meta.staffId) || null,
          staffName: (meta && meta.staffName) || '',
          entity: (meta && meta.entity) || '',
          warehouseId: (meta && meta.warehouseId) || '',
          ticketId: (meta && meta.ticketId) || '',
          note: (meta && meta.note) || ''
        };
        return tx('readwrite', function (os) { os.put(rec); })
          .then(function () { return rec; })
          .catch(function () {
            memoryStore.push(rec);
            return rec;
          });
      });
    },

    all: function () {
      return open().then(function (db) {
        return new Promise(function (resolve, reject) {
          var out = [];
          var t = db.transaction(STORE, 'readonly');
          var req = t.objectStore(STORE).openCursor();
          req.onsuccess = function () {
            var c = req.result;
            if (c) { out.push(c.value); c.continue(); }
            else resolve(out.concat(memoryStore).sort(function (a, b) { return b.at.localeCompare(a.at); }));
          };
          req.onerror = function () { reject(req.error); };
        });
      }).catch(function () {
        return memoryStore.slice().sort(function (a, b) { return b.at.localeCompare(a.at); });
      });
    },

    remove: function (id) {
      memoryStore = memoryStore.filter(function (x) { return x.id !== id; });
      return tx('readwrite', function (os) { os.delete(id); }).catch(function () {});
    },

    clear: function () {
      memoryStore = [];
      return tx('readwrite', function (os) { os.clear(); }).catch(function () {});
    },

    /* Rough space report, so nobody is surprised by a full device. */
    usage: function () {
      try {
        if (navigator.storage && navigator.storage.estimate) {
          return navigator.storage.estimate().then(function (e) {
            return { used: e.usage || 0, quota: e.quota || 0 };
          }).catch(function () { return null; });
        }
      } catch (e) {}
      return Promise.resolve(null);
    }
  };
})(window);
