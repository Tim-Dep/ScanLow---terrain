// Stockage sur le téléphone (IndexedDB) : missions, points GPS (un enregistrement par point), photos (Blob).
// Rien n'est envoyé sur Internet : les données ne quittent le téléphone que par l'export.

const DB_NAME = 'scanlow-terrain', DB_VERSION = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('missions', { keyPath: 'id' });
      const pts = db.createObjectStore('points', { autoIncrement: true });
      pts.createIndex('mission', 'm');
      const ph = db.createObjectStore('photos', { keyPath: 'id' });
      ph.createIndex('mission', 'm');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => resolve(out?.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const db = {
  missions: () => tx('missions', 'readonly', s => s.getAll()),
  getMission: (id) => tx('missions', 'readonly', s => s.get(id)),
  putMission: (m) => tx('missions', 'readwrite', s => s.put(JSON.parse(JSON.stringify(m)))),
  /** Point GPS : [t_ms, lat, lon, alt, précision, vitesse, cap] */
  addPoint: (mid, p) => tx('points', 'readwrite', s => s.add({ m: mid, p })),
  points: (mid) => tx('points', 'readonly', s => s.index('mission').getAll(mid)).then(r => r.map(x => x.p).sort((a, b) => a[0] - b[0])),
  putPhoto: (id, mid, blob) => tx('photos', 'readwrite', s => s.put({ id, m: mid, blob })),
  getPhoto: (id) => tx('photos', 'readonly', s => s.get(id)).then(r => r?.blob || null),
  deletePhoto: (id) => tx('photos', 'readwrite', s => s.delete(id)),
  async deleteMission(mid) {
    const d = await open();
    await new Promise((resolve, reject) => {
      const t = d.transaction(['missions', 'points', 'photos'], 'readwrite');
      t.objectStore('missions').delete(mid);
      for (const st of ['points', 'photos']) {
        const idx = t.objectStore(st).index('mission');
        idx.openKeyCursor(IDBKeyRange.only(mid)).onsuccess = (e) => { const c = e.target.result; if (c) { t.objectStore(st).delete(c.primaryKey); c.continue(); } };
      }
      t.oncomplete = resolve; t.onerror = () => reject(t.error);
    });
  },
};
