// ScanLow - Terrain : application de terrain (téléphone / tablette) pour les campagnes de mesure.
// GPS à la seconde, repères avec photos, journal horodaté, informations de campagne, synchronisation (puff test),
// export d'un seul fichier .zip à importer dans ScanLow - Mission (PC). Les données restent sur l'appareil.
import { db } from './db.js';
import { makeZip } from './zip.js';

const { createApp, reactive, computed, ref, watch, nextTick, onMounted, onBeforeUnmount, markRaw } = Vue;
const APP_VERSION = '1.0';

export const POI_TYPES = [
  { k: 'meteo', l: 'Station météo', c: '#2a78d6', i: 'M4 14a4 4 0 0 1 4-4h1a5 5 0 0 1 9.6 1.5A3.5 3.5 0 0 1 18 18H8a4 4 0 0 1-4-4z' },
  { k: 'source', l: 'Source d’émission', c: '#d73027', i: 'M12 3c3 4 5 6.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-5 0 2 1 3 2 3 0-3 0-5 1-8z' },
  { k: 'parasite', l: 'Source parasite', c: '#eb6834', i: 'M12 3l9 16H3zM12 10v4M12 17h0' },
  { k: 'static', l: 'Mesure statique', c: '#7c4dff', i: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2' },
  { k: 'instrument', l: 'Instrument / capteur', c: '#1baf7a', i: 'M5 5h14v10H5zM9 19h6M12 15v4' },
  { k: 'photo', l: 'Point de vue / photo', c: '#5b6b7a', i: 'M4 8h4l2-2h4l2 2h4v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z' },
  { k: 'other', l: 'Autre', c: '#0f4c5c', i: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z' },
];
const TYPE = Object.fromEntries(POI_TYPES.map(t => [t.k, t]));
export const JOURNAL_CATS = [
  { k: 'mapping', l: 'Cartographie du site', c: '#2a78d6' }, { k: 'outside', l: 'Mesures hors site', c: '#1baf7a' },
  { k: 'static', l: 'Mesure statique', c: '#7c4dff' }, { k: 'maintenance', l: 'Maintenance instrument', c: '#eda100' },
  { k: 'calibration', l: 'Étalonnage / puff test', c: '#e87ba4' }, { k: 'pause', l: 'Pause', c: '#9e9e9e' },
  { k: 'other', l: 'Autre', c: '#0f4c5c' },
];
const CAT = Object.fromEntries(JOURNAL_CATS.map(c => [c.k, c]));
const SKY = [{ k: 'sun', l: 'Soleil' }, { k: 'few', l: 'Peu nuageux' }, { k: 'cloudy', l: 'Nuageux' }, { k: 'overcast', l: 'Couvert' },
  { k: 'rain', l: 'Pluie' }, { k: 'fog', l: 'Brouillard' }, { k: 'night', l: 'Nuit' }];
const WIND = [{ k: 'calm', l: 'Calme' }, { k: 'light', l: 'Faible' }, { k: 'moderate', l: 'Modéré' }, { k: 'strong', l: 'Fort' }, { k: 'gusty', l: 'Rafales' }];
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];

// ------------------------------------------------------------------ outils
const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const pad = (n) => String(n).padStart(2, '0');
const hms = (ms) => { if (ms == null) return '–'; const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const hm = (ms) => { if (ms == null) return '–'; const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dmy = (ms) => { const d = new Date(ms); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
const isoDate = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dur = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h} h ${pad(m)}` : `${m} min ${pad(s % 60)} s`; };
const fmt = (v, d = 0) => v == null || !Number.isFinite(+v) ? '–' : (+v).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
function haversine(a, b) {
  const R = 6371008, r = Math.PI / 180;
  const x = Math.sin((b[1] - a[1]) * r / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin((b[2] - a[2]) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
/** Heure « HH:MM:SS » du jour de `ref` (ms) -> ms ; la plus proche de ref (passage de minuit). */
function atTime(hhmmss, ref) {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(hhmmss || '').trim());
  if (!m) return null;
  const d = new Date(ref); d.setHours(+m[1], +m[2], +(m[3] || 0), 0);
  let t = d.getTime();
  if (t - ref > 12 * 3600e3) t -= 86400e3; else if (ref - t > 12 * 3600e3) t += 86400e3;
  return t;
}
/** Photo réduite (≤ 1920 px, JPEG) pour garder des exports raisonnables. */
async function shrink(file, max = 1920, q = 0.82) {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    return await new Promise(res => cv.toBlob(b => res(b || file), 'image/jpeg', q));
  } catch { return file; }
}
function newMission() {
  const now = Date.now();
  return {
    format: 'scanlow-mission', version: 1, app: 'ScanLow - Terrain ' + APP_VERSION, id: uid('m'),
    created: new Date(now).toISOString(), updated: new Date(now).toISOString(), tz_offset_min: -new Date(now).getTimezoneOffset(),
    info: { name: '', date: isoDate(now), site: '', operators: '', purpose: '', remarks: '' },
    instruments: [{ id: uid('i'), name: '', serial: '', inlet_height: null, note: '' }],
    weather: [], clock: [], puffs: [], segments: [], pois: [], journal: [], stats: { n_points: 0, distance_m: 0 },
  };
}

// ------------------------------------------------------------------ état
const S = reactive({
  tab: 'terrain', missions: [], m: null, points: markRaw([]), recording: false, fix: null, gpsError: null,
  follow: true, now: Date.now(), sheet: null, toasts: [], installEvt: null, storage: null, busy: null, hiddenAt: null,
});
let watchId = null, wakeLock = null, lastSaved = 0, saveTimer = null;

function toast(msg, kind = 'info', ms = 4000) {
  const t = { id: uid('t'), msg, kind }; S.toasts.push(t);
  setTimeout(() => { const i = S.toasts.indexOf(t); if (i >= 0) S.toasts.splice(i, 1); }, ms);
}
function save(delay = 400) {   // enregistrement de la mission (sans les points, stockés à part)
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (!S.m) return;
    S.m.updated = new Date().toISOString();
    await db.putMission(S.m);
    const i = S.missions.findIndex(x => x.id === S.m.id);
    const meta = { id: S.m.id, name: S.m.info.name, date: S.m.info.date, site: S.m.info.site, updated: S.m.updated, stats: { ...S.m.stats }, n_pois: S.m.pois.length };
    if (i >= 0) S.missions[i] = meta; else S.missions.unshift(meta);
  }, delay);
}
async function openMission(id) {
  if (S.recording) stopRec();
  const m = await db.getMission(id);
  if (!m) return;
  S.m = m;
  S.points = markRaw(await db.points(id));
  try { localStorage.setItem('scanlow-terrain.current', id); } catch { /* ignoré */ }
}
async function createMission() {
  if (S.recording) stopRec();
  const m = newMission();
  S.m = m; S.points = markRaw([]);
  await db.putMission(m);
  save(0);
  try { localStorage.setItem('scanlow-terrain.current', m.id); } catch { /* ignoré */ }
  return m;
}

// ------------------------------------------------------------------ GPS
async function lockScreen() {
  try { if ('wakeLock' in navigator && document.visibilityState === 'visible') { wakeLock = await navigator.wakeLock.request('screen'); } } catch { /* refusé */ }
}
function onFix(pos) {
  const c = pos.coords;
  S.fix = { t: pos.timestamp || Date.now(), lat: c.latitude, lon: c.longitude, alt: c.altitude, acc: c.accuracy, speed: c.speed, heading: c.heading };
  S.gpsError = null;
  if (!S.recording || !S.m) return;
  const t = S.fix.t;
  if (t - lastSaved < 900) return;          // un point par seconde au plus
  lastSaved = t;
  const p = [t, +c.latitude.toFixed(7), +c.longitude.toFixed(7), c.altitude == null ? null : +c.altitude.toFixed(1),
    c.accuracy == null ? null : +c.accuracy.toFixed(1), c.speed == null ? null : +c.speed.toFixed(2), c.heading == null || Number.isNaN(c.heading) ? null : Math.round(c.heading)];
  const prev = S.points[S.points.length - 1];
  S.points.push(p);
  if (prev && t - prev[0] < 30e3 && (c.accuracy || 0) < 50) S.m.stats.distance_m += haversine(prev, p);
  S.m.stats.n_points = S.points.length;
  db.addPoint(S.m.id, p).catch(() => toast('Enregistrement du point impossible (stockage plein ?)', 'error'));
  if (S.points.length % 15 === 0) save(0);
  window.dispatchEvent(new Event('scanlow-point'));
}
function onGpsError(e) {
  S.gpsError = e.code === 1 ? 'Accès à la position refusé : autorisez la localisation pour ce site dans le navigateur.'
    : e.code === 3 ? 'Pas de position (délai dépassé) : à l’extérieur, ciel dégagé.' : 'Position indisponible.';
}
function startGps() {
  if (!('geolocation' in navigator)) { S.gpsError = 'Ce navigateur ne donne pas accès au GPS.'; return; }
  if (watchId !== null) return;
  watchId = navigator.geolocation.watchPosition(onFix, onGpsError, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
}
async function startRec() {
  if (!S.m) await createMission();
  if (!isSecureContext) { toast('Le GPS demande une adresse sécurisée (https).', 'error', 8000); }
  startGps();
  S.recording = true; lastSaved = 0;
  S.m.segments.push({ start: Date.now(), end: null });
  await lockScreen();
  save(0);
  toast('Enregistrement démarré : gardez l’écran allumé et l’application au premier plan.', 'success', 6000);
}
function stopRec() {
  S.recording = false;
  const seg = S.m?.segments[S.m.segments.length - 1];
  if (seg && !seg.end) seg.end = Date.now();
  try { wakeLock?.release(); } catch { /* ignoré */ }
  wakeLock = null;
  save(0);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { if (S.recording) S.hiddenAt = Date.now(); return; }
  if (S.recording) {
    lockScreen();
    if (S.hiddenAt && Date.now() - S.hiddenAt > 5000) toast(`Application en arrière-plan pendant ${dur((Date.now() - S.hiddenAt) / 1000)} : le GPS a pu s’interrompre.`, 'warn', 8000);
  }
  S.hiddenAt = null;
});
setInterval(() => { S.now = Date.now(); }, 1000);

// ------------------------------------------------------------------ carte
function basemap() {
  return L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 21, maxNativeZoom: 19, attribution: '© Esri, Maxar' });
}
function poiIcon(type, big = false) {
  const t = TYPE[type] || TYPE.other, s = big ? 34 : 28;
  return L.divIcon({ className: '', iconSize: [s, s], iconAnchor: [s / 2, s / 2],
    html: `<div class="poi-pin" style="background:${t.c};width:${s}px;height:${s}px"><svg viewBox="0 0 24 24" width="${s * .58}" height="${s * .58}" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${t.i}"/></svg></div>` });
}

const MapView = {
  setup() {
    const el = ref(null);
    let map = null, line = null, halo = null, me = null, accC = null, pois = null, lastDraw = 0;
    function draw(force = false) {
      if (!map) return;
      const now = Date.now();
      if (!force && now - lastDraw < 900) return;
      lastDraw = now;
      const segs = [];   // trace coupée aux interruptions (> 30 s)
      let cur = [];
      for (let i = 0; i < S.points.length; i++) {
        const p = S.points[i];
        if (cur.length && p[0] - S.points[i - 1][0] > 30e3) { segs.push(cur); cur = []; }
        cur.push([p[1], p[2]]);
      }
      if (cur.length) segs.push(cur);
      halo.setLatLngs(segs); line.setLatLngs(segs);
    }
    function drawPois() {
      if (!pois) return;
      pois.clearLayers();
      for (const p of S.m?.pois || []) {
        const t = TYPE[p.type] || TYPE.other;
        if (p.radius_m > 0) L.circle([p.lat, p.lon], { radius: p.radius_m, color: t.c, weight: 2, fillColor: t.c, fillOpacity: .15, interactive: false }).addTo(pois);
        L.marker([p.lat, p.lon], { icon: poiIcon(p.type) }).on('click', () => editPoi(p)).addTo(pois)
          .bindTooltip(p.title || t.l, { direction: 'top', offset: [0, -14] });
      }
    }
    function drawMe() {
      if (!map || !S.fix) return;
      const ll = [S.fix.lat, S.fix.lon];
      if (!me) {
        me = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }), interactive: false, zIndexOffset: 1000 }).addTo(map);
        accC = L.circle(ll, { radius: S.fix.acc || 10, color: '#2a78d6', weight: 1, fillOpacity: .12, interactive: false }).addTo(map);
        map.setView(ll, Math.max(map.getZoom(), 17));
      } else { me.setLatLng(ll); accC.setLatLng(ll).setRadius(S.fix.acc || 10); }
      if (S.follow) map.panTo(ll, { animate: true });
    }
    const onPoint = () => draw();
    onMounted(() => {
      map = L.map(el.value, { zoomControl: false, attributionControl: true }).setView([46.6, 2.4], 6);
      basemap().addTo(map);
      L.control.scale({ imperial: false, position: 'topleft' }).addTo(map);
      halo = L.polyline([], { color: '#fff', weight: 7, opacity: .85, interactive: false }).addTo(map);
      line = L.polyline([], { color: '#fab219', weight: 4, interactive: false }).addTo(map);
      pois = L.layerGroup().addTo(map);
      map.on('dragstart', () => { S.follow = false; });
      draw(true); drawPois();
      const all = S.points.map(p => [p[1], p[2]]).concat((S.m?.pois || []).map(p => [p.lat, p.lon]));
      if (all.length) map.fitBounds(L.latLngBounds(all).pad(0.2), { maxZoom: 18 });
      drawMe();
      window.addEventListener('scanlow-point', onPoint);
      startGps();
    });
    onBeforeUnmount(() => { window.removeEventListener('scanlow-point', onPoint); map?.remove(); map = null; me = null; });
    watch(() => S.fix, drawMe);
    watch(() => [S.m?.id, JSON.stringify(S.m?.pois || [])], () => { drawPois(); draw(true); });
    const center = () => { S.follow = true; if (S.fix) map.setView([S.fix.lat, S.fix.lon], Math.max(map.getZoom(), 17)); };
    const fitAll = () => {
      const all = S.points.map(p => [p[1], p[2]]).concat((S.m?.pois || []).map(p => [p.lat, p.lon]));
      if (all.length) { S.follow = false; map.fitBounds(L.latLngBounds(all).pad(0.15), { maxZoom: 18 }); }
    };
    const elapsed = computed(() => {
      const segs = S.m?.segments || [];
      return segs.reduce((s, g) => s + ((g.end || (S.recording ? S.now : g.start)) - g.start), 0) / 1000;
    });
    const fixAge = computed(() => S.fix ? (S.now - S.fix.t) / 1000 : null);
    return { el, S, center, fitAll, elapsed, fixAge, startRec, stopRec, newPoi, fmt, dur };
  },
  template: `
  <div class="map-screen">
    <div ref="el" class="map"></div>
    <div class="status" :class="{rec: S.recording}">
      <span class="dot"></span>
      <b>{{ S.recording ? 'Enregistrement' : (S.points.length ? 'En pause' : 'Prêt') }}</b>
      <span>{{ dur(elapsed) }}</span>
      <span>{{ fmt(S.m?.stats.n_points || 0) }} pts</span>
      <span>{{ fmt((S.m?.stats.distance_m || 0) / 1000, 2) }} km</span>
      <span v-if="S.fix" :class="{bad: S.fix.acc > 25 || fixAge > 5}">± {{ fmt(S.fix.acc) }} m<template v-if="fixAge > 5"> · {{ fmt(fixAge) }} s</template></span>
      <span v-else class="bad">GPS…</span>
    </div>
    <div v-if="S.gpsError" class="gps-error">{{ S.gpsError }}</div>
    <div class="fab-col">
      <button class="fab small" :class="{on: S.follow}" @click="center" title="Me suivre" aria-label="Centrer sur ma position"><svg viewBox="0 0 24 24"><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg></button>
      <button class="fab small" @click="fitAll" title="Tout voir" aria-label="Voir toute la trace"><svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
    </div>
    <div class="bottom-actions">
      <button class="big-btn rec" :class="{on: S.recording}" @click="S.recording ? stopRec() : startRec()">
        <span class="rec-ico"></span>{{ S.recording ? 'Pause' : (S.points.length ? 'Reprendre' : 'Démarrer') }}</button>
      <button class="big-btn poi" @click="newPoi()"><svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><path d="M12 7v5M9.5 9.5h5"/></svg>Repère</button>
    </div>
  </div>`,
};

