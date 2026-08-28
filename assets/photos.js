/* ==========================================================================
   Photo upload preparation.

   Photos are no longer stored in the browser (see docs/V2_ARCHITECTURE.md —
   photos are server-authoritative, uploaded to the API which puts them in
   MinIO). This module only does the client-side downscale before upload:
   a modern phone photo is 4-8 MB; downscaled to 1600px on the long edge at
   0.82 quality it's roughly 300 KB and still easily good enough to read a
   plate, a seal number or a contaminated load — worth doing before an
   upload over a warehouse wifi connection.

   This also strips EXIF, which is a quiet privacy win: phone photos carry
   GPS coordinates and you probably don't want a customer's site location
   travelling with a picture of a bin.
   ========================================================================== */
(function (global) {
  'use strict';

  var MAX_EDGE = 1600;
  var QUALITY = 0.82;

  global.Photos = {
    /* Resolves { file, width, height } — file is a re-encoded JPEG File,
       ready to hand to Api.uploadPhoto(). */
    prepare: function (file) {
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
                if (!blob) { reject(new Error('Could not process that image.')); return; }
                var name = (file.name || 'photo.jpg').replace(/\.\w+$/, '') + '.jpg';
                resolve({ file: new File([blob], name, { type: 'image/jpeg' }), width: cw, height: ch });
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
  };
})(window);
