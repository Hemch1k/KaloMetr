/* ===== Фото записей: сжатие и локальное хранение ===== */
const Photos = (() => {
  const DB_NAME = 'kalometr_photos';
  const STORE = 'photos';
  const LS_KEY = 'calometr_photos_v1';
  const cache = new Map();

  let backend = null;
  let dbPromise = null;
  let seq = 0;

  const newId = () => 'ph_' + Date.now().toString(36) + '_' +
    (seq++).toString(36) + '_' + Math.random().toString(36).slice(2, 8);

  function lsRead() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (_) { return {}; }
  }
  function lsWrite(obj) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(obj)); } catch (_) {}
  }

  function ensure() {
    if (backend) return Promise.resolve(backend);
    if (typeof indexedDB === 'undefined') {
      backend = 'ls';
      return Promise.resolve(backend);
    }
    if (!dbPromise) {
      dbPromise = new Promise((res, rej) => {
        const rq = indexedDB.open(DB_NAME, 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore(STORE);
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => rej(rq.error);
      });
      dbPromise.then(
        (d) => { db = d; backend = 'idb'; },
        () => { backend = 'ls'; dbPromise = null; }
      );
    }
    return dbPromise.then(() => backend, () => backend);
  }
  let db = null;

  function idbReq(mode, fn) {
    return new Promise((res, rej) => {
      const rq = fn(db.transaction(STORE, mode).objectStore(STORE));
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  }

  async function put(dataURL) {
    if (!dataURL) return null;
    const id = newId();
    cache.set(id, dataURL);
    await ensure();
    if (backend === 'idb') {
      try {
        await idbReq('readwrite', (s) => s.put(dataURL, id));
        return id;
      } catch (_) {}
    }
    const o = lsRead();
    o[id] = dataURL;
    lsWrite(o);
    return id;
  }

  async function get(id) {
    if (!id) return null;
    if (cache.has(id)) return cache.get(id);
    await ensure();
    let v = null;
    if (backend === 'idb') {
      try { v = (await idbReq('readonly', (s) => s.get(id))) || null; } catch (_) { v = null; }
    }
    if (v == null) v = lsRead()[id] || null;
    if (v) cache.set(id, v);
    return v || null;
  }

  async function del(id) {
    if (!id) return;
    cache.delete(id);
    await ensure();
    if (backend === 'idb') {
      try {
        await idbReq('readwrite', (s) => s.delete(id));
        return;
      } catch (_) {}
    }
    const o = lsRead();
    delete o[id];
    lsWrite(o);
  }

  async function clear() {
    cache.clear();
    await ensure();
    if (backend === 'idb') {
      try { await idbReq('readwrite', (s) => s.clear()); } catch (_) {}
    }
    try { localStorage.removeItem(LS_KEY); } catch (_) {}
  }

  async function compress(file, maxDim = 1000, quality = 0.62) {
    if (!file) throw new Error('no_file');
    if (file.type && !/^image\//.test(file.type)) throw new Error('not_image');

    let src = null;
    if (typeof createImageBitmap === 'function') {
      try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (_) { src = null; }
    }
    if (!src) {
      const url = URL.createObjectURL(file);
      try {
        src = await new Promise((res, rej) => {
          const im = new Image();
          im.onload = () => res(im);
          im.onerror = () => rej(new Error('decode'));
          im.src = url;
        });
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    const w = src.width, h = src.height;
    if (!w || !h) throw new Error('decode');
    const scale = Math.min(1, maxDim / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('canvas');
    ctx.drawImage(src, 0, 0, cw, ch);
    if (typeof src.close === 'function') src.close();
    const dataURL = c.toDataURL('image/jpeg', quality);
    if (!dataURL || dataURL.indexOf('data:image') !== 0) throw new Error('encode');
    return dataURL;
  }

  return { put, get, del, clear, compress };
})();