// ------------------------------------------------------------------ repères
async function newPoi(type = 'source') {
  if (!S.m) await createMission();
  const f = S.fix;
  S.sheet = { kind: 'poi', isNew: true, p: { id: uid('r'), t: Date.now(), type, title: '', note: '', lat: f?.lat ?? null, lon: f?.lon ?? null,
    acc: f?.acc ?? null, radius_m: 0, photos: [], source: f ? 'gps' : 'map' }, urls: {} };
}
async function editPoi(p) {
  const urls = {};
  for (const id of p.photos) { const b = await db.getPhoto(id); if (b) urls[id] = URL.createObjectURL(b); }
  S.sheet = { kind: 'poi', isNew: false, p: JSON.parse(JSON.stringify(p)), urls };
}
const PoiSheet = {
  setup() {
    const sh = computed(() => S.sheet);
    const el = ref(null);
    let map = null, mk = null, circ = null;
    const p = computed(() => sh.value.p);
    function place() {
      if (!map) return;
      if (p.value.lat == null) return;
      const ll = [p.value.lat, p.value.lon];
      if (!mk) {
        mk = L.marker(ll, { draggable: true, icon: poiIcon(p.value.type, true) }).addTo(map);
        mk.on('dragend', e => { const q = e.target.getLatLng(); p.value.lat = +q.lat.toFixed(7); p.value.lon = +q.lng.toFixed(7); p.value.source = 'map'; circ?.setLatLng(q); });
        circ = L.circle(ll, { radius: p.value.radius_m || 0, color: TYPE[p.value.type].c, weight: 2, fillOpacity: .15, interactive: false }).addTo(map);
      } else { mk.setLatLng(ll).setIcon(poiIcon(p.value.type, true)); circ.setLatLng(ll); }
      circ.setRadius(p.value.radius_m || 0).setStyle({ color: TYPE[p.value.type].c, fillColor: TYPE[p.value.type].c });
    }
    onMounted(async () => {
      await nextTick();
      map = L.map(el.value, { zoomControl: false, attributionControl: false });
      basemap().addTo(map);
      const ll = p.value.lat != null ? [p.value.lat, p.value.lon] : S.fix ? [S.fix.lat, S.fix.lon] : S.points.length ? [S.points.at(-1)[1], S.points.at(-1)[2]] : [46.6, 2.4];
      map.setView(ll, p.value.lat != null || S.fix ? 18 : 6);
      map.on('click', e => { p.value.lat = +e.latlng.lat.toFixed(7); p.value.lon = +e.latlng.lng.toFixed(7); p.value.source = 'map'; place(); });
      place();
    });
    onBeforeUnmount(() => { map?.remove(); map = null; mk = null; });
    watch(() => [p.value.type, p.value.radius_m], place);
    const fileEl = ref(null);
    async function addPhotos(ev) {
      const files = [...(ev.target.files || [])];
      ev.target.value = '';
      S.busy = 'Photos…';
      try {
        for (const f of files) {
          const blob = await shrink(f);
          const id = uid('p');
          await db.putPhoto(id, S.m.id, blob);
          p.value.photos.push(id);
          sh.value.urls[id] = URL.createObjectURL(blob);
        }
      } finally { S.busy = null; }
    }
    function removePhoto(id) { p.value.photos = p.value.photos.filter(x => x !== id); db.deletePhoto(id); }
    function useGps() { if (!S.fix) { toast('Pas encore de position GPS.', 'warn'); return; } Object.assign(p.value, { lat: S.fix.lat, lon: S.fix.lon, acc: S.fix.acc, source: 'gps' }); place(); map.setView([p.value.lat, p.value.lon], 18); }
    function ok() {
      if (p.value.lat == null) { toast('Placez le repère : position GPS ou appui sur la carte.', 'warn'); return; }
      const list = S.m.pois, i = list.findIndex(x => x.id === p.value.id);
      if (i >= 0) list[i] = p.value; else list.push(p.value);
      save(0); close();
      toast('Repère enregistré.', 'success');
    }
    function del() {
      if (!confirm('Supprimer ce repère et ses photos ?')) return;
      for (const id of p.value.photos) db.deletePhoto(id);
      S.m.pois = S.m.pois.filter(x => x.id !== p.value.id); save(0); close();
    }
    function close() { Object.values(sh.value.urls).forEach(u => URL.revokeObjectURL(u)); S.sheet = null; }
    return { sh, p, el, POI_TYPES, fileEl, addPhotos, removePhoto, useGps, ok, del, close, hms, fmt };
  },
  template: `
  <div class="sheet-back" @click.self="close">
    <div class="sheet">
      <div class="sheet-head"><b>{{ sh.isNew ? 'Nouveau repère' : 'Repère' }}</b><span class="muted">{{ hms(p.t) }}</span><button class="x" @click="close" aria-label="Fermer">×</button></div>
      <div class="sheet-body">
        <div class="chips">
          <button v-for="t in POI_TYPES" :key="t.k" class="chip" :class="{on: p.type===t.k}" :style="p.type===t.k ? 'background:' + t.c + ';border-color:' + t.c : ''" @click="p.type=t.k">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path :d="t.i"/></svg>{{ t.l }}</button>
        </div>
        <input class="inp" v-model="p.title" placeholder="Nom (facultatif) : ex. torchère, évent, station Gill…">
        <textarea class="inp" v-model="p.note" rows="2" placeholder="Observation : odeur, panache visible, état…"></textarea>
        <div class="photos">
          <div v-for="id in p.photos" :key="id" class="ph"><img :src="sh.urls[id]" alt=""><button @click="removePhoto(id)" aria-label="Retirer">×</button></div>
          <label class="ph add"><input ref="fileEl" type="file" accept="image/*" multiple @change="addPhotos" hidden>
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 8h4l2-2h4l2 2h4v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/></svg><span>Photo</span></label>
        </div>
        <div ref="el" class="mini-map"></div>
        <div class="row-sb small"><span class="muted">{{ p.lat != null ? (p.source === 'gps' ? 'Position GPS ± ' + fmt(p.acc) + ' m' : 'Placé sur la carte') : 'Touchez la carte pour placer le repère' }} · déplaçable</span>
          <button class="btn sm" @click="useGps">Ma position</button></div>
        <label class="lbl">Zone autour du repère : <b>{{ p.radius_m ? p.radius_m + ' m' : 'aucune' }}</b></label>
        <input type="range" min="0" max="300" step="5" v-model.number="p.radius_m">
      </div>
      <div class="sheet-foot"><button v-if="!sh.isNew" class="btn danger" @click="del">Supprimer</button><span class="grow"></span>
        <button class="btn" @click="close">Annuler</button><button class="btn primary" @click="ok">Enregistrer</button></div>
    </div>
  </div>`,
};

