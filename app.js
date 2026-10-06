// ScanLow - Terrain : application de terrain (téléphone / tablette) pour les campagnes de mesure.
// La campagne est créée d'abord (nom, date, site, instruments), puis : enregistrements GPS distincts (cartographie sur
// site, mesure en voiture hors site…), repères avec photos prises dans l'application, cahier de notes, météo,
// synchronisation de l'instrument (écart d'horloge + puff test), export d'un seul fichier .zip pour ScanLow - Mission (PC).
// Les données restent sur l'appareil.
import { db } from './db.js';
import { makeZip } from './zip.js';

const { createApp, reactive, computed, ref, watch, nextTick, onMounted, onBeforeUnmount, markRaw } = Vue;
const APP_VERSION = '1.2.3';

export const POI_TYPES = [
  { k: 'meteo', l: 'Station météo', c: '#2a78d6', i: 'M4 14a4 4 0 0 1 4-4h1a5 5 0 0 1 9.6 1.5A3.5 3.5 0 0 1 18 18H8a4 4 0 0 1-4-4z' },
  { k: 'source', l: 'Source d’émission', c: '#d73027', i: 'M12 3c3 4 5 6.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-5 0 2 1 3 2 3 0-3 0-5 1-8z' },
  { k: 'parasite', l: 'Source parasite', c: '#eb6834', i: 'M12 3l9 16H3zM12 10v4M12 17h0' },
  { k: 'static', l: 'Mesure statique', c: '#7c4dff', i: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2' },
  { k: 'observation', l: 'Observation', c: '#5b6b7a', i: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z' },
  { k: 'other', l: 'Autre', c: '#0f4c5c', i: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z' },
];
const TYPE = Object.fromEntries(POI_TYPES.map(t => [t.k, t]));
const OLD_TYPES = { photo: 'observation', instrument: 'other' };          // types de la version 1.0
export const REC_KINDS = [
  { k: 'site', l: 'Cartographie sur site', c: '#2a78d6' },
  { k: 'outside', l: 'Mesure en voiture hors site', c: '#1baf7a' },
  { k: 'static', l: 'Mesure statique', c: '#7c4dff' },
  { k: 'walk', l: 'Parcours à pied', c: '#c2185b' },
  { k: 'other', l: 'Autre', c: '#0f4c5c' },
];
const KIND = Object.fromEntries(REC_KINDS.map(k => [k.k, k]));
const OLD_CATS = { mapping: 'Cartographie du site', outside: 'Mesures hors site', static: 'Mesure statique', maintenance: 'Maintenance instrument',
  calibration: 'Étalonnage / puff test', pause: 'Pause', other: 'Autre' };
const SKY = [{ k: 'sun', l: 'Soleil', e: '☀️' }, { k: 'few', l: 'Peu nuageux', e: '🌤️' }, { k: 'cloudy', l: 'Nuageux', e: '⛅' },
  { k: 'overcast', l: 'Couvert', e: '☁️' }, { k: 'rain', l: 'Pluie', e: '🌧️' }, { k: 'fog', l: 'Brouillard', e: '🌫️' }, { k: 'night', l: 'Nuit', e: '🌙' }];
const SKYK = Object.fromEntries(SKY.map(s => [s.k, s]));
const WIND = [{ k: 'calm', l: 'Calme' }, { k: 'light', l: 'Faible' }, { k: 'moderate', l: 'Modéré' }, { k: 'strong', l: 'Fort' }, { k: 'gusty', l: 'Rafales' }];
const WINDK = Object.fromEntries(WIND.map(s => [s.k, s]));
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
const PURPOSES = ['Cartographie', 'Quantification', 'Contrôle périodique', 'Recherche de fuites', 'Mesure statique'];
const DIMS = [{ k: 0, l: 'Normal', a: 0 }, { k: 1, l: 'Atténué', a: 0.4 }, { k: 2, l: 'Très atténué', a: 0.65 }];

// ------------------------------------------------------------------ outils
const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const pad = (n) => String(n).padStart(2, '0');
const hms = (ms) => { if (ms == null) return '–'; const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const hm = (ms) => { if (ms == null) return '–'; const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const hmsUtc = (ms) => { if (ms == null) return '–'; const d = new Date(ms); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; };
const zoneLabel = () => { const z = -new Date().getTimezoneOffset(); return `UTC${z >= 0 ? '+' : '−'}${pad(Math.floor(Math.abs(z) / 60))}:${pad(Math.abs(z) % 60)}`; };
/** Objectifs cochés + précision libre -> texte (lu par l'outil PC). */
function purposeText(info) { return [...(info.purposes || []), (info.purpose_extra || '').trim()].filter(Boolean).join(', '); }
const isoDate = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dur = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h} h ${pad(m)}` : `${m} min ${pad(s % 60)} s`; };
const fmt = (v, d = 0) => v == null || !Number.isFinite(+v) ? '–' : (+v).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const signed = (v, d = 1) => v == null ? '–' : (v > 0 ? '+' : '') + fmt(v, d);
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
function haversine(a, b) {
  const R = 6371008, r = Math.PI / 180;
  const x = Math.sin((b[1] - a[1]) * r / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin((b[2] - a[2]) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
/** Heure « HH:MM:SS » du jour de `ref` (ms) -> ms ; la plus proche de ref (passage de minuit). utc : heure lue en UTC. */
function atTime(hhmmss, ref, utc = false) {
  const m = /^(\d{1,2})[:h](\d{2})(?::(\d{2}))?$/.exec(String(hhmmss || '').trim());
  if (!m) return null;
  const d = new Date(ref);
  if (utc) d.setUTCHours(+m[1], +m[2], +(m[3] || 0), 0); else d.setHours(+m[1], +m[2], +(m[3] || 0), 0);
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
const pref = (k, d) => { try { const v = localStorage.getItem('scanlow-terrain.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem('scanlow-terrain.' + k, JSON.stringify(v)); } catch { /* ignoré */ } };

function newMission(info = {}, instruments = []) {
  const now = Date.now();
  return {
    format: 'scanlow-mission', version: 2, app: 'ScanLow - Terrain ' + APP_VERSION, id: uid('m'),
    created: new Date(now).toISOString(), updated: new Date(now).toISOString(), tz_offset_min: -new Date(now).getTimezoneOffset(),
    time_info: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, tz_offset_min: -new Date(now).getTimezoneOffset() },
    info: { name: '', client: '', date: isoDate(now), site: '', operators: '', purposes: [], purpose_extra: '', purpose: '', remarks: '', ...info },
    instruments: instruments.length ? instruments : [{ id: uid('i'), name: '', serial: '', species: '', note: '' }],
    recordings: [], active_rec: null, clock_ref: 'local', weather: [], clock: [], puffs: [], segments: [], pois: [], journal: [],
    stats: { n_points: 0, distance_m: 0, by_rec: {} },
  };
}
/** Missions créées par la version 1.0 : enregistrement unique, anciens types de repères, journal début / fin. */
function migrate(m) {
  if (!m.recordings) m.recordings = (m.segments || []).length ? [{ id: 'rec1', name: 'Enregistrement 1', kind: 'site', created: m.segments[0].start }] : [];
  for (const s of m.segments || []) if (!s.rec && m.recordings[0]) s.rec = m.recordings[0].id;
  for (const p of m.pois || []) if (OLD_TYPES[p.type]) p.type = OLD_TYPES[p.type];
  for (const e of m.journal || []) { if (e.t == null) e.t = e.start ?? Date.now(); if (!e.photos) e.photos = []; }
  for (const p of m.puffs || []) if (p.t_peak === undefined) p.t_peak = null;
  m.stats = m.stats || { n_points: 0, distance_m: 0 };
  m.stats.by_rec = m.stats.by_rec || {};
  if (m.active_rec === undefined) m.active_rec = m.recordings.at(-1)?.id || null;
  if (!Array.isArray(m.info.purposes)) { m.info.purposes = (m.info.purpose || '').split(',').map(x => x.trim()).filter(Boolean); m.info.purpose_extra = ''; }
  for (const c of m.clock || []) if (!c.ref) c.ref = 'local';
  if (!m.clock_ref) m.clock_ref = 'local';
  m.version = 2;
  return m;
}
/** Enregistrement auquel appartient un instant (points de la version 1.0, sans identifiant). */
function recAt(m, t) {
  for (const s of m.segments) if (t >= s.start - 2000 && t <= (s.end || Infinity) + 2000) return s.rec || null;
  return m.recordings.at(-1)?.id || null;
}

// ------------------------------------------------------------------ état
const S = reactive({
  screen: 'home', tab: 'terrain', missions: [], m: null, points: markRaw([]), recording: false, fix: null, fixAt: 0, gpsError: null,
  gpsLost: null, follow: true, now: Date.now(), sheet: null, cam: null, toasts: [], installEvt: null, storage: null, busy: null,
  hiddenAt: null, black: false, flash: 0,
  set: { alarm: pref('alarm', true), gpsLostS: pref('gpsLostS', 10), dim: pref('dim', 0), flashAlarm: pref('flashAlarm', true) },
});
watch(() => ({ ...S.set }), (v) => { for (const k in v) setPref(k, v[k]); }, { deep: true });
let watchId = null, wakeLock = null, lastSaved = 0, saveTimer = null, lastAlarm = 0;

function toast(msg, kind = 'info', ms = 4000) {
  const t = { id: uid('t'), msg, kind }; S.toasts.push(t);
  setTimeout(() => { const i = S.toasts.indexOf(t); if (i >= 0) S.toasts.splice(i, 1); }, ms);
}
const metaOf = (m) => ({ id: m.id, name: m.info.name, date: m.info.date, site: m.info.site, updated: m.updated, stats: { n_points: m.stats.n_points, distance_m: m.stats.distance_m },
  n_pois: m.pois.length, n_recs: (m.recordings || []).length });
function save(delay = 400) {   // enregistrement de la mission (sans les points, stockés à part)
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (!S.m) return;
    S.m.updated = new Date().toISOString();
    await db.putMission(JSON.parse(JSON.stringify(S.m)));
    const i = S.missions.findIndex(x => x.id === S.m.id), meta = metaOf(S.m);
    if (i >= 0) S.missions[i] = meta; else S.missions.unshift(meta);
  }, delay);
}
async function openMission(id) {
  if (S.recording) stopRec();
  const m = await db.getMission(id);
  if (!m) return;
  S.m = migrate(m);
  S.points = markRaw(await db.points(id));
  S.screen = 'app'; S.tab = 'terrain';
  setPref('current', id);
}
async function createMission(info, instruments) {
  if (S.recording) stopRec();
  const m = newMission(info, instruments);
  S.m = m; S.points = markRaw([]);
  await db.putMission(JSON.parse(JSON.stringify(m)));
  save(0);
  setPref('current', m.id);
  S.screen = 'app';
  return m;
}
function goHome() {
  if (S.recording) { toast('Mettez d’abord l’enregistrement GPS en pause.', 'warn'); return; }
  S.screen = 'home';
}
const recById = (id) => S.m?.recordings.find(r => r.id === id) || null;
/** Teinte légèrement différente pour chaque enregistrement d'un même type : 1er = couleur du type, puis plus clair / plus foncé. */
function shade(hex, k) {
  if (!k) return hex;
  const n = parseInt(hex.slice(1), 16), rgb = [n >> 16, (n >> 8) & 255, n & 255];
  const f = Math.min(0.55, 0.22 * Math.ceil(k / 2)), to = k % 2 ? 255 : 0;
  return '#' + rgb.map(v => Math.round(v + (to - v) * (to ? f : f * 0.85)).toString(16).padStart(2, '0')).join('');
}
const recColor = (id) => {
  const r = recById(id);
  if (!r) return '#fab219';
  const same = S.m.recordings.filter(x => x.kind === r.kind);
  return shade(KIND[r.kind]?.c || '#0f4c5c', same.indexOf(r));
};
const recName = (id) => recById(id)?.name || 'Enregistrement';

// ------------------------------------------------------------------ alarmes (son + vibration + écran qui clignote)
// Le son passe par un élément <audio> (canal « médias ») plutôt que par Web Audio : sur iPhone, il n'est alors pas coupé
// par l'interrupteur silencieux (session audio « lecture » quand le navigateur le permet). Sur Android, il suit le volume
// des médias : une page web ne peut ni monter le volume ni lever le mode silencieux, d'où l'alarme visuelle en plus.
const PATTERNS = {
  gps: { tones: [[1000, .16], [0, .07], [760, .16], [0, .07], [1000, .16], [0, .07], [760, .22]], vib: [300, 100, 300, 100, 500] },
  screen: { tones: [[1300, .12], [0, .06], [1300, .12], [0, .06], [1300, .12]], vib: [200, 80, 200] },
  ok: { tones: [[880, .09], [1320, .14]], vib: [60] },
  tick: { tones: [[1500, .06]], vib: [40] },
};
function wavUrl(tones, vol = 0.95) {   // son carré généré (WAV 16 bits mono) : aucun fichier à télécharger
  const rate = 22050, n = Math.ceil(tones.reduce((t, [, d]) => t + d, 0) * rate);
  const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  let i = 0;
  for (const [f, d] of tones) {
    const m = Math.round(d * rate);
    for (let k = 0; k < m && i < n; k++, i++) {
      const x = f ? (Math.sin(2 * Math.PI * f * k / rate) >= 0 ? 1 : -1) * Math.min(1, k / 150, (m - k) / 150) * vol : 0;
      v.setInt16(44 + i * 2, Math.round(x * 26000), true);
    }
  }
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}
const players = {};
let audioReady = false;
function unlockAudio() {   // au premier appui : les éléments audio sont « débloqués » pour pouvoir sonner plus tard
  if (audioReady) return;
  audioReady = true;
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* non pris en charge */ }
  for (const k of Object.keys(PATTERNS)) {
    const a = new Audio(wavUrl(PATTERNS[k].tones));
    a.preload = 'auto';
    players[k] = a;
    a.muted = true;
    a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; });
  }
}
document.addEventListener('pointerdown', unlockAudio, { capture: true, passive: true });
function beep(kind = 'gps', force = false) {
  if (!S.set.alarm && !force) return;
  const p = PATTERNS[kind];
  try { navigator.vibrate?.(p.vib); } catch { /* ignoré */ }
  if ((kind === 'gps' || kind === 'screen') && S.set.flashAlarm) {
    const t = Date.now(); S.flash = t;
    setTimeout(() => { if (S.flash === t) S.flash = 0; }, 3500);
  }
  const a = players[kind];
  if (a) { try { a.currentTime = 0; a.volume = 1; a.play().catch(() => { /* son bloqué */ }); } catch { /* ignoré */ } }
}

// ------------------------------------------------------------------ GPS
async function lockScreen() {
  try {
    if (!wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; if (S.recording && document.visibilityState === 'visible') lockScreen(); });
    }
  } catch { /* refusé */ }
}
function onFix(pos) {
  const c = pos.coords;
  S.fix = { t: pos.timestamp || Date.now(), lat: c.latitude, lon: c.longitude, alt: c.altitude, acc: c.accuracy, speed: c.speed, heading: c.heading };
  S.fixAt = Date.now();
  S.gpsError = null;
  if (S.gpsLost) gpsBack();
  if (!S.recording || !S.m) return;
  const t = S.fix.t;
  if (t - lastSaved < 900) return;          // un point par seconde au plus
  lastSaved = t;
  const rec = S.m.active_rec;
  const p = [t, +c.latitude.toFixed(7), +c.longitude.toFixed(7), c.altitude == null ? null : +c.altitude.toFixed(1),
    c.accuracy == null ? null : +c.accuracy.toFixed(1), c.speed == null ? null : +c.speed.toFixed(2), c.heading == null || Number.isNaN(c.heading) ? null : Math.round(c.heading), rec];
  const prev = S.points[S.points.length - 1];
  S.points.push(p);
  if (prev && (prev[7] ?? rec) === rec && t - prev[0] < 30e3 && (c.accuracy || 0) < 50) {
    const d = haversine(prev, p);
    S.m.stats.distance_m += d;
    S.m.stats.by_rec[rec] = (S.m.stats.by_rec[rec] || 0) + d;
  }
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
function endSegment() { const seg = S.m?.segments.at(-1); if (seg && !seg.end) seg.end = Date.now(); }
function newRecording(kind, name) {
  const n = S.m.recordings.filter(r => r.kind === kind).length + 1;
  const r = { id: uid('g'), kind, name: (name || '').trim() || `${KIND[kind].l} ${n}`, created: Date.now() };
  S.m.recordings.push(r);
  return r;
}
async function startRec(recId) {
  unlockAudio();
  if (!isSecureContext) toast('Le GPS demande une adresse sécurisée (https).', 'error', 8000);
  if (S.recording) endSegment();
  S.m.active_rec = recId;
  startGps();
  S.recording = true; lastSaved = 0; S.gpsLost = null;
  S.m.segments.push({ start: Date.now(), end: null, rec: recId });
  await lockScreen();
  save(0);
  toast(`Enregistrement « ${recName(recId)} » : gardez l’écran allumé et l’application au premier plan.`, 'success', 6000);
}
function stopRec() {
  S.recording = false;
  endSegment();
  try { wakeLock?.release(); } catch { /* ignoré */ }
  wakeLock = null; S.gpsLost = null;
  save(0);
}
function gpsBack() {
  const s = (Date.now() - S.gpsLost) / 1000;
  S.gpsLost = null;
  if (S.recording) { beep('ok'); toast(`GPS retrouvé (interruption de ${dur(s)}).`, 'success'); }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { if (S.recording) { S.hiddenAt = Date.now(); beep('screen'); } return; }
  if (S.recording) {
    lockScreen();
    if (S.hiddenAt && Date.now() - S.hiddenAt > 3000) {
      beep('screen');
      toast(`Écran éteint ou application en arrière-plan pendant ${dur((Date.now() - S.hiddenAt) / 1000)} : le GPS a pu s’interrompre.`, 'warn', 9000);
    }
  }
  S.hiddenAt = null;
});
setInterval(() => {   // horloge et surveillance du GPS pendant l'enregistrement
  S.now = Date.now();
  if (!S.recording || document.visibilityState !== 'visible') return;
  const segStart = S.m?.segments.at(-1)?.start || S.now;
  const silent = (S.now - Math.max(S.fixAt || 0, segStart)) / 1000;
  if (silent > S.set.gpsLostS) {
    if (!S.gpsLost) { S.gpsLost = Math.max(S.fixAt || 0, segStart); beep('gps'); lastAlarm = S.now; }
    else if (S.now - lastAlarm > 30000) { beep('gps'); lastAlarm = S.now; }
  }
}, 1000);

// ------------------------------------------------------------------ caméra intégrée
function openCamera(onShot) { S.cam = { onShot: markRaw(onShot) }; }
async function storePhoto(blob) { const id = uid('p'); await db.putPhoto(id, S.m.id, blob); return id; }
const CameraView = {
  setup() {
    const video = ref(null), fileEl = ref(null);
    const st = reactive({ ready: false, err: null, shots: 0, last: null, torch: false, hasTorch: false, flash: false });
    let stream = null;
    onMounted(async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error(), { name: 'NotSupported' });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false });
        video.value.srcObject = stream;
        await video.value.play();
        st.ready = true;
        st.hasTorch = !!stream.getVideoTracks()[0]?.getCapabilities?.().torch;
      } catch (e) {
        st.err = e.name === 'NotAllowedError' ? 'Accès à la caméra refusé : autorisez-le pour ce site dans le navigateur.'
          : `Caméra indisponible dans l’application (${e.name || 'erreur'}).`;
      }
    });
    onBeforeUnmount(() => { stream?.getTracks().forEach(t => t.stop()); if (st.last) URL.revokeObjectURL(st.last); });
    async function shoot() {
      const v = video.value;
      if (!st.ready || !v.videoWidth) return;
      const k = Math.min(1, 1920 / Math.max(v.videoWidth, v.videoHeight));
      const cv = document.createElement('canvas');
      cv.width = Math.round(v.videoWidth * k); cv.height = Math.round(v.videoHeight * k);
      cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height);
      st.flash = true; setTimeout(() => { st.flash = false; }, 140);
      try { navigator.vibrate?.(30); } catch { /* ignoré */ }
      const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.85));
      if (!blob) return;
      if (st.last) URL.revokeObjectURL(st.last);
      st.last = URL.createObjectURL(blob); st.shots++;
      await S.cam.onShot(blob);
    }
    async function torch() {
      const tr = stream?.getVideoTracks()[0];
      if (!tr) return;
      st.torch = !st.torch;
      try { await tr.applyConstraints({ advanced: [{ torch: st.torch }] }); } catch { st.torch = false; }
    }
    async function fromFiles(ev) {   // repli : appareil photo du système ou galerie
      const files = [...(ev.target.files || [])];
      ev.target.value = '';
      for (const f of files) { await S.cam.onShot(await shrink(f)); st.shots++; }
      if (files.length) close();
    }
    function close() { S.cam = null; }
    return { video, fileEl, st, shoot, torch, fromFiles, close };
  },
  template: `
  <div class="cam">
    <video ref="video" playsinline muted autoplay></video>
    <div v-if="st.flash" class="cam-flash"></div>
    <div class="cam-top"><button class="cam-x" @click="close" aria-label="Fermer">×</button>
      <span>{{ st.shots ? st.shots + ' photo(s)' : 'Photo' }}</span>
      <button v-if="st.hasTorch" class="cam-x" :class="{on: st.torch}" @click="torch" aria-label="Lampe">ϟ</button><span v-else style="width:44px"></span></div>
    <div v-if="st.err" class="cam-err">{{ st.err }}
      <label class="btn primary wide">Utiliser l’appareil photo du téléphone<input type="file" accept="image/*" capture="environment" hidden @change="fromFiles"></label>
      <label class="btn wide">Choisir dans la galerie<input type="file" accept="image/*" multiple hidden @change="fromFiles"></label></div>
    <div class="cam-bottom">
      <div class="cam-last"><img v-if="st.last" :src="st.last" alt=""></div>
      <button class="shutter" :disabled="!st.ready" @click="shoot" aria-label="Prendre la photo"><span></span></button>
      <button class="cam-done" @click="close">{{ st.shots ? 'Terminé' : 'Fermer' }}</button>
    </div>
    <label v-if="!st.err" class="cam-gal">Galerie<input type="file" accept="image/*" multiple hidden @change="fromFiles"></label>
  </div>`,
};

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
/** Trace découpée aux coupures (> 30 s) et aux changements d'enregistrement. */
function trackRuns() {
  const runs = [];
  let cur = null;
  for (let i = 0; i < S.points.length; i++) {
    const p = S.points[i], rec = p[7] ?? recAt(S.m, p[0]);
    if (!cur || cur.rec !== rec || p[0] - S.points[i - 1][0] > 30e3) { cur = { rec, ll: [] }; runs.push(cur); }
    cur.ll.push([p[1], p[2]]);
  }
  return runs;
}

const MapView = {
  setup() {
    const el = ref(null);
    let map = null, layers = [], me = null, accC = null, pois = null, lastDraw = 0;
    function draw(force = false) {
      if (!map) return;
      const now = Date.now();
      if (!force && now - lastDraw < (S.set.dim ? 5000 : 900)) return;
      lastDraw = now;
      const runs = trackRuns();
      runs.forEach((r, i) => {
        const col = recColor(r.rec);
        if (!layers[i]) layers[i] = [L.polyline([], { color: '#fff', weight: 7, opacity: .85, interactive: false }).addTo(map), L.polyline([], { weight: 4, interactive: false }).addTo(map)];
        layers[i][0].setLatLngs(r.ll); layers[i][1].setLatLngs(r.ll).setStyle({ color: col });
      });
      for (const l of layers.splice(runs.length)) { l[0].remove(); l[1].remove(); }
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
      if (S.follow) map.panTo(ll, { animate: !S.set.dim });
    }
    const onPoint = () => draw();
    onMounted(() => {
      map = L.map(el.value, { zoomControl: false, attributionControl: true }).setView([46.6, 2.4], 6);
      basemap().addTo(map);
      L.control.scale({ imperial: false, position: 'topleft' }).addTo(map);
      pois = L.layerGroup().addTo(map);
      map.on('dragstart', () => { S.follow = false; });
      draw(true); drawPois();
      const all = S.points.map(p => [p[1], p[2]]).concat((S.m?.pois || []).map(p => [p.lat, p.lon]));
      if (all.length) map.fitBounds(L.latLngBounds(all).pad(0.2), { maxZoom: 18 });
      drawMe();
      window.addEventListener('scanlow-point', onPoint);
      startGps();
    });
    onBeforeUnmount(() => { window.removeEventListener('scanlow-point', onPoint); map?.remove(); map = null; me = null; layers = []; });
    watch(() => S.fix, drawMe);
    watch(() => [S.m?.id, JSON.stringify(S.m?.pois || []), JSON.stringify(S.m?.recordings || [])], () => { drawPois(); draw(true); });
    const center = () => { S.follow = true; if (S.fix) map.setView([S.fix.lat, S.fix.lon], Math.max(map.getZoom(), 17)); };
    const fitAll = () => {
      const all = S.points.map(p => [p[1], p[2]]).concat((S.m?.pois || []).map(p => [p.lat, p.lon]));
      if (all.length) { S.follow = false; map.fitBounds(L.latLngBounds(all).pad(0.15), { maxZoom: 18 }); }
    };
    const active = computed(() => recById(S.m?.active_rec));
    const elapsed = computed(() => (S.m?.segments || []).filter(g => g.rec === S.m.active_rec)
      .reduce((s, g) => s + ((g.end || (S.recording ? S.now : g.start)) - g.start), 0) / 1000);
    const fixAge = computed(() => S.fix ? (S.now - S.fixAt) / 1000 : null);
    const legend = computed(() => (S.m?.recordings || []).filter(r => S.m.segments.some(g => g.rec === r.id)));
    const recBtn = () => { if (S.recording) stopRec(); else S.sheet = { kind: 'rec' }; };
    return { el, S, center, fitAll, active, elapsed, fixAge, legend, recBtn, newPoi, fmt, dur, recColor, KIND };
  },
  template: `
  <div class="map-screen">
    <div ref="el" class="map"></div>
    <div class="status" :class="{rec: S.recording}" @click="S.sheet = {kind: 'rec'}">
      <span class="dot"></span>
      <b v-if="active"><i class="sw" :style="'background:' + recColor(active.id)"></i>{{ active.name }}</b><b v-else>Aucun enregistrement</b>
      <span v-if="active">{{ S.recording ? '' : 'en pause · ' }}{{ dur(elapsed) }}</span>
      <span v-if="active">{{ fmt((S.m.stats.by_rec[active.id] || 0) / 1000, 2) }} km</span>
      <span v-if="S.fix" :class="{bad: S.fix.acc > 25 || fixAge > 5}">± {{ fmt(S.fix.acc) }} m<template v-if="fixAge > 5"> · {{ fmt(fixAge) }} s</template></span>
      <span v-else class="bad">GPS…</span>
    </div>
    <div v-if="S.gpsLost" class="gps-error alarm">Plus de position GPS depuis {{ dur((S.now - S.gpsLost) / 1000) }} : restez à découvert, vérifiez la localisation du téléphone.</div>
    <div v-else-if="S.gpsError" class="gps-error">{{ S.gpsError }}</div>
    <div v-if="legend.length > 1" class="rec-legend"><span v-for="r in legend" :key="r.id"><i :style="'background:' + recColor(r.id)"></i>{{ r.name }}</span></div>
    <div class="fab-col">
      <button class="fab small" :class="{on: S.follow}" @click="center" title="Me suivre" aria-label="Centrer sur ma position"><svg viewBox="0 0 24 24"><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg></button>
      <button class="fab small" @click="fitAll" title="Tout voir" aria-label="Voir toute la trace"><svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
      <button class="fab small" @click="S.black = true" title="Écran noir" aria-label="Écran noir (économie d’énergie)"><svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg></button>
    </div>
    <div class="bottom-actions">
      <button class="big-btn rec" :class="{on: S.recording}" @click="recBtn">
        <span class="rec-ico"></span>{{ S.recording ? 'Pause' : (active ? 'Reprendre…' : 'Démarrer…') }}</button>
      <button class="big-btn poi" @click="newPoi()"><svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><path d="M12 7v5M9.5 9.5h5"/></svg>Repère</button>
    </div>
  </div>`,
};

// ------------------------------------------------------------------ enregistrements GPS
const RecSheet = {
  setup() {
    const kind = ref(pref('lastKind', 'site'));
    const name = ref('');
    const list = computed(() => [...S.m.recordings].reverse());
    const durOf = (id) => S.m.segments.filter(g => g.rec === id).reduce((s, g) => s + ((g.end || (S.recording ? S.now : g.start)) - g.start), 0) / 1000;
    const placeholder = computed(() => `${KIND[kind.value].l} ${S.m.recordings.filter(r => r.kind === kind.value).length + 1}`);
    async function resume(id) { S.sheet = null; await startRec(id); }
    async function create() { setPref('lastKind', kind.value); const r = newRecording(kind.value, name.value); S.sheet = null; await startRec(r.id); }
    function pause() { stopRec(); S.sheet = null; }
    const active = computed(() => recById(S.m.active_rec));
    return { S, kind, name, list, durOf, placeholder, resume, create, pause, active, REC_KINDS, KIND, fmt, dur, recColor };
  },
  template: `
  <div class="sheet-back" @click.self="S.sheet = null">
    <div class="sheet">
      <div class="sheet-head"><b>Enregistrements GPS</b><button class="x" @click="S.sheet = null" aria-label="Fermer">×</button></div>
      <div class="sheet-body">
        <div v-if="S.recording && active" class="rec-now"><span class="dot-rec"></span><div class="grow"><b>{{ active.name }}</b><div class="small muted">en cours · {{ dur(durOf(active.id)) }}</div></div>
          <button class="btn stop" @click="pause">Pause</button></div>
        <template v-if="list.length">
          <div class="lbl">{{ S.recording ? 'Passer à un autre enregistrement' : 'Reprendre un enregistrement' }}</div>
          <button v-for="r in list" :key="r.id" v-show="!(S.recording && r.id === S.m.active_rec)" class="rec-item" :class="{main: !S.recording && r.id === S.m.active_rec}" @click="resume(r.id)">
            <i :style="'background:' + recColor(r.id)"></i><div class="grow"><b>{{ r.name }}</b><div class="small muted">{{ KIND[r.kind]?.l }} · {{ dur(durOf(r.id)) }} · {{ fmt((S.m.stats.by_rec[r.id] || 0) / 1000, 2) }} km</div></div>
            <span class="go">▶</span></button>
        </template>
        <div class="lbl" style="margin-top:14px">Nouvel enregistrement</div>
        <div class="chips">
          <button v-for="k in REC_KINDS" :key="k.k" class="chip" :class="{on: kind===k.k}" :style="kind===k.k ? 'background:' + k.c + ';border-color:' + k.c : ''" @click="kind=k.k">{{ k.l }}</button>
        </div>
        <input class="inp" v-model="name" :placeholder="'Nom : ' + placeholder">
        <button class="big-btn wide" @click="create"><span class="rec-ico white"></span>Démarrer « {{ name.trim() || placeholder }} »</button>
        <p class="muted small">Chaque enregistrement a sa couleur sur la carte et se retrouve séparément sur le PC (ex. cartographie sur site le matin, mesure en voiture hors site l’après-midi).</p>
      </div>
    </div>
  </div>`,
};

// ------------------------------------------------------------------ repères
async function newPoi(type = 'source') {
  const f = S.fix && Date.now() - S.fixAt < 30000 ? S.fix : null;
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
      if (!map || p.value.lat == null) return;
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
    function camera() {
      openCamera(async (blob) => { const id = await storePhoto(blob); p.value.photos.push(id); sh.value.urls[id] = URL.createObjectURL(blob); });
    }
    async function fromGallery(ev) {
      const files = [...(ev.target.files || [])];
      ev.target.value = '';
      S.busy = 'Photos…';
      try { for (const f of files) { const b = await shrink(f), id = await storePhoto(b); p.value.photos.push(id); sh.value.urls[id] = URL.createObjectURL(b); } }
      finally { S.busy = null; }
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
    return { sh, p, el, POI_TYPES, camera, fromGallery, removePhoto, useGps, ok, del, close, hms, fmt };
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
          <button class="ph add" @click="camera"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 8h4l2-2h4l2 2h4v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/></svg><span>Photo</span></button>
          <label class="ph add gal"><input type="file" accept="image/*" multiple @change="fromGallery" hidden><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5"/></svg><span>Galerie</span></label>
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

// ------------------------------------------------------------------ cahier de notes
function insertAtCursor(ta, obj, key, stamp) {
  const v = obj[key] || '', i = ta?.selectionStart ?? v.length;
  const pre = i && v[i - 1] !== '\n' && v[i - 1] !== ' ' ? ' ' : '';
  obj[key] = v.slice(0, i) + pre + stamp + v.slice(i);
  nextTick(() => { if (!ta) return; ta.focus(); const k = i + pre.length + stamp.length; ta.setSelectionRange(k, k); });
}
const JournalView = {
  setup() {
    const draft = reactive({ text: pref('draft.' + S.m.id, ''), withPos: pref('withPos', false), photos: [] });
    watch(() => draft.text, (v) => setPref('draft.' + S.m.id, v));
    watch(() => draft.withPos, (v) => setPref('withPos', v));
    const taEl = ref(null);
    const show = ref(pref('journalShow', 'notes'));
    watch(show, (v) => setPref('journalShow', v));
    const urls = reactive({});
    async function loadUrls() {
      const ids = [...S.m.journal.flatMap(e => e.photos || []), ...S.m.pois.map(p => p.photos[0]).filter(Boolean)];
      for (const id of ids) if (!urls[id]) { const b = await db.getPhoto(id); if (b) urls[id] = URL.createObjectURL(b); }
    }
    watch(() => S.m.journal.map(e => (e.photos || []).join()).join() + S.m.pois.length, loadUrls, { immediate: true });
    onBeforeUnmount(() => Object.values(urls).forEach(u => URL.revokeObjectURL(u)));
    const stamp = () => `[${hms(Date.now())}] `;
    function camera() { openCamera(async (blob) => { const id = await storePhoto(blob); draft.photos.push(id); urls[id] = URL.createObjectURL(blob); }); }
    function dropDraftPhoto(id) { draft.photos = draft.photos.filter(x => x !== id); db.deletePhoto(id); }
    const freshFix = () => S.fix && Date.now() - S.fixAt < 30000 ? S.fix : null;
    function addNote() {
      if (!draft.text.trim() && !draft.photos.length) { toast('Écrivez une note ou ajoutez une photo.', 'warn'); return; }
      const f = draft.withPos ? freshFix() : null;
      if (draft.withPos && !f) toast('Pas de position GPS récente : note enregistrée sans position.', 'warn');
      S.m.journal.push({ id: uid('j'), t: Date.now(), text: draft.text.trim(), lat: f?.lat ?? null, lon: f?.lon ?? null, acc: f?.acc ?? null, photos: [...draft.photos] });
      draft.text = ''; draft.photos = [];
      save(0);
    }
    function addPos(e) { const f = freshFix(); if (!f) { toast('Pas de position GPS récente.', 'warn'); return; } Object.assign(e, { lat: f.lat, lon: f.lon, acc: f.acc }); save(0); }
    function clearPos(e) { Object.assign(e, { lat: null, lon: null, acc: null }); save(0); }
    function setTime(e, v) { const t = atTime(v, e.t); if (t != null) { e.t = t; save(); } }
    function del(e) { if (!confirm('Supprimer cette note ?')) return; for (const id of e.photos || []) db.deletePhoto(id); S.m.journal = S.m.journal.filter(x => x.id !== e.id); save(0); }
    function noteCamera(e) { openCamera(async (blob) => { const id = await storePhoto(blob); e.photos.push(id); urls[id] = URL.createObjectURL(blob); save(0); }); }
    const items = computed(() => {
      const notes = S.m.journal.map(e => ({ kind: 'note', t: e.t, e }));
      const all = show.value === 'all' ? [...notes,
        ...S.m.pois.map(p => ({ kind: 'poi', t: p.t, p })),
        ...S.m.puffs.map(p => ({ kind: 'puff', t: p.t_phone, p })),
        ...S.m.clock.map(c => ({ kind: 'clock', t: c.t_phone, c })),
        ...S.m.weather.map(w => ({ kind: 'weather', t: w.t, w })),
        ...S.m.segments.map((g, i) => ({ kind: 'seg', t: g.start, g, i }))] : notes;
      return all.sort((a, b) => b.t - a.t);
    });
    return { S, draft, taEl, show, urls, stamp, camera, dropDraftPhoto, addNote, addPos, clearPos, setTime, del, noteCamera, items, insertAtCursor,
      TYPE, OLD_CATS, SKYK, WINDK, DIRS, hm, hms, dur, fmt, save, editPoi, recName, recColor, weatherLine };
  },
  template: `
  <div class="page">
    <div class="card composer">
      <textarea ref="taEl" class="inp" v-model="draft.text" rows="3" placeholder="Nouvelle note : discussion avec l’exploitant, observation, incident, réglage…"></textarea>
      <div class="photos" v-if="draft.photos.length"><div v-for="id in draft.photos" :key="id" class="ph sm"><img :src="urls[id]" alt=""><button @click="dropDraftPhoto(id)">×</button></div></div>
      <div class="tools">
        <button class="tool" @click="insertAtCursor(taEl, draft, 'text', stamp())">⏱ Heure</button>
        <button class="tool" :class="{on: draft.withPos}" @click="draft.withPos = !draft.withPos">📍 Position{{ draft.withPos ? (S.fix ? ' ± ' + fmt(S.fix.acc) + ' m' : ' …') : '' }}</button>
        <button class="tool" @click="camera">📷 Photo</button>
        <button class="btn primary add" @click="addNote">Ajouter</button>
      </div>
    </div>
    <div class="seg2"><button :class="{on: show==='notes'}" @click="show='notes'">Notes ({{ S.m.journal.length }})</button><button :class="{on: show==='all'}" @click="show='all'">Tout le déroulé</button></div>
    <div v-if="!items.length" class="empty">Le cahier est vide. Chaque note est datée automatiquement ; ajoutez la position ou l’heure exacte dans le texte si besoin.</div>
    <template v-for="it in items" :key="it.kind + (it.e?.id || it.p?.id || it.c?.id || it.w?.id || it.i || it.t)">
      <div v-if="it.kind==='note'" class="note card">
        <div class="row-sb">
          <input class="time-in" type="time" step="60" :value="hm(it.e.t)" @change="setTime(it.e, $event.target.value)">
          <span v-if="it.e.category" class="muted small">{{ OLD_CATS[it.e.category] || it.e.category }}{{ it.e.end ? ' · ' + dur((it.e.end - it.e.start) / 1000) : '' }}</span>
          <span class="grow"></span>
          <button v-if="it.e.lat != null" class="pos on" @click="clearPos(it.e)" title="Retirer la position">📍 ± {{ fmt(it.e.acc) }} m</button>
          <button v-else class="pos" @click="addPos(it.e)">+ 📍</button>
          <button class="x small" @click="del(it.e)" aria-label="Supprimer">×</button>
        </div>
        <textarea class="inp bare" v-model="it.e.text" rows="2" @input="save()" placeholder="(note vide)"></textarea>
        <div class="photos" v-if="it.e.photos?.length"><div v-for="id in it.e.photos" :key="id" class="ph sm"><img :src="urls[id]" alt=""></div></div>
        <div class="note-tools"><button class="tool sm" @click="insertAtCursor($event.target.closest('.note').querySelector('textarea'), it.e, 'text', stamp()); save()">⏱ Heure</button>
          <button class="tool sm" @click="noteCamera(it.e)">📷</button></div>
      </div>
      <div v-else-if="it.kind==='poi'" class="mini-item" @click="editPoi(it.p)">
        <span class="pin" :style="'background:' + (TYPE[it.p.type] || TYPE.other).c"></span>
        <div class="grow"><b>{{ it.p.title || (TYPE[it.p.type] || TYPE.other).l }}</b><div class="muted small">{{ hms(it.p.t) }} · repère{{ it.p.photos.length ? ' · ' + it.p.photos.length + ' photo(s)' : '' }}{{ it.p.note ? ' · ' + it.p.note : '' }}</div></div>
        <img v-if="it.p.photos[0] && urls[it.p.photos[0]]" :src="urls[it.p.photos[0]]" class="thumb" alt="">
      </div>
      <div v-else-if="it.kind==='puff'" class="mini-item"><span class="pin" style="background:#e87ba4"></span>
        <div class="grow"><b>Puff test</b><div class="muted small">{{ hms(it.p.t_phone) }}{{ it.p.delay_s != null ? ' · temps de prélèvement ' + fmt(it.p.delay_s, 1) + ' s' : '' }}{{ it.p.instrument ? ' · ' + it.p.instrument : '' }}</div></div></div>
      <div v-else-if="it.kind==='clock'" class="mini-item"><span class="pin" style="background:#2a78d6"></span>
        <div class="grow"><b>Écart d’horloge {{ (it.c.offset_s > 0 ? '+' : '') + fmt(it.c.offset_s, 1) }} s</b><div class="muted small">{{ hms(it.c.t_phone) }}{{ it.c.instrument ? ' · ' + it.c.instrument : '' }}</div></div></div>
      <div v-else-if="it.kind==='weather'" class="mini-item"><span class="pin" style="background:#5b6b7a"></span>
        <div class="grow"><b>Météo</b><div class="muted small">{{ hm(it.w.t) }} · {{ weatherLine(it.w) }}</div></div></div>
      <div v-else class="mini-item"><span class="pin" :style="'background:' + recColor(it.g.rec)"></span>
        <div class="grow"><b>{{ recName(it.g.rec) }}</b><div class="muted small">{{ hms(it.g.start) }} → {{ it.g.end ? hms(it.g.end) : 'en cours' }}</div></div></div>
    </template>
  </div>`,
};

// ------------------------------------------------------------------ météo
function weatherLine(w) {
  const parts = [];
  if (w.sky) parts.push(`${SKYK[w.sky]?.e || ''} ${SKYK[w.sky]?.l || ''}`);
  if (w.wind) parts.push(`vent ${WINDK[w.wind]?.l.toLowerCase()}${w.wind_dir != null && w.wind !== 'calm' ? ' du ' + DIRS[Math.round(w.wind_dir / 45) % 8] : ''}`);
  else if (w.wind_dir != null) parts.push('vent du ' + DIRS[Math.round(w.wind_dir / 45) % 8]);
  if (w.temperature != null && w.temperature !== '') parts.push(`${fmt(w.temperature, 1).replace(',0', '')} °C`);
  if (w.remarks) parts.push(w.remarks);
  return parts.join(' · ') || 'non renseignée';
}
const WEDGES = DIRS.map((d, k) => {
  const a0 = (k * 45 - 22.5) * Math.PI / 180, a1 = (k * 45 + 22.5) * Math.PI / 180, R = 47, r = 17;
  const P = (rr, a) => `${(rr * Math.sin(a)).toFixed(2)} ${(-rr * Math.cos(a)).toFixed(2)}`;
  return { d, deg: k * 45, path: `M${P(r, a0)} L${P(R, a0)} A${R} ${R} 0 0 1 ${P(R, a1)} L${P(r, a1)} A${r} ${r} 0 0 0 ${P(r, a0)}Z`,
    lx: (32 * Math.sin(k * Math.PI / 4)).toFixed(1), ly: (-32 * Math.cos(k * Math.PI / 4) + 4).toFixed(1) };
});
function newWeather() {
  const prev = S.m.weather[0];
  S.sheet = { kind: 'weather', isNew: true, w: { id: uid('w'), t: Date.now(), sky: prev?.sky ?? null, wind: prev?.wind ?? null, wind_dir: prev?.wind_dir ?? null,
    temperature: prev?.temperature ?? null, remarks: '' } };
}
const WeatherSheet = {
  setup() {
    const w = computed(() => S.sheet.w);
    const step = (d) => {   // sans valeur : départ à 15 °C
      const t = w.value.temperature;
      w.value.temperature = t == null || t === '' ? 15 : Math.round((+t + d) * 2) / 2;
    };
    const setDir = (deg) => { w.value.wind_dir = w.value.wind_dir === deg ? null : deg; };
    function ok() {
      const i = S.m.weather.findIndex(x => x.id === w.value.id);
      if (i >= 0) S.m.weather[i] = w.value; else S.m.weather.unshift(w.value);
      S.m.weather.sort((a, b) => b.t - a.t);
      save(0); S.sheet = null;
    }
    function del() { S.m.weather = S.m.weather.filter(x => x.id !== w.value.id); save(0); S.sheet = null; }
    return { S, w, step, setDir, ok, del, SKY, WIND, WEDGES, DIRS, hm };
  },
  template: `
  <div class="sheet-back" @click.self="S.sheet = null">
    <div class="sheet">
      <div class="sheet-head"><b>Météo observée</b><span class="muted">{{ hm(w.t) }}</span><button class="x" @click="S.sheet = null" aria-label="Fermer">×</button></div>
      <div class="sheet-body">
        <div class="sky-grid"><button v-for="s in SKY" :key="s.k" :class="{on: w.sky===s.k}" @click="w.sky = w.sky===s.k ? null : s.k"><span>{{ s.e }}</span>{{ s.l }}</button></div>
        <div class="lbl">Vent ressenti</div>
        <div class="seg2 five"><button v-for="s in WIND" :key="s.k" :class="{on: w.wind===s.k}" @click="w.wind = w.wind===s.k ? null : s.k">{{ s.l }}</button></div>
        <div class="wx-row">
          <div class="compass-wrap" :class="{off: w.wind==='calm'}">
            <svg viewBox="-50 -50 100 100" class="rose">
              <g v-for="x in WEDGES" :key="x.d" @click="setDir(x.deg)"><path :d="x.path" :class="{on: w.wind_dir===x.deg}"/><text :x="x.lx" :y="x.ly" text-anchor="middle">{{ x.d }}</text></g>
              <text x="0" y="-2" text-anchor="middle" class="c1">{{ w.wind_dir != null ? 'du' : 'vent' }}</text>
              <text x="0" y="9" text-anchor="middle" class="c2">{{ w.wind_dir != null ? DIRS[w.wind_dir / 45] : 'venant du' }}</text>
            </svg>
          </div>
          <div class="temp">
            <div class="lbl">Température</div>
            <div class="stepper"><button @click="step(-0.5)">−</button><input type="number" step="0.5" inputmode="decimal" v-model.number="w.temperature" placeholder="–"><button @click="step(0.5)">+</button></div>
            <div class="muted small" style="text-align:center">°C</div>
          </div>
        </div>
        <input class="inp" v-model="w.remarks" placeholder="Remarque (rafales, averses, inversion…)">
      </div>
      <div class="sheet-foot"><button v-if="!S.sheet.isNew" class="btn danger" @click="del">Supprimer</button><span class="grow"></span>
        <button class="btn" @click="S.sheet = null">Annuler</button><button class="btn primary" @click="ok">Enregistrer</button></div>
    </div>
  </div>`,
};

// ------------------------------------------------------------------ synchronisation de l'instrument
const SyncView = {
  setup() {
    const instrTime = ref('');
    const utc = computed(() => S.m.clock_ref === 'utc');
    function prefill() {
      const t = new Date(Date.now() + 20000); t.setSeconds(Math.ceil(t.getSeconds() / 10) * 10);
      instrTime.value = utc.value ? hmsUtc(t.getTime()) : hms(t.getTime());
    }
    prefill();
    function setRef(r) { S.m.clock_ref = r; save(0); prefill(); }
    const instruments = computed(() => S.m.instruments.map(i => i.name).filter(Boolean));
    const instr = ref('');
    watch(instruments, (v) => { if (!v.includes(instr.value)) instr.value = v[0] || ''; }, { immediate: true });
    const mine = (x) => !instr.value || !x.instrument || x.instrument === instr.value;
    const clocks = computed(() => S.m.clock.filter(mine));
    const puffs = computed(() => S.m.puffs.filter(mine));
    function top() {   // l'utilisateur appuie quand l'instrument affiche l'heure saisie
      const t = Date.now(), ti = atTime(instrTime.value, t, utc.value);
      if (ti == null) { toast('Heure de l’instrument au format HH:MM:SS.', 'warn'); return; }
      S.m.clock.push({ id: uid('c'), t_phone: t, instrument_time: instrTime.value, offset_s: Math.round((ti - t) / 100) / 10, instrument: instr.value,
        ref: utc.value ? 'utc' : 'local' });
      beep('tick', true);
      save(0); prefill();
    }
    const pending = computed(() => S.m.puffs.find(p => p.pending));
    const chrono = ref(0);
    let timer = null;
    watch(pending, (p) => {
      clearInterval(timer);
      if (p) timer = setInterval(() => { chrono.value = (Date.now() - p.t_phone) / 1000; }, 100);
    }, { immediate: true });
    onBeforeUnmount(() => clearInterval(timer));
    function puffStart() {
      unlockAudio();
      S.m.puffs.push({ id: uid('f'), t_phone: Date.now(), t_peak: null, delay_s: null, instrument: instr.value, pending: true, note: '' });
      beep('tick', true);
      save(0);
    }
    function puffPeak() {
      const p = pending.value;
      p.t_peak = Date.now(); p.delay_s = Math.round((p.t_peak - p.t_phone) / 100) / 10; p.pending = false;
      beep('ok', true);
      save(0);
    }
    function puffCancel() { S.m.puffs = S.m.puffs.filter(p => !p.pending); save(0); }
    function delItem(list, id) { S.m[list] = S.m[list].filter(x => x.id !== id); save(0); }
    const corr = computed(() => {
      const c = clocks.value.at(-1);
      const ds = puffs.value.map(p => p.delay_s).filter(v => v != null);
      const delay = median(ds);
      return { offset: c ? c.offset_s : null, delay, n: ds.length, total: (c ? c.offset_s : 0) + (delay ?? 0) };
    });
    return { S, instrTime, instruments, instr, clocks, puffs, top, pending, chrono, puffStart, puffPeak, puffCancel, delItem, corr, hms, hmsUtc, fmt, signed, utc, setRef, zoneLabel };
  },
  template: `
  <div class="page">
    <div class="card" v-if="instruments.length > 1">
      <label class="lbl">Instrument à synchroniser
        <select class="inp" v-model="instr"><option v-for="n in instruments" :key="n" :value="n">{{ n }}</option></select></label>
    </div>
    <div class="card">
      <div class="step-h"><span class="num">1</span><h3>Écart d’horloge</h3></div>
      <div class="lbl">L’instrument affiche l’heure</div>
      <div class="seg2"><button :class="{on: !utc}" @click="setRef('local')">Locale ({{ zoneLabel() }})</button><button :class="{on: utc}" @click="setRef('utc')">UTC</button></div>
      <div class="phone-clock">Téléphone : <b>{{ hms(S.now) }}</b> locale · <b>{{ hmsUtc(S.now) }}</b> UTC</div>
      <p class="muted small">Saisissez une heure à venir (en heure {{ utc ? 'UTC' : 'locale' }}), puis appuyez sur <b>Top</b> à l’instant exact où l’instrument affiche cette heure.</p>
      <div class="grid2"><input class="inp mono" v-model="instrTime" inputmode="numeric" placeholder="HH:MM:SS">
        <button class="big-btn" @click="top">Top</button></div>
      <div v-for="c in clocks" :key="c.id" class="mini-item"><span class="pin" style="background:#2a78d6"></span>
        <div class="grow"><b>{{ signed(c.offset_s) }} s</b><div class="muted small">instrument {{ c.instrument_time }} ({{ c.ref === 'utc' ? 'UTC' : 'locale' }}) au top de {{ c.ref === 'utc' ? hmsUtc(c.t_phone) + ' UTC' : hms(c.t_phone) }}{{ c.instrument && instruments.length > 1 ? ' · ' + c.instrument : '' }}</div></div>
        <button class="x small" @click="delItem('clock', c.id)">×</button></div>
    </div>
    <div class="card">
      <div class="step-h"><span class="num">2</span><h3>Puff test : temps de prélèvement</h3></div>
      <p class="muted small">Soufflez (ou libérez le gaz) à l’entrée de la ligne en appuyant sur <b>Début</b>, puis appuyez sur <b>Pic</b> dès que le pic apparaît sur l’écran de l’instrument.</p>
      <template v-if="pending">
        <div class="chrono">{{ fmt(chrono, 1) }} s</div>
        <button class="big-btn wide puff" @click="puffPeak">Pic !</button>
        <button class="btn wide" @click="puffCancel">Annuler ce puff</button>
      </template>
      <button v-else class="big-btn wide puff" @click="puffStart">Début (souffle)</button>
      <div v-for="p in puffs.filter(x => !x.pending).slice().reverse()" :key="p.id" class="mini-item"><span class="pin" style="background:#e87ba4"></span>
        <div class="grow"><b>{{ p.delay_s != null ? fmt(p.delay_s, 1) + ' s' : 'pic non noté' }}</b><div class="muted small">puff à {{ hms(p.t_phone) }}{{ p.t_peak ? ' · pic à ' + hms(p.t_peak) : '' }}</div></div>
        <button class="x small" @click="delItem('puffs', p.id)">×</button></div>
    </div>
    <div class="card corr">
      <div class="step-h"><span class="num">=</span><h3>Correction à appliquer{{ instr && instruments.length > 1 ? ' · ' + instr : '' }}</h3></div>
      <div class="eq">
        <div><span>Écart d’horloge</span><b>{{ corr.offset != null ? signed(corr.offset) + ' s' : '—' }}</b></div><i>+</i>
        <div><span>Temps de prélèvement</span><b>{{ corr.delay != null ? fmt(corr.delay, 1) + ' s' : '—' }}</b><small v-if="corr.n > 1">médiane de {{ corr.n }} puffs</small></div><i>=</i>
        <div class="tot"><span>Correction totale</span><b>{{ signed(corr.total) }} s</b></div>
      </div>
      <p class="small">Heure de prélèvement = heure affichée par l’instrument <b>{{ corr.total >= 0 ? '−' : '+' }} {{ fmt(Math.abs(corr.total), 1) }} s</b>
        (en heure {{ (clocks.at(-1)?.ref || S.m.clock_ref) === 'utc' ? 'UTC' : 'locale' }}).</p>
      <p class="muted small" v-if="corr.offset == null || corr.delay == null">{{ corr.offset == null ? 'Écart d’horloge non mesuré. ' : '' }}{{ corr.delay == null ? 'Temps de prélèvement non mesuré. ' : '' }}Le PC affine de toute façon la correction en retrouvant les puffs dans les données de l’instrument.</p>
    </div>
  </div>`,
};

// ------------------------------------------------------------------ campagne
const CampaignView = {
  setup() {
    function addInstr() { S.m.instruments.push({ id: uid('i'), name: '', serial: '', species: '', note: '' }); save(); }
    function togglePurpose(x) { const l = S.m.info.purposes, i = l.indexOf(x); if (i >= 0) l.splice(i, 1); else l.push(x); S.m.info.purpose = purposeText(S.m.info); save(); }
    function setExtra() { S.m.info.purpose = purposeText(S.m.info); save(); }
    function delInstr(i) { S.m.instruments.splice(i, 1); save(); }
    const editWeather = (w) => { S.sheet = { kind: 'weather', isNew: false, w: JSON.parse(JSON.stringify(w)) }; };
    const durOf = (id) => S.m.segments.filter(g => g.rec === id).reduce((s, g) => s + ((g.end || (S.recording ? S.now : g.start)) - g.start), 0) / 1000;
    function delRec(r) {
      if (S.m.segments.some(g => g.rec === r.id)) { toast('Cet enregistrement contient des points : il ne peut pas être supprimé (renommez-le).', 'warn'); return; }
      S.m.recordings = S.m.recordings.filter(x => x.id !== r.id); save(0);
    }
    return { S, PURPOSES, REC_KINDS, KIND, addInstr, delInstr, togglePurpose, setExtra, newWeather, editWeather, weatherLine, durOf, delRec, save, hm, dur, fmt, recColor };
  },
  template: `
  <div class="page">
    <div class="card">
      <h3>Campagne</h3>
      <input class="inp" v-model="S.m.info.name" @input="save()" placeholder="Nom de la campagne">
      <div class="grid2"><label class="lbl">Date<input class="inp" type="date" v-model="S.m.info.date" @change="save()"></label>
        <label class="lbl">Site / lieu<input class="inp" v-model="S.m.info.site" @input="save()" placeholder="ex. ISDND de …"></label></div>
      <input class="inp" v-model="S.m.info.client" @input="save()" placeholder="Client">
      <input class="inp" v-model="S.m.info.operators" @input="save()" placeholder="Opérateurs">
      <label class="lbl">Objectifs</label>
      <div class="chips"><button v-for="p in PURPOSES" :key="p" class="chip sm" :class="{on: S.m.info.purposes.includes(p)}" @click="togglePurpose(p)">{{ S.m.info.purposes.includes(p) ? '✓ ' : '' }}{{ p }}</button></div>
      <input class="inp" v-model="S.m.info.purpose_extra" @input="setExtra" placeholder="Autre objectif (facultatif)">
      <textarea class="inp" v-model="S.m.info.remarks" @input="save()" rows="2" placeholder="Remarques générales"></textarea>
    </div>
    <div class="card">
      <div class="row-sb"><h3>Météo observée</h3><button class="btn sm primary" @click="newWeather">+ Observation</button></div>
      <div v-if="!S.m.weather.length" class="muted small">Une observation au début, puis à chaque changement notable (la précédente est reprise : ne changez que ce qui a bougé).</div>
      <button v-for="w in S.m.weather" :key="w.id" class="wx-line" @click="editWeather(w)"><b>{{ hm(w.t) }}</b><span>{{ weatherLine(w) }}</span></button>
    </div>
    <div class="card">
      <h3>Enregistrements GPS</h3>
      <div v-if="!S.m.recordings.length" class="muted small">Aucun : démarrez-en un depuis l’onglet Terrain.</div>
      <div v-for="r in S.m.recordings" :key="r.id" class="rec-edit">
        <i :style="'background:' + recColor(r.id)"></i>
        <div class="grow"><input class="inp slim wide" v-model="r.name" @input="save()">
          <div class="row-sb"><select class="inp slim" v-model="r.kind" @change="save()"><option v-for="k in REC_KINDS" :key="k.k" :value="k.k">{{ k.l }}</option></select>
            <span class="muted small">{{ dur(durOf(r.id)) }} · {{ fmt((S.m.stats.by_rec[r.id] || 0) / 1000, 2) }} km</span></div></div>
        <button class="x small" @click="delRec(r)" aria-label="Supprimer">×</button>
      </div>
    </div>
    <div class="card">
      <div class="row-sb"><h3>Instruments</h3><button class="btn sm" @click="addInstr">+ Ajouter</button></div>
      <div v-for="(i, k) in S.m.instruments" :key="i.id" class="instr">
        <input class="inp" v-model="i.name" @input="save()" placeholder="Instrument (ex. Aeris MIRA CH4)">
        <div class="grid3"><input class="inp" v-model="i.serial" @input="save()" placeholder="N° série">
          <input class="inp" v-model="i.species" @input="save()" :placeholder="i.inlet_height ? 'Espèce (prise ' + i.inlet_height + ' m)' : 'Espèce mesurée (ex. méthane)'">
          <button class="btn sm danger" @click="delInstr(k)">Retirer</button></div>
      </div>
    </div>
  </div>`,
};

// ------------------------------------------------------------------ accueil et création de la campagne
const HomeScreen = {
  setup() {
    async function remove(m) {
      if (!confirm(`Supprimer définitivement la campagne « ${m.name || 'sans nom'} » de ce téléphone (trace, repères, photos) ?`)) return;
      if (S.m?.id === m.id) { S.m = null; S.points = markRaw([]); }
      await db.deleteMission(m.id);
      S.missions = S.missions.filter(x => x.id !== m.id);
    }
    async function install() { if (S.installEvt) { S.installEvt.prompt(); S.installEvt = null; } }
    return { S, openMission, remove, install, fmt, APP_VERSION };
  },
  template: `
  <div class="page home">
    <div class="hero"><span class="logo big"></span><div><h2>ScanLow <b>Terrain</b></h2><p class="muted small">Campagnes de mesure : trace GPS, repères et photos, notes, synchronisation de l’instrument.</p></div></div>
    <button class="big-btn wide" @click="S.screen = 'create'"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Nouvelle campagne</button>
    <div class="card" style="margin-top:14px">
      <h3>Campagnes sur cet appareil</h3>
      <div v-for="m in S.missions" :key="m.id" class="mini-item" @click="openMission(m.id)">
        <span class="pin" style="background:#0f4c5c"></span>
        <div class="grow"><b>{{ m.name || 'Sans nom' }}</b><div class="muted small">{{ m.date }} · {{ m.site || '—' }} · {{ fmt(m.stats?.n_points || 0) }} pts · {{ m.n_pois || 0 }} repère(s)</div></div>
        <button class="x small" @click.stop="remove(m)" aria-label="Supprimer">×</button>
      </div>
      <div v-if="!S.missions.length" class="muted small">Aucune campagne pour l’instant.</div>
    </div>
    <button v-if="S.installEvt" class="btn wide primary" @click="install">Installer l’application sur l’écran d’accueil</button>
    <p class="muted small" style="text-align:center">ScanLow - Terrain {{ APP_VERSION }} · données stockées sur l’appareil jusqu’à l’export</p>
  </div>`,
};
const CreateScreen = {
  setup() {
    const f = reactive({ name: '', client: pref('lastClient', ''), date: isoDate(Date.now()), site: pref('lastSite', ''), operators: pref('lastOperators', ''), purposes: [], purpose_extra: '', remarks: '' });
    const instruments = reactive(pref('lastInstruments', [{ name: '', serial: '', species: '' }]).map(({ inlet_height, ...i }) => ({ id: uid('i'), note: '', species: '', ...i })));
    const togglePurpose = (x) => { const i = f.purposes.indexOf(x); if (i >= 0) f.purposes.splice(i, 1); else f.purposes.push(x); };
    const tried = ref(false);
    const addInstr = () => instruments.push({ id: uid('i'), name: '', serial: '', species: '', note: '' });
    async function create() {
      tried.value = true;
      if (!f.name.trim()) { toast('Donnez un nom à la campagne.', 'warn'); return; }
      const ins = instruments.filter(i => i.name.trim()).map(i => ({ ...i, name: i.name.trim() }));
      setPref('lastSite', f.site); setPref('lastOperators', f.operators); setPref('lastClient', f.client);
      setPref('lastInstruments', ins.map(({ name, serial, species }) => ({ name, serial, species })));
      await createMission({ ...f, purposes: [...f.purposes], name: f.name.trim(), purpose: purposeText(f) }, ins);
      S.tab = 'terrain';
      toast('Campagne créée. Pensez à synchroniser l’instrument (onglet Synchro).', 'success', 6000);
    }
    return { S, f, instruments, tried, addInstr, create, PURPOSES, togglePurpose };
  },
  template: `
  <div class="page">
    <div class="card">
      <h3>Nouvelle campagne</h3>
      <label class="lbl">Nom de la campagne *<input class="inp" :class="{bad: tried && !f.name.trim()}" v-model="f.name" placeholder="ex. ISDND Nord – cartographie" autofocus></label>
      <div class="grid2"><label class="lbl">Date<input class="inp" type="date" v-model="f.date"></label>
        <label class="lbl">Site / lieu<input class="inp" v-model="f.site" placeholder="ex. ISDND de …"></label></div>
      <label class="lbl">Client<input class="inp" v-model="f.client" placeholder="Nom du client (exploitant, donneur d’ordre…)"></label>
      <label class="lbl">Opérateurs<input class="inp" v-model="f.operators" placeholder="Noms ou initiales"></label>
      <label class="lbl">Objectifs <span class="muted">(plusieurs choix possibles)</span></label>
      <div class="chips"><button v-for="p in PURPOSES" :key="p" class="chip sm" :class="{on: f.purposes.includes(p)}" @click="togglePurpose(p)">{{ f.purposes.includes(p) ? '✓ ' : '' }}{{ p }}</button></div>
      <input class="inp" v-model="f.purpose_extra" placeholder="Autre objectif (facultatif)">
    </div>
    <div class="card">
      <div class="row-sb"><h3>Instruments</h3><button class="btn sm" @click="addInstr">+ Ajouter</button></div>
      <div v-for="(i, k) in instruments" :key="i.id" class="instr">
        <input class="inp" v-model="i.name" placeholder="Instrument (ex. Aeris MIRA Pico CH4)">
        <div class="grid3"><input class="inp" v-model="i.serial" placeholder="N° série">
          <input class="inp" v-model="i.species" placeholder="Espèce mesurée (ex. méthane)">
          <button class="btn sm danger" @click="instruments.splice(k, 1)">Retirer</button></div>
      </div>
      <p class="muted small">Le client, le site, les opérateurs et les instruments sont repris de la campagne précédente.</p>
    </div>
    <button class="big-btn wide" @click="create">Créer la campagne</button>
    <button class="btn wide" @click="S.screen = 'home'">Annuler</button>
  </div>`,
};

// ------------------------------------------------------------------ export et réglages
const FilesView = {
  setup() {
    const canShareFiles = (() => { try { return !!navigator.canShare?.({ files: [new File(['x'], 'test.zip', { type: 'application/zip' })] }); } catch { return false; } })();
    const lastError = ref(null);
    async function exportZip(withPhotos = true, how = canShareFiles ? 'share' : 'download') {
      lastError.value = null;
      S.busy = 'Préparation de l’export…';
      try {
        const pts = await db.points(S.m.id);
        const track = pts.map(p => (p[7] ? p : [...p.slice(0, 7), ...Array(Math.max(0, 7 - p.length)).fill(null), recAt(S.m, p[0])]));
        const tzMin = -new Date().getTimezoneOffset();
        const mission = { ...JSON.parse(JSON.stringify(S.m)), track, exported: new Date().toISOString(),
          time_info: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, tz_offset_min: S.m.tz_offset_min ?? tzMin,
            note: 'Instants en millisecondes UTC (t, t_phone, start, end…) ; heure locale = UTC + tz_offset_min.' },
          device: { ua: navigator.userAgent, tz: Intl.DateTimeFormat().resolvedOptions().timeZone } };
        const files = [];
        const names = Object.fromEntries(S.m.recordings.map(r => [r.id, r.name]));
        const iso = (ms, off) => new Date(ms + off * 60000).toISOString().slice(0, 19).replace('T', ' ');
        const off = S.m.tz_offset_min ?? tzMin;
        const csv = [`heure_locale (${zoneLabel()});heure_utc;t_utc_ms;latitude;longitude;altitude_m;precision_m;vitesse_ms;cap_deg;enregistrement`,
          ...track.map(p => [iso(p[0], off), iso(p[0], 0), p[0], ...p.slice(1, 7).map(v => v == null ? '' : String(v).replace('.', ',')), names[p[7]] || ''].join(';'))].join('\r\n');
        if (withPhotos) {
          for (const item of [...mission.pois, ...mission.journal]) {
            item.photo_files = [];
            for (const id of item.photos || []) { const b = await db.getPhoto(id); if (b) { const n = `photos/${id}.jpg`; files.push({ name: n, data: b }); item.photo_files.push(n); } }
          }
        }
        files.unshift({ name: 'campaign.json', data: JSON.stringify(mission, null, 1) }, { name: 'track.csv', data: '﻿' + csv },
          { name: 'LISEZ-MOI.txt', data: `Campagne ScanLow - Terrain : ${S.m.info.name || ''} (${S.m.info.date})\r\n`
            + `À importer dans ScanLow - Mission (PC) : glisser ce fichier .zip dans la fenêtre d'accueil.\r\n\r\n`
            + `Heures : le téléphone enregistre les instants en UTC (millisecondes depuis 1970, colonne t_utc_ms de track.csv et champs de campaign.json).\r\n`
            + `Fuseau du téléphone : ${Intl.DateTimeFormat().resolvedOptions().timeZone} (${zoneLabel()}). track.csv donne aussi l'heure locale et l'heure UTC.\r\n`
            + `Écarts d'horloge (Top) : mesurés en heure ${S.m.clock_ref === 'utc' ? 'UTC' : 'locale'} de l'instrument.\r\n` });
        const blob = await makeZip(files);
        const name = `ScanLow_Mission_${S.m.info.date}_${(S.m.info.name || 'sans_nom').normalize('NFKD').replace(/[^\w-]+/g, '_').slice(0, 40)}.zip`;
        const file = new File([blob], name, { type: 'application/zip' });
        const size = `${fmt(blob.size / 1e6, 1)} Mo`;
        if (how === 'share') {
          if (!navigator.canShare?.({ files: [file] })) {
            lastError.value = { step: 'partage', name: 'NotSupported', message: `Ce navigateur ne propose pas le partage de fichiers (${size}).` };
          } else {
            try { await navigator.share({ files: [file], title: name }); S.m.exported = new Date().toISOString(); save(0); return; }
            catch (e) {
              if (e.name === 'AbortError') return;   // partage annulé par l'utilisateur
              lastError.value = { step: 'partage', name: e.name, message: e.message };
            }
          }
          toast('Partage impossible : enregistrement dans « Téléchargements » à la place.', 'warn', 7000);
        }
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 60000);
        S.m.exported = new Date().toISOString(); save(0);
        toast(`Fichier enregistré : ${name} (${size}), dans « Téléchargements » / « Fichiers ».`, 'success', 8000);
      } catch (e) { lastError.value = { step: 'préparation', name: e.name, message: e.message }; toast('Export impossible : ' + e.message, 'error', 8000); }
      finally { S.busy = null; }
    }
    const nPhotos = computed(() => S.m.pois.reduce((s, p) => s + p.photos.length, 0) + S.m.journal.reduce((s, e) => s + (e.photos?.length || 0), 0));
    const browser = navigator.userAgent.replace(/^Mozilla\/5\.0 \(/, '').replace(/\) AppleWebKit.*?(Chrome|Version|Firefox|EdgA|SamsungBrowser)/, ' · $1').slice(0, 120);
    return { S, exportZip, nPhotos, goHome, beep, DIMS, fmt, canShareFiles, lastError, browser };
  },
  template: `
  <div class="page">
    <div class="card">
      <h3>{{ S.m.info.name || 'Campagne sans nom' }}</h3>
      <div class="muted small">{{ S.m.info.site || 'site non renseigné' }} · {{ S.m.info.date }}</div>
      <div class="kpis"><div><b>{{ fmt(S.m.stats.n_points) }}</b><span>points GPS</span></div><div><b>{{ fmt(S.m.stats.distance_m / 1000, 2) }}</b><span>km</span></div>
        <div><b>{{ S.m.pois.length }}</b><span>repères</span></div><div><b>{{ S.m.journal.length }}</b><span>notes</span></div></div>
      <button class="big-btn wide" @click="exportZip(true)"><svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>{{ canShareFiles ? 'Partager la campagne (.zip)' : 'Exporter la campagne (.zip)' }}</button>
      <button v-if="canShareFiles" class="btn wide" @click="exportZip(true, 'download')">Enregistrer dans « Téléchargements »</button>
      <button class="btn wide" @click="exportZip(false, canShareFiles ? 'share' : 'download')" v-if="nPhotos">Exporter sans les {{ nPhotos }} photos (plus léger)</button>
      <div v-if="lastError" class="export-err"><b>L’export n’a pas abouti ({{ lastError.step }})</b><div>{{ lastError.name }} : {{ lastError.message }}</div>
        <div class="muted">Essayez « Enregistrer dans Téléchargements », ou l’export sans photos. Sur un téléphone professionnel, la gestion de flotte (Intune…) peut bloquer le partage vers certaines applications ou les téléchargements.</div></div>
      <p class="muted small">Le fichier s’importe dans <b>ScanLow - Mission</b> sur PC. {{ canShareFiles ? 'Envoyez-le par le menu de partage (e-mail, OneDrive, Teams…) ou enregistrez-le dans « Téléchargements ».' : 'Ce navigateur ne propose pas le partage de fichiers : le fichier est enregistré dans « Téléchargements ».' }}
        <template v-if="S.m.exported"> Dernier export : {{ new Date(S.m.exported).toLocaleString('fr-FR') }}.</template></p>
      <button class="btn wide" @click="goHome">Changer de campagne / nouvelle campagne</button>
    </div>
    <div class="card">
      <h3>Alarmes</h3>
      <label class="switch"><input type="checkbox" v-model="S.set.alarm"><span>Bip et vibration si le GPS est perdu ou si l’écran se coupe pendant l’enregistrement</span></label>
      <label class="switch" style="margin-top:8px"><input type="checkbox" v-model="S.set.flashAlarm"><span>Alarme visuelle : l’écran clignote en rouge (utile quand le téléphone est en silencieux)</span></label>
      <div class="lbl">GPS considéré perdu après</div>
      <div class="seg2"><button v-for="s in [5, 10, 20, 30]" :key="s" :class="{on: S.set.gpsLostS===s}" @click="S.set.gpsLostS = s">{{ s }} s</button></div>
      <button class="btn sm" style="margin-top:8px" @click="beep('gps', true)">Tester l’alarme</button>
      <p class="muted small">Le son suit le <b>volume des médias</b> du téléphone, pas celui de la sonnerie : montez-le avant de partir.
        Sur iPhone, le son passe malgré l’interrupteur silencieux quand le navigateur le permet. Sur Android, une page web ne peut pas forcer le son
        si le volume des médias est à zéro : la vibration et l’alarme visuelle restent actives.</p>
    </div>
    <div class="card">
      <h3>Économie d’énergie</h3>
      <div class="seg2"><button v-for="d in DIMS" :key="d.k" :class="{on: S.set.dim===d.k}" @click="S.set.dim = d.k">{{ d.l }}</button></div>
      <button class="btn wide" @click="S.black = true">Écran noir (toucher deux fois pour revenir)</button>
      <p class="muted small">Assombrit l’affichage et ralentit le rafraîchissement de la carte. Le GPS et l’enregistrement continuent. Une page web ne peut pas régler le rétroéclairage : baissez aussi la luminosité du téléphone.</p>
    </div>
    <div class="card">
      <h3>Conseils</h3>
      <ul class="tips">
        <li>Gardez l’écran allumé et l’application au premier plan pendant l’enregistrement : en arrière-plan, le navigateur coupe le GPS. Le mode « écran noir » garde l’écran allumé en consommant peu.</li>
        <li>Les données restent sur l’appareil jusqu’à l’export : exportez à la fin de chaque journée.</li>
        <li>Navigateur : {{ browser }} · partage de fichiers {{ canShareFiles ? 'disponible' : 'non disponible' }}.</li>
        <li v-if="S.storage">Stockage utilisé : {{ fmt(S.storage.usage / 1e6, 0) }} Mo sur {{ fmt(S.storage.quota / 1e6, 0) }} Mo disponibles.</li>
      </ul>
    </div>
  </div>`,
};

