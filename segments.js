// ============================================================
// SEGMENTS — sfide cronometrate stile Strava, condivise tra tutti
// i visitatori del sito.
//
// Ordine di preferenza del backend (a cascata, del tutto trasparente):
//   1. Netlify Functions + Netlify Blobs — condiviso, funziona da
//      solo appena il sito è pubblicato su Netlify, zero account
//      esterni da creare.
//   2. Supabase — se l'hai configurato in config.js (utile se vuoi
//      un tuo database invece di quello di Netlify).
//   3. localStorage — solo su questo dispositivo/browser (fallback
//      usato ad es. se apri il sito come file locale).
// ============================================================
window.RallySegments = (function () {

  const START_RADIUS_M = 25;
  const END_RADIUS_M = 25;
  const LS_SEGMENTS = 'rb_segments';
  const LS_RESULTS = 'rb_results';
  const NETLIFY_FN_BASE = '/.netlify/functions';

  const cfg = window.APP_CONFIG || {};
  const hasSupabase = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);

  let lastBackend = 'local'; // aggiornato ad ogni chiamata riuscita, usato solo per l'interfaccia

  function uid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function readLS(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); }
    catch (e) { return []; }
  }
  function writeLS(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  }

  async function nlFetch(path, options = {}) {
    const res = await fetch(`${NETLIFY_FN_BASE}/${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    if (!res.ok) throw new Error(`Netlify function error ${res.status}`);
    return res.json();
  }

  async function sbFetch(path, options = {}) {
    const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/${path}`, {
      ...options,
      headers: {
        'apikey': cfg.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${cfg.SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
        ...(options.headers || {}),
      },
    });
    if (!res.ok) throw new Error(`Supabase error ${res.status}`);
    return res.json();
  }

  // ---------------- segments ----------------

  async function listSegments() {
    try {
      const segments = await nlFetch('segments');
      lastBackend = 'netlify';
      return segments;
    } catch (e) { /* Netlify Functions non disponibili, provo il prossimo backend */ }

    if (hasSupabase) {
      try {
        const segments = await sbFetch('segments?select=*&order=created_at.desc');
        lastBackend = 'supabase';
        return segments;
      } catch (e) { console.warn('Supabase non raggiungibile, uso i dati locali', e); }
    }
    lastBackend = 'local';
    return readLS(LS_SEGMENTS).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async function saveSegment({ name, coords, distanceM }) {
    const segment = {
      id: uid(),
      name,
      coords,
      distance_m: Math.round(distanceM),
      created_at: new Date().toISOString(),
    };

    try {
      const saved = await nlFetch('segments', { method: 'POST', body: JSON.stringify(segment) });
      lastBackend = 'netlify';
      return saved;
    } catch (e) { /* provo il prossimo backend */ }

    if (hasSupabase) {
      try {
        const [saved] = await sbFetch('segments', { method: 'POST', body: JSON.stringify(segment) });
        lastBackend = 'supabase';
        return saved;
      } catch (e) { console.warn('Salvataggio su Supabase fallito, salvo localmente', e); }
    }

    lastBackend = 'local';
    const all = readLS(LS_SEGMENTS);
    all.push(segment);
    writeLS(LS_SEGMENTS, all);
    return segment;
  }

  async function deleteSegment(id) {
    try { await nlFetch(`segments?id=${encodeURIComponent(id)}`, { method: 'DELETE' }); return; }
    catch (e) { /* provo il prossimo backend */ }

    if (hasSupabase) {
      try { await sbFetch(`segments?id=eq.${id}`, { method: 'DELETE' }); return; }
      catch (e) { console.warn('Eliminazione su Supabase fallita', e); }
    }

    writeLS(LS_SEGMENTS, readLS(LS_SEGMENTS).filter(s => s.id !== id));
    writeLS(LS_RESULTS, readLS(LS_RESULTS).filter(r => r.segment_id !== id));
  }

  // ---------------- results / leaderboard ----------------

  async function listResults(segmentId) {
    try {
      const results = await nlFetch(`results?segmentId=${encodeURIComponent(segmentId)}`);
      lastBackend = 'netlify';
      return results;
    } catch (e) { /* provo il prossimo backend */ }

    if (hasSupabase) {
      try {
        const results = await sbFetch(`results?segment_id=eq.${segmentId}&select=*&order=time_ms.asc`);
        lastBackend = 'supabase';
        return results;
      } catch (e) { console.warn('Supabase non raggiungibile, uso i dati locali', e); }
    }

    lastBackend = 'local';
    return readLS(LS_RESULTS)
      .filter(r => r.segment_id === segmentId)
      .sort((a, b) => a.time_ms - b.time_ms);
  }

  async function saveResult({ segmentId, playerName, timeMs }) {
    const result = {
      id: uid(),
      segment_id: segmentId,
      player_name: playerName,
      time_ms: Math.round(timeMs),
      created_at: new Date().toISOString(),
    };

    try {
      await nlFetch('results', { method: 'POST', body: JSON.stringify(result) });
      lastBackend = 'netlify';
      return result;
    } catch (e) { /* provo il prossimo backend */ }

    if (hasSupabase) {
      try { await sbFetch('results', { method: 'POST', body: JSON.stringify(result) }); lastBackend = 'supabase'; return result; }
      catch (e) { console.warn('Salvataggio su Supabase fallito, salvo localmente', e); }
    }

    lastBackend = 'local';
    const all = readLS(LS_RESULTS);
    all.push(result);
    writeLS(LS_RESULTS, all);
    return result;
  }

  function getBackendLabel() {
    if (lastBackend === 'netlify') return 'Classifica condivisa: tutti i piloti che aprono questo sito vedono gli stessi segmenti e tempi.';
    if (lastBackend === 'supabase') return 'Classifica condivisa tramite il tuo database Supabase.';
    return 'Classifica salvata solo su questo dispositivo (nessun backend condiviso raggiungibile — su Netlify dovrebbe attivarsi da solo; vedi README).';
  }

  function getLastBackend() {
    return lastBackend;
  }

  // Verifica esplicitamente quale backend risponde, senza scrivere nulla.
  // Utile per mostrare subito uno stato attendibile nell'interfaccia,
  // invece di scoprirlo solo al primo salvataggio.
  async function checkBackend() {
    try { await nlFetch('segments'); lastBackend = 'netlify'; return 'netlify'; }
    catch (e) { /* provo il prossimo */ }

    if (hasSupabase) {
      try { await sbFetch('segments?select=id&limit=1'); lastBackend = 'supabase'; return 'supabase'; }
      catch (e) { /* provo il prossimo */ }
    }

    lastBackend = 'local';
    return 'local';
  }

  // ---------------- geometry helpers ----------------

  function sliceRouteBetween(routeCoords, coordA, coordB) {
    const line = turf.lineString(routeCoords);
    const ptA = turf.nearestPointOnLine(line, turf.point(coordA));
    const ptB = turf.nearestPointOnLine(line, turf.point(coordB));
    let from = ptA, to = ptB;
    if (ptA.properties.location > ptB.properties.location) { from = ptB; to = ptA; }
    const sliced = turf.lineSlice(from.geometry.coordinates, to.geometry.coordinates, line);
    const distanceM = turf.length(sliced, { units: 'kilometers' }) * 1000;
    return { coords: sliced.geometry.coordinates, distanceM };
  }

  // ---------------- live GPS timer ----------------

  function createTimer({ onStatus, onTick, onFinish, onError }) {
    let watchId = null;
    let tickId = null;
    let phase = 'idle';
    let startedAt = null;

    function distanceM(a, b) {
      return turf.distance(turf.point(a), turf.point(b), { units: 'kilometers' }) * 1000;
    }

    function start(segment) {
      if (!navigator.geolocation) {
        onError('Questo dispositivo/browser non supporta la geolocalizzazione.');
        return;
      }
      phase = 'waiting-start';
      onStatus('In attesa del punto di partenza…');

      watchId = navigator.geolocation.watchPosition(handlePosition, err => {
        onError('Errore GPS: ' + err.message);
      }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });

      function handlePosition(pos) {
        const coord = [pos.coords.longitude, pos.coords.latitude];
        const startCoord = segment.coords[0];
        const endCoord = segment.coords[segment.coords.length - 1];

        if (phase === 'waiting-start') {
          const d = distanceM(coord, startCoord);
          onStatus(`In attesa del via — a ${Math.round(d)} m dalla partenza`);
          if (d <= START_RADIUS_M) {
            phase = 'running';
            startedAt = performance.now();
            onStatus('Cronometro avviato — vai!');
            tickId = setInterval(() => onTick(performance.now() - startedAt), 100);
          }
        } else if (phase === 'running') {
          const d = distanceM(coord, endCoord);
          if (d <= END_RADIUS_M) {
            const elapsed = performance.now() - startedAt;
            stop();
            onFinish(elapsed);
          }
        }
      }
    }

    function stop() {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      if (tickId !== null) clearInterval(tickId);
      watchId = null; tickId = null; phase = 'idle';
    }

    return { start, stop };
  }

  return {
    hasSupabase,
    listSegments, saveSegment, deleteSegment,
    listResults, saveResult,
    getBackendLabel, getLastBackend, checkBackend,
    sliceRouteBetween,
    createTimer,
  };
})();