// ------------------------------------------------------------------ journal
const JournalView = {
  setup() {
    const cat = ref('mapping');
    const open = computed(() => (S.m?.journal || []).filter(e => !e.end));
    const timeline = computed(() => {
      if (!S.m) return [];
      const items = [
        ...S.m.journal.map(e => ({ kind: 'note', t: e.start, e })),
        ...S.m.pois.map(p => ({ kind: 'poi', t: p.t, p })),
        ...S.m.puffs.map(p => ({ kind: 'puff', t: p.t_phone, p })),
        ...S.m.segments.map(g => ({ kind: 'seg', t: g.start, g })),
      ];
      return items.sort((a, b) => b.t - a.t);
    });
    async function begin() {
      if (!S.m) await createMission();
      S.m.journal.push({ id: uid('j'), start: Date.now(), end: null, category: cat.value, text: '' });
      save(0);
    }
    function end(e) { e.end = Date.now(); save(0); }
    function insertTime(e, ev) {
      const ta = ev.target.closest('.entry').querySelector('textarea');
      const stamp = `[${hms(Date.now())}] `;
      const i = ta.selectionStart ?? e.text.length;
      e.text = e.text.slice(0, i) + (i && e.text[i - 1] !== '\n' ? '\n' : '') + stamp + e.text.slice(i);
      save();
      nextTick(() => { ta.focus(); const k = i + stamp.length + 1; ta.setSelectionRange(k, k); });
    }
    const timeIn = (ms) => ms == null ? '' : hms(ms);
    function setTime(e, key, v) { const t = atTime(v, e.start || Date.now()); if (t != null) { e[key] = t; save(); } }
    function del(e) { if (confirm('Supprimer cette note ?')) { S.m.journal = S.m.journal.filter(x => x.id !== e.id); save(0); } }
    const thumbs = reactive({});
    watch(() => S.m?.pois.map(p => p.photos[0]).join(','), async () => {
      for (const p of S.m?.pois || []) if (p.photos[0] && !thumbs[p.photos[0]]) { const b = await db.getPhoto(p.photos[0]); if (b) thumbs[p.photos[0]] = URL.createObjectURL(b); }
    }, { immediate: true });
    return { S, cat, JOURNAL_CATS, CAT, TYPE, open, timeline, begin, end, insertTime, timeIn, setTime, del, hm, hms, dur, save, thumbs, editPoi };
  },
  template: `
  <div class="page">
    <div class="card">
      <div class="lbl">Type d’observation</div>
      <div class="chips">
        <button v-for="c in JOURNAL_CATS" :key="c.k" class="chip" :class="{on: cat===c.k}" :style="cat===c.k ? 'background:' + c.c + ';border-color:' + c.c : ''" @click="cat=c.k">{{ c.l }}</button>
      </div>
      <button class="big-btn wide" @click="begin"><svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg>Début d’observation · {{ hm(S.now) }}</button>
    </div>
    <div v-if="!timeline.length" class="empty">Le journal rassemble vos notes, les repères, les puff tests et les périodes d’enregistrement GPS.</div>
    <div v-for="it in timeline" :key="it.kind + (it.e?.id || it.p?.id || it.t)">
      <div v-if="it.kind==='note'" class="entry card" :class="{open: !it.e.end}" :style="'border-left-color:' + CAT[it.e.category]?.c">
        <div class="row-sb">
          <select class="inp slim" v-model="it.e.category" @change="save()"><option v-for="c in JOURNAL_CATS" :key="c.k" :value="c.k">{{ c.l }}</option></select>
          <button class="x small" @click="del(it.e)" aria-label="Supprimer">×</button>
        </div>
        <div class="times">
          <label>Début <input type="time" step="1" :value="timeIn(it.e.start)" @change="setTime(it.e, 'start', $event.target.value)"></label>
          <label>Fin <input v-if="it.e.end" type="time" step="1" :value="timeIn(it.e.end)" @change="setTime(it.e, 'end', $event.target.value)">
            <button v-else class="btn sm stop" @click="end(it.e)">■ Terminer</button></label>
          <span class="muted small" v-if="it.e.end">{{ dur((it.e.end - it.e.start) / 1000) }}</span>
          <span class="live small" v-else>en cours · {{ dur((S.now - it.e.start) / 1000) }}</span>
        </div>
        <textarea class="inp" v-model="it.e.text" rows="3" placeholder="Notes…" @input="save()"></textarea>
        <button class="btn sm" @click="insertTime(it.e, $event)">⏱ Insérer l’heure</button>
      </div>
      <div v-else-if="it.kind==='poi'" class="mini-item" @click="editPoi(it.p)">
        <span class="pin" :style="'background:' + TYPE[it.p.type]?.c"></span>
        <div class="grow"><b>{{ it.p.title || TYPE[it.p.type]?.l }}</b><div class="muted small">{{ hms(it.p.t) }} · repère{{ it.p.photos.length ? ' · ' + it.p.photos.length + ' photo(s)' : '' }}{{ it.p.note ? ' · ' + it.p.note : '' }}</div></div>
        <img v-if="it.p.photos[0] && thumbs[it.p.photos[0]]" :src="thumbs[it.p.photos[0]]" class="thumb" alt="">
      </div>
      <div v-else-if="it.kind==='puff'" class="mini-item"><span class="pin" style="background:#e87ba4"></span>
        <div class="grow"><b>Puff test</b><div class="muted small">{{ hms(it.p.t_phone) }}{{ it.p.instrument ? ' · ' + it.p.instrument : '' }}{{ it.p.delay_s != null ? ' · délai ' + it.p.delay_s.toFixed(0) + ' s' : '' }}</div></div></div>
      <div v-else class="mini-item"><span class="pin" style="background:#fab219"></span>
        <div class="grow"><b>Enregistrement GPS</b><div class="muted small">{{ hms(it.g.start) }} → {{ it.g.end ? hms(it.g.end) : 'en cours' }}</div></div></div>
    </div>
  </div>`,
};