// ------------------------------------------------------------------ économie d'énergie : voile et écran noir
const EcoSheet = {
  setup() { return { S, DIMS }; },
  template: `
  <div class="sheet-back" @click.self="S.sheet = null">
    <div class="sheet">
      <div class="sheet-head"><b>Économie d’énergie</b><button class="x" @click="S.sheet = null" aria-label="Fermer">×</button></div>
      <div class="sheet-body">
        <div class="seg2"><button v-for="d in DIMS" :key="d.k" :class="{on: S.set.dim===d.k}" @click="S.set.dim = d.k">{{ d.l }}</button></div>
        <button class="big-btn wide dark" @click="S.black = true; S.sheet = null">Écran noir</button>
        <p class="muted small">L’enregistrement continue. Écran noir : touchez deux fois l’écran pour revenir. Baissez aussi la luminosité du téléphone (non réglable depuis une page web).</p>
      </div>
    </div>
  </div>`,
};
const BlackScreen = {
  setup() {
    let last = 0;
    const tap = () => { const t = Date.now(); if (t - last < 450) S.black = false; last = t; };
    const active = computed(() => recById(S.m?.active_rec));
    return { S, tap, active, hm, fmt };
  },
  template: `
  <div class="black" @click="tap">
    <div class="black-info">
      <div class="big">{{ hm(S.now) }}</div>
      <div :class="{rec: S.recording}">{{ S.recording ? '● ' + (active?.name || 'Enregistrement') : 'En pause' }}</div>
      <div :class="{lost: S.gpsLost}">{{ S.gpsLost ? 'GPS PERDU' : S.fix ? 'GPS ± ' + fmt(S.fix.acc) + ' m' : 'GPS…' }} · {{ fmt((S.m?.stats.distance_m || 0) / 1000, 2) }} km</div>
      <div class="hint">Toucher deux fois pour revenir</div>
    </div>
  </div>`,
};