// ------------------------------------------------------------------ campagne
const CampaignView = {
  setup() {
    const instrTime = ref('');
    const clockInstr = ref('');
    function prefill() { const t = new Date(Date.now() + 20000); t.setSeconds(Math.ceil(t.getSeconds() / 10) * 10); instrTime.value = hms(t.getTime()); }
    prefill();
    const instruments = computed(() => (S.m?.instruments || []).map(i => i.name).filter(Boolean));
    watch(instruments, (v) => { if (!clockInstr.value && v.length) clockInstr.value = v[0]; }, { immediate: true });
    async function ensure() { if (!S.m) await createMission(); }
    async function addWeather() {
      await ensure();
      S.m.weather.unshift({ id: uid('w'), t: Date.now(), sky: null, wind: null, wind_dir: null, temperature: null, remarks: '' });
      save(0);
    }
    function addInstr() { S.m.instruments.push({ id: uid('i'), name: '', serial: '', inlet_height: null, note: '' }); save(); }
    function delInstr(i) { S.m.instruments.splice(i, 1); save(); }
    async function top() {   // l'utilisateur appuie quand l'instrument affiche l'heure saisie
      await ensure();
      const t = Date.now(), ti = atTime(instrTime.value, t);
      if (ti == null) { toast('Heure de l’instrument au format HH:MM:SS.', 'warn'); return; }
      S.m.clock.push({ id: uid('c'), t_phone: t, instrument_time: instrTime.value, offset_s: Math.round((ti - t) / 100) / 10, instrument: clockInstr.value });
      save(0); prefill();
    }
    const offsetFor = (name) => { const c = (S.m?.clock || []).filter(x => !name || x.instrument === name).at(-1); return c ? c.offset_s : null; };
    async function puff() {
      await ensure();
      S.m.puffs.push({ id: uid('f'), t_phone: Date.now(), instrument: clockInstr.value, peak_time: '', delay_s: null, note: '' });
      save(0);
      if (navigator.vibrate) navigator.vibrate(80);
      toast('Puff enregistré : notez l’heure du pic affichée par l’instrument (ou laissez le PC la trouver dans les données).', 'success', 7000);
    }
    function setPeak(p) {
      const tp = atTime(p.peak_time, p.t_phone);
      if (tp == null) { p.delay_s = null; save(); return; }
      const off = offsetFor(p.instrument) ?? 0;
      p.delay_s = Math.round(((tp - p.t_phone) / 1000 - off) * 10) / 10;
      save();
    }
    function delItem(list, id) { S.m[list] = S.m[list].filter(x => x.id !== id); save(0); }
    return { S, SKY, WIND, DIRS, instrTime, clockInstr, instruments, addWeather, addInstr, delInstr, top, puff, setPeak, offsetFor, delItem, save, hms, hm, fmt, ensure };
  },
  template: `
  <div class="page" v-if="S.m">
    <div class="card">
      <h3>Campagne</h3>
      <input class="inp" v-model="S.m.info.name" @input="save()" placeholder="Nom de la campagne">
      <div class="grid2"><label class="lbl">Date<input class="inp" type="date" v-model="S.m.info.date" @change="save()"></label>
        <label class="lbl">Site / lieu<input class="inp" v-model="S.m.info.site" @input="save()" placeholder="ex. ISDND de …"></label></div>
      <input class="inp" v-model="S.m.info.operators" @input="save()" placeholder="Opérateurs">
      <input class="inp" v-model="S.m.info.purpose" @input="save()" placeholder="Objectif : cartographie, quantification, contrôle…">
      <textarea class="inp" v-model="S.m.info.remarks" @input="save()" rows="2" placeholder="Remarques générales"></textarea>
    </div>
    <div class="card">
      <div class="row-sb"><h3>Instruments</h3><button class="btn sm" @click="addInstr">+ Ajouter</button></div>
      <div v-for="(i, k) in S.m.instruments" :key="i.id" class="instr">
        <input class="inp" v-model="i.name" @input="save()" placeholder="Instrument (ex. Aeris MIRA CH4)">
        <div class="grid3"><input class="inp" v-model="i.serial" @input="save()" placeholder="N° série">
          <input class="inp" type="number" step="0.1" v-model.number="i.inlet_height" @input="save()" placeholder="Prise (m)">
          <button class="btn sm danger" @click="delInstr(k)">Retirer</button></div>
      </div>
    </div>
    <div class="card">
      <div class="row-sb"><h3>Météo observée</h3><button class="btn sm" @click="addWeather">+ Maintenant</button></div>
      <div v-if="!S.m.weather.length" class="muted small">Ajoutez une observation au début, puis à chaque changement notable.</div>
      <div v-for="w in S.m.weather" :key="w.id" class="weather">
        <div class="row-sb"><b>{{ hm(w.t) }}</b><button class="x small" @click="delItem('weather', w.id)">×</button></div>
        <div class="chips"><button v-for="s in SKY" :key="s.k" class="chip sm" :class="{on: w.sky===s.k}" @click="w.sky = s.k; save()">{{ s.l }}</button></div>
        <div class="chips"><button v-for="s in WIND" :key="s.k" class="chip sm" :class="{on: w.wind===s.k}" @click="w.wind = s.k; save()">{{ s.l }}</button></div>
        <div class="compass">
          <span class="muted small">Vent venant du</span>
          <button v-for="(d, k) in DIRS" :key="d" class="chip sm" :class="{on: w.wind_dir===k*45}" @click="w.wind_dir = w.wind_dir===k*45 ? null : k*45; save()">{{ d }}</button>
        </div>
        <div class="grid2"><input class="inp" type="number" step="0.5" v-model.number="w.temperature" @input="save()" placeholder="T (°C)">
          <input class="inp" v-model="w.remarks" @input="save()" placeholder="Remarque"></div>
      </div>
    </div>
    <div class="card">
      <h3>Synchronisation de l’instrument</h3>
      <label class="lbl">Instrument concerné
        <select class="inp" v-model="clockInstr"><option value="">—</option><option v-for="n in instruments" :key="n" :value="n">{{ n }}</option></select></label>
      <div class="sub">1. Écart d’horloge</div>
      <p class="muted small">Saisissez une heure à venir, puis appuyez sur <b>Top</b> à l’instant exact où l’instrument l’affiche.</p>
      <div class="grid2"><input class="inp mono" v-model="instrTime" inputmode="numeric" placeholder="HH:MM:SS">
        <button class="big-btn" @click="top">Top</button></div>
      <div v-for="c in S.m.clock" :key="c.id" class="mini-item"><span class="pin" style="background:#2a78d6"></span>
        <div class="grow"><b>{{ c.offset_s > 0 ? '+' : '' }}{{ fmt(c.offset_s, 1) }} s</b><div class="muted small">instrument {{ c.instrument_time }} au top de {{ hms(c.t_phone) }}{{ c.instrument ? ' · ' + c.instrument : '' }}</div></div>
        <button class="x small" @click="delItem('clock', c.id)">×</button></div>
      <div class="sub">2. Puff test (temps de réponse)</div>
      <p class="muted small">Soufflez ou libérez le gaz à l’entrée de la ligne en appuyant sur <b>Puff</b>. Puis notez l’heure du pic affichée par l’instrument : le temps de réponse est calculé (et affiné sur PC à partir des données).</p>
      <button class="big-btn wide puff" @click="puff">Puff !</button>
      <div v-for="p in S.m.puffs" :key="p.id" class="puff-item">
        <div class="row-sb"><b>Puff · {{ hms(p.t_phone) }}</b><button class="x small" @click="delItem('puffs', p.id)">×</button></div>
        <div class="grid2"><input class="inp mono" v-model="p.peak_time" @change="setPeak(p)" placeholder="Pic sur l’instrument HH:MM:SS">
          <div class="res">{{ p.delay_s != null ? 'Temps de réponse ≈ ' + fmt(p.delay_s, 0) + ' s' + (offsetFor(p.instrument) == null ? ' (sans écart d’horloge)' : '') : '—' }}</div></div>
      </div>
    </div>
  </div>
  <div class="page" v-else><div class="empty">Aucune mission ouverte. <button class="btn primary" @click="ensure">Nouvelle mission</button></div></div>`,
};

// ------------------------------------------------------------------ missions et export
const FilesView = {
  setup() {
    async function exportZip(withPhotos = true) {
      if (!S.m) return;
      S.busy = 'Préparation de l’export…';
      try {
        const pts = await db.points(S.m.id);
        const mission = { ...JSON.parse(JSON.stringify(S.m)), track: pts, exported: new Date().toISOString(),
          device: { ua: navigator.userAgent, tz: Intl.DateTimeFormat().resolvedOptions().timeZone } };
        const files = [];
        const csv = ['heure_locale;t_utc_ms;latitude;longitude;altitude_m;precision_m;vitesse_ms;cap_deg',
          ...pts.map(p => [new Date(p[0]).toLocaleString('fr-FR'), p[0], ...p.slice(1).map(v => v == null ? '' : String(v).replace('.', ','))].join(';'))].join('\r\n');
        if (withPhotos) {
          for (const poi of mission.pois) {
            poi.photo_files = [];
            for (const id of poi.photos) { const b = await db.getPhoto(id); if (b) { const n = `photos/${id}.jpg`; files.push({ name: n, data: b }); poi.photo_files.push(n); } }
          }
        }
        files.unshift({ name: 'campaign.json', data: JSON.stringify(mission, null, 1) }, { name: 'track.csv', data: '﻿' + csv },
          { name: 'LISEZ-MOI.txt', data: `Mission ScanLow - Terrain : ${S.m.info.name || ''} (${S.m.info.date})\r\nÀ importer dans ScanLow - Mission (PC) : glisser ce fichier .zip dans la fenêtre d'accueil.\r\n` });
        const blob = await makeZip(files);
        const name = `ScanLow_Mission_${S.m.info.date}_${(S.m.info.name || 'sans_nom').normalize('NFKD').replace(/[^\w-]+/g, '_').slice(0, 40)}.zip`;
        const file = new File([blob], name, { type: 'application/zip' });
        if (navigator.canShare?.({ files: [file] })) {
          try { await navigator.share({ files: [file], title: name }); S.m.exported = new Date().toISOString(); save(0); return; }
          catch (e) { if (e.name === 'AbortError') return; }
        }
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        S.m.exported = new Date().toISOString(); save(0);
        toast(`Export : ${name} (${fmt(blob.size / 1e6, 1)} Mo)`, 'success', 6000);
      } catch (e) { toast('Export impossible : ' + e.message, 'error', 8000); }
      finally { S.busy = null; }
    }
    async function remove(m) {
      if (!confirm(`Supprimer définitivement la mission « ${m.name || 'sans nom'} » de ce téléphone (trace, repères, photos) ?`)) return;
      if (S.m?.id === m.id) { if (S.recording) stopRec(); S.m = null; S.points = markRaw([]); }
      await db.deleteMission(m.id);
      S.missions = S.missions.filter(x => x.id !== m.id);
    }
    async function install() { if (S.installEvt) { S.installEvt.prompt(); S.installEvt = null; } }
    return { S, exportZip, remove, openMission, createMission, install, fmt, dmy };
  },
  template: `
  <div class="page">
    <div class="card" v-if="S.m">
      <h3>{{ S.m.info.name || 'Mission sans nom' }}</h3>
      <div class="muted small">{{ S.m.info.site || 'site non renseigné' }} · {{ S.m.info.date }}</div>
      <div class="kpis"><div><b>{{ fmt(S.m.stats.n_points) }}</b><span>points GPS</span></div><div><b>{{ fmt(S.m.stats.distance_m / 1000, 2) }}</b><span>km</span></div>
        <div><b>{{ S.m.pois.length }}</b><span>repères</span></div><div><b>{{ S.m.journal.length }}</b><span>notes</span></div></div>
      <button class="big-btn wide" @click="exportZip(true)"><svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>Exporter la mission (.zip)</button>
      <button class="btn wide" @click="exportZip(false)">Exporter sans les photos (plus léger)</button>
      <p class="muted small">Le fichier s’importe dans <b>ScanLow - Mission</b> sur PC. Envoyez-le par le menu de partage (e-mail, OneDrive, Teams…) ou récupérez-le dans « Téléchargements ».
        <template v-if="S.m.exported"> Dernier export : {{ new Date(S.m.exported).toLocaleString('fr-FR') }}.</template></p>
    </div>
    <div class="card">
      <div class="row-sb"><h3>Missions sur cet appareil</h3><button class="btn sm primary" @click="createMission">+ Nouvelle</button></div>
      <div v-for="m in S.missions" :key="m.id" class="mini-item" :class="{cur: S.m?.id===m.id}" @click="openMission(m.id)">
        <span class="pin" :style="'background:' + (S.m?.id===m.id ? '#0f4c5c' : '#9e9e9e')"></span>
        <div class="grow"><b>{{ m.name || 'Sans nom' }}</b><div class="muted small">{{ m.date }} · {{ m.site || '—' }} · {{ fmt(m.stats?.n_points || 0) }} pts · {{ m.n_pois || 0 }} repère(s)</div></div>
        <button class="x small" @click.stop="remove(m)" aria-label="Supprimer">×</button>
      </div>
      <div v-if="!S.missions.length" class="muted small">Aucune mission.</div>
    </div>
    <div class="card">
      <h3>Conseils</h3>
      <ul class="tips">
        <li>Gardez l’écran allumé et l’application au premier plan pendant l’enregistrement : en arrière-plan, le navigateur coupe le GPS.</li>
        <li>Les données restent sur l’appareil jusqu’à l’export : exportez à la fin de chaque journée.</li>
        <li v-if="S.storage">Stockage utilisé : {{ fmt(S.storage.usage / 1e6, 0) }} Mo sur {{ fmt(S.storage.quota / 1e6, 0) }} Mo disponibles.</li>
      </ul>
      <button v-if="S.installEvt" class="btn wide primary" @click="install">Installer l’application sur l’écran d’accueil</button>
      <p class="muted small">ScanLow - Terrain {{ '${APP_VERSION}' }} · données stockées localement</p>
    </div>
  </div>`,
};