// ------------------------------------------------------------------ application
const App = {
  components: { MapView, JournalView, SyncView, CampaignView, FilesView, PoiSheet, RecSheet, WeatherSheet, EcoSheet, CameraView, BlackScreen, HomeScreen, CreateScreen },
  setup() {
    onMounted(async () => {
      try { await navigator.storage?.persist?.(); S.storage = await navigator.storage?.estimate?.(); } catch { /* ignoré */ }
      const all = await db.missions();
      S.missions = all.map(m => metaOf(migrate(m))).sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
      const cur = pref('current', null);
      if (cur && S.missions.some(m => m.id === cur)) await openMission(cur);
      else S.screen = 'home';
    });
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEvt = e; });
    window.addEventListener('beforeunload', (e) => { if (S.recording) { e.preventDefault(); e.returnValue = ''; } });
    const tabs = [
      { k: 'terrain', l: 'Terrain', i: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14' },
      { k: 'journal', l: 'Notes', i: 'M6 3h10l3 3v15H6zM9 9h7M9 13h7M9 17h4' },
      { k: 'sync', l: 'Synchro', i: 'M12 8v4l3 2M12 21a9 9 0 1 0-9-9M3 12l-1.5-2M3 12l2-1.5' },
      { k: 'campagne', l: 'Campagne', i: 'M5 4h14v17H5zM9 4V2h6v2M8 10h8M8 14h8M8 18h5' },
      { k: 'fichier', l: 'Exporter', i: 'M12 4v11M7 10l5 5 5-5M5 20h14' },
    ];
    const veil = computed(() => DIMS.find(d => d.k === S.set.dim)?.a || 0);
    const syncTodo = computed(() => S.m && !S.m.clock.length && !S.m.puffs.length);
    return { S, tabs, hm, veil, syncTodo, goHome };
  },
  template: `
  <div class="shell" :class="{eco: S.set.dim > 0}">
    <header class="top">
      <button v-if="S.screen==='app'" class="hbtn" @click="goHome" aria-label="Campagnes"><svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
      <div class="brand"><span class="logo"></span>ScanLow <b>Terrain</b></div>
      <div class="cur-name">{{ S.screen==='app' ? (S.m?.info.name || 'Campagne sans nom') : '' }}</div>
      <button class="hbtn" :class="{on: S.set.dim > 0}" @click="S.sheet = {kind: 'eco'}" aria-label="Économie d’énergie"><svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg></button>
      <span class="clock">{{ hm(S.now) }}</span></header>
    <main class="main">
      <home-screen v-if="S.screen==='home'"/>
      <create-screen v-else-if="S.screen==='create'"/>
      <template v-else-if="S.m">
        <map-view v-if="S.tab==='terrain'"/>
        <journal-view v-else-if="S.tab==='journal'" :key="S.m.id"/>
        <sync-view v-else-if="S.tab==='sync'"/>
        <campaign-view v-else-if="S.tab==='campagne'"/>
        <files-view v-else-if="S.tab==='fichier'"/>
      </template>
    </main>
    <nav class="tabs" v-if="S.screen==='app' && S.m">
      <button v-for="t in tabs" :key="t.k" :class="{on: S.tab===t.k}" @click="S.tab=t.k">
        <svg viewBox="0 0 24 24"><path :d="t.i"/></svg><span>{{ t.l }}</span>
        <i v-if="t.k==='terrain' && S.recording" class="rec-badge" :class="{lost: S.gpsLost}"></i><i v-if="t.k==='sync' && syncTodo" class="todo-badge"></i></button>
    </nav>
    <poi-sheet v-if="S.sheet?.kind==='poi'"/>
    <rec-sheet v-if="S.sheet?.kind==='rec'"/>
    <weather-sheet v-if="S.sheet?.kind==='weather'"/>
    <eco-sheet v-if="S.sheet?.kind==='eco'"/>
    <camera-view v-if="S.cam"/>
    <div class="toasts"><div v-for="t in S.toasts" :key="t.id" class="toast" :class="t.kind">{{ t.msg }}</div></div>
    <div v-if="S.busy" class="busy"><div class="spinner"></div>{{ S.busy }}</div>
    <div v-if="veil" class="veil" :style="'background:rgba(0,0,0,' + veil + ')'"></div>
    <black-screen v-if="S.black"/>
    <div v-if="S.flash" class="alarm-flash" @click="S.flash = 0"><b>{{ S.gpsLost ? 'GPS PERDU' : 'ÉCRAN COUPÉ' }}</b></div>
  </div>`,
};

createApp(App).mount('#app');
if ('serviceWorker' in navigator && isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => { /* hors ligne indisponible */ });