// ------------------------------------------------------------------ application
const App = {
  components: { MapView, JournalView, CampaignView, FilesView, PoiSheet },
  setup() {
    onMounted(async () => {
      try { await navigator.storage?.persist?.(); S.storage = await navigator.storage?.estimate?.(); } catch { /* ignoré */ }
      const all = await db.missions();
      S.missions = all.map(m => ({ id: m.id, name: m.info.name, date: m.info.date, site: m.info.site, updated: m.updated, stats: m.stats, n_pois: m.pois.length }))
        .sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
      let cur = null; try { cur = localStorage.getItem('scanlow-terrain.current'); } catch { /* ignoré */ }
      if (cur && S.missions.some(m => m.id === cur)) await openMission(cur);
      else if (S.missions.length) await openMission(S.missions[0].id);
      else await createMission();
    });
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEvt = e; });
    window.addEventListener('beforeunload', (e) => { if (S.recording) { e.preventDefault(); e.returnValue = ''; } });
    const tabs = [
      { k: 'terrain', l: 'Terrain', i: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14' },
      { k: 'journal', l: 'Journal', i: 'M6 3h10l3 3v15H6zM9 9h7M9 13h7M9 17h4' },
      { k: 'campagne', l: 'Campagne', i: 'M12 3v2M12 19v2M4.2 7l1.7 1M18.1 16l1.7 1M3 12h2M19 12h2M4.2 17l1.7-1M18.1 8l1.7-1M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z' },
      { k: 'fichier', l: 'Exporter', i: 'M12 4v11M7 10l5 5 5-5M5 20h14' },
    ];
    return { S, tabs, hm };
  },
  template: `
  <div class="shell">
    <header class="top"><div class="brand"><span class="logo"></span>ScanLow <b>Terrain</b></div>
      <div class="cur-name" @click="S.tab='fichier'">{{ S.m?.info.name || 'Mission sans nom' }}</div><span class="clock">{{ hm(S.now) }}</span></header>
    <main class="main">
      <map-view v-if="S.tab==='terrain' && S.m"/>
      <journal-view v-else-if="S.tab==='journal'"/>
      <campaign-view v-else-if="S.tab==='campagne'"/>
      <files-view v-else-if="S.tab==='fichier'"/>
    </main>
    <nav class="tabs">
      <button v-for="t in tabs" :key="t.k" :class="{on: S.tab===t.k}" @click="S.tab=t.k">
        <svg viewBox="0 0 24 24"><path :d="t.i"/></svg><span>{{ t.l }}</span><i v-if="t.k==='terrain' && S.recording" class="rec-badge"></i></button>
    </nav>
    <poi-sheet v-if="S.sheet?.kind==='poi'"/>
    <div class="toasts"><div v-for="t in S.toasts" :key="t.id" class="toast" :class="t.kind">{{ t.msg }}</div></div>
    <div v-if="S.busy" class="busy"><div class="spinner"></div>{{ S.busy }}</div>
  </div>`,
};

createApp(App).mount('#app');
if ('serviceWorker' in navigator && isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => { /* hors ligne indisponible */ });
