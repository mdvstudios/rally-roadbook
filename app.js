// ============================================================
// APP — collega mappa, geocoding, routing, road book e segmenti
// ============================================================
(function () {
  const cfg = window.APP_CONFIG;

  // ---------------- Ottimizzazione Mobile: Solo Segmenti a tutto schermo ----------------
  if (window.innerWidth <= 768) {
    // Nasconde completamente la mappa, l'header di ricerca e il selettore delle tab
    const mapElement = document.getElementById('map');
    if (mapElement) mapElement.style.display = 'none';

    const searchContainer = document.querySelector('.search-container');
    if (searchContainer) searchContainer.style.display = 'none';

    const sidebarTabs = document.querySelector('.sidebar-tabs');
    if (sidebarTabs) sidebarTabs.style.display = 'none';

    // Seleziona e mostra direttamente e a tutto schermo il pannello dei segmenti
    const tabSegments = document.getElementById('tab-segments');
    if (tabSegments) tabSegments.classList.add('is-active');
    
    const tabAppunti = document.getElementById('tab-appunti');
    if (tabAppunti) tabAppunti.classList.remove('is-active');
  }

  // ---------------- map ----------------
  const map = L.map('map', { zoomControl: true }).setView([45.4384, 10.9916], 8); // Verona
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  let routeLayer = null;
  let cornerMarkersLayer = L.layerGroup().addTo(map);
  let segmentPreviewLayer = null;
  let currentRoute = null; // { coords: [[lon,lat],...], distanceKm, durationMin }
  let currentNotes = [];

  // pin di partenza/arrivo trascinabili, stile Google Maps
  let pointMarkers = { start: null, end: null };
  let pickMode = null; // null | 'start' | 'end'
  const mapEl = document.getElementById('map');
  const mapHint = document.getElementById('map-hint');

  // ---------------- geocoding (Nominatim) ---------------
  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  async function geocode(query) {
    const url = `${cfg.NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=0`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'it' } });
    if (!res.ok) throw new Error('Geocoding non disponibile');
    return res.json();
  }

  async function reverseGeocode(coord) {
    try {
      const url = `${cfg.NOMINATIM_REVERSE_URL}?format=json&lat=${coord[1]}&lon=${coord[0]}&zoom=16`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'it' } });
      if (!res.ok) throw new Error('reverse geocoding fallito');
      const data = await res.json();
      return data.display_name || `${coord[1].toFixed(5)}, ${coord[0].toFixed(5)}`;
    } catch (e) {
      return `${coord[1].toFixed(5)}, ${coord[0].toFixed(5)}`;
    }
  }

  function wireAutocomplete(inputId, listId) {
    const input = document.getElementById(inputId);
    const list = document.getElementById(listId);

    input.dataset.coord = '';

    const run = debounce(async () => {
      const q = input.value.trim();
      if (q.length < 3) { list.hidden = true; return; }
      try {
        const results = await geocode(q);
        list.innerHTML = '';
        if (!results.length) { list.hidden = true; return; }
        results.forEach(r => {
          const li = document.createElement('li');
          li.textContent = r.display_name;
          li.addEventListener('click', () => {
            input.value = r.display_name;
            const coord = [parseFloat(r.lon), parseFloat(r.lat)];
            input.dataset.coord = JSON.stringify(coord);
            setPointMarker(inputId, coord);
            map.panTo([coord[1], coord[0]]);
            list.hidden = true;
          });
          list.appendChild(li);
        });
        list.hidden = false;
      } catch (e) {
        list.hidden = true;
      }
    }, 400);

    input.addEventListener('input', () => { input.dataset.coord = ''; run(); });
    input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
  }

  wireAutocomplete('start', 'start-suggest');
  wireAutocomplete('end', 'end-suggest');

  document.getElementById('swap-btn').addEventListener('click', () => {
    const s = document.getElementById('start');
    const e = document.getElementById('end');
    [s.value, e.value] = [e.value, s.value];
    [s.dataset.coord, e.dataset.coord] = [e.dataset.coord, s.dataset.coord];
    if (pointMarkers.start && pointMarkers.end) {
      const a = pointMarkers.start.getLatLng(), b = pointMarkers.end.getLatLng();
      pointMarkers.start.setLatLng(b); pointMarkers.end.setLatLng(a);
    } else if (pointMarkers.start || pointMarkers.end) {
      if (s.dataset.coord) setPointMarker('start', JSON.parse(s.dataset.coord));
      if (e.dataset.coord) setPointMarker('end', JSON.parse(e.dataset.coord));
    }
  });

  // ---------------- pin A/B trascinabili stile Google Maps ----------------
  function pinIconSvg(letter, role) {
    return `<div class="point-pin role-${role}">
      <svg viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg">
        <path d="M15 0C6.7 0 0 6.7 0 15c0 10.5 15 25 15 25s15-14.5 15-25C30 6.7 23.3 0 15 0z"/>
        <circle cx="15" cy="15" r="9" fill="#fff"/>
        <text x="15" y="20" font-size="12" font-weight="700" text-anchor="middle" font-family="IBM Plex Mono, monospace">${letter}</text>
      </svg>
    </div>`;
  }

  function setPointMarker(role, coord) {
    const letter = role === 'start' ? 'A' : 'B';
    const latlng = [coord[1], coord[0]];
    if (pointMarkers[role]) {
      pointMarkers[role].setLatLng(latlng);
      return;
    }
    const icon = L.divIcon({ className: '', html: pinIconSvg(letter, role), iconSize: [30, 40], iconAnchor: [15, 40] });
    const marker = L.marker(latlng, { icon, draggable: true }).addTo(map);
    marker.on('dragend', async () => {
      const ll = marker.getLatLng();
      const newCoord = [ll.lng, ll.lat];
      const input = document.getElementById(role);
      input.value = '…';
      const label = await reverseGeocode(newCoord);
      input.value = label;
      input.dataset.coord = JSON.stringify(newCoord);
    });
    pointMarkers[role] = marker;
  }

  function setPickMode(role) {
    pickMode = pickMode === role ? null : role;
    document.getElementById('pin-start').classList.toggle('is-active', pickMode === 'start');
    document.getElementById('pin-end').classList.toggle('is-active', pickMode === 'end');
    mapEl.classList.toggle('is-picking', !!pickMode);
    mapHint.hidden = !pickMode;
    if (pickMode) mapHint.textContent = `Tocca la mappa per impostare ${pickMode === 'start' ? 'la partenza' : "l'arrivo"}`;
  }

  document.getElementById('pin-start').addEventListener('click', () => setPickMode('start'));
  document.getElementById('pin-end').addEventListener('click', () => setPickMode('end'));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pickMode) setPickMode(pickMode); });

  async function resolveCoord(inputId) {
    const input = document.getElementById(inputId);
    if (input.dataset.coord) return JSON.parse(input.dataset.coord);
    const results = await geocode(input.value.trim());
    if (!results.length) throw new Error(`Indirizzo non trovato: "${input.value}"`);
    return [parseFloat(results[0].lon), parseFloat(results[0].lat)];
  }

  // ---------------- routing (OSRM) ----------------
  async function fetchRoute(startCoord, endCoord) {
    const url = `${cfg.OSRM_URL}/${startCoord[0]},${startCoord[1]};${endCoord[0]},${endCoord[1]}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Servizio di routing non disponibile');
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes?.length) throw new Error('Nessun percorso trovato tra questi due punti');
    const route = data.routes[0];
    return {
      coords: route.geometry.coordinates,
      distanceKm: route.distance / 1000,
      durationMin: route.duration / 60,
    };
  }

  // ---------------- pictogram ----------------
  function cornerIconSvg(note) {
    const size = 40;
    const c = size / 2;
    if (note.isChicane) {
      const flip = note.dir1 === 'destra' ? 1 : -1;
      return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
        <path d="M 8 30 Q 16 ${c} 20 ${c} Q 24 ${flip>0?10:30} 32 10" fill="none" stroke="var(--orange)" stroke-width="4" stroke-linecap="round"/>
        <path d="M 32 10 l -6 -1 M 32 10 l -2 6" fill="none" stroke="var(--orange)" stroke-width="4" stroke-linecap="round"/>
      </svg>`;
    }
    const isRight = note.angle > 0;
    const bendMap = { 1: 30, 2: 24, 3: 18, 4: 13, 5: 8, 6: 4 };
    const bend = bendMap[note.severity] || 10;
    const sx = 6, sy = 34, ex = 34, ey = 6;
    const cx = isRight ? c + bend : c - bend;
    const cy = c;
    const color = note.isHairpin ? 'var(--orange-dark)' : 'var(--ink)';
    const flagMark = note.isHairpin
      ? `<rect x="${isRight? 30:2}" y="4" width="7" height="7" fill="var(--yellow)" stroke="var(--ink)" stroke-width="1" transform="rotate(45 ${isRight?33.5:5.5} 7.5)"/>`
      : '';
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      <path d="M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round"/>
      <path d="M ${ex} ${ey} l -7 1 M ${ex} ${ey} l 1 7" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round"/>
      ${flagMark}
    </svg>`;
  }

  // ---------------- rendering ----------------
  function clearMapLayers() {
    if (routeLayer) map.removeLayer(routeLayer);
    if (segmentPreviewLayer) { map.removeLayer(segmentPreviewLayer); segmentPreviewLayer = null; }
    cornerMarkersLayer.clearLayers();
  }

  function renderRoute(route) {
    clearMapLayers();
    const latlngs = route.coords.map(([lon, lat]) => [lat, lon]);
    routeLayer = L.polyline(latlngs, { color: '#ff4612', weight: 5, opacity: 0.9 }).addTo(map);
    map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });
  }

  function renderCornerPins(notes) {
    cornerMarkersLayer.clearLayers();
    notes.forEach(note => {
      const icon = L.divIcon({
        className: '',
        html: `<div class="corner-pin ${note.isHairpin ? 'is-hairpin' : ''}">${note.order}</div>`,
        iconSize: [26, 26],
      });
      const marker = L.marker([note.coord[1], note.coord[0]], { icon }).addTo(cornerMarkersLayer);
      marker.bindPopup(`<strong>${note.order}. ${note.text}</strong><br>a ${note.distFromPrevM} m dalla nota precedente`);
      marker.on('click', () => highlightNote(note.order));
    });
  }

  function renderNotesStrip(route, notes) {
    const strip = document.getElementById('notes-strip');
    strip.innerHTML = '';
    if (!notes.length) {
      strip.innerHTML = `<li class="notes-empty">Nessuna curva rilevante rilevata: il percorso è sostanzialmente rettilineo.</li>`;
    }
    notes.forEach(note => {
      const li = document.createElement('li');
      li.className = 'note-card' + (note.isHairpin ? ' is-hairpin' : '');
      li.dataset.order = note.order;
      li.innerHTML = `
        <span class="note-card__num">${note.order}</span>
        <span class="note-card__icon">${cornerIconSvg(note)}</span>
        <span class="note-card__body">
          <span class="note-card__text">${note.text}${note.isHairpin ? '<span class="note-card__flag" title="Tornante"></span>' : ''}</span>
          <span class="note-card__dist">tra ${note.distFromPrevM} m</span>
        </span>
      `;
      li.addEventListener('click', () => {
        highlightNote(note.order);
        map.flyTo([note.coord[1], note.coord[0]], 15, { duration: 0.6 });
      });
      strip.appendChild(li);
    });

    document.getElementById('route-meta').hidden = false;
    document.getElementById('scale-legend').hidden = false;
    document.getElementById('meta-distance').textContent = route.distanceKm.toFixed(1);
    document.getElementById('meta-duration').textContent = Math.round(route.durationMin);
    document.getElementById('meta-corners').textContent = notes.length;
  }

  function highlightNote(order) {
    document.querySelectorAll('.note-card').forEach(el => el.classList.remove('is-active'));
    const el = document.querySelector(`.note-card[data-order="${order}"]`);
    if (el) { el.classList.add('is-active'); el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  }

  // ---------------- form submit ----------------
  const form = document.getElementById('route-form');
  const generateBtn = document.getElementById('generate-btn');
  const createSegmentBtn = document.getElementById('create-segment-btn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    generateBtn.disabled = true;
    generateBtn.textContent = 'Genero…';
    try {
      const [startCoord, endCoord] = await Promise.all([resolveCoord('start'), resolveCoord('end')]);
      setPointMarker('start', startCoord);
      setPointMarker('end', endCoord);
      const route = await fetchRoute(startCoord, endCoord);
      currentRoute = route;
      currentNotes = window.RallyPaceNotes.generate(route.coords);
      renderRoute(route);
      renderCornerPins(currentNotes);
      renderNotesStrip(route, currentNotes);
      createSegmentBtn.disabled = false;
    } catch (err) {
      alert(err.message || 'Si è verificato un errore nella generazione del percorso.');
    } finally {
      generateBtn.disabled = false;
      generateBtn.textContent = 'Genera road book';
    }
  });

  // ---------------- tabs ----------------
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => { t.classList.remove('is-active'); t.setAttribute('aria-selected', 'false'); });
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('is-active'));
      tab.classList.add('is-active'); tab.setAttribute('aria-selected', 'true');
      document.querySelector(`.tab-panel[data-panel="${tab.dataset.tab}"]`).classList.add('is-active');
      if (tab.dataset.tab === 'segments') refreshSegmentsList();
    });
  });

  // ================= SEGMENTS =================
  const hintEl = document.getElementById('segment-hint');
  const segmentsListEl = document.getElementById('segments-list');
  let segmentPickMode = false;
  let segmentPickFirst = null;

  createSegmentBtn.addEventListener('click', () => {
    if (!currentRoute) return;
    segmentPickMode = true;
    segmentPickFirst = null;
    hintEl.hidden = false;
    hintEl.textContent = 'Tocca sulla mappa il punto di inizio del segmento.';
  });

  map.on('click', async (e) => {
    if (pickMode) {
      const role = pickMode;
      const coord = [e.latlng.lng, e.latlng.lat];
      const input = document.getElementById(role);
      input.value = '…';
      input.dataset.coord = JSON.stringify(coord);
      setPointMarker(role, coord);
      setPickMode(role);
      input.value = await reverseGeocode(coord);
      return;
    }

    if (!segmentPickMode || !currentRoute) return;
    const clicked = [e.latlng.lng, e.latlng.lat];
    const nearest = turf.nearestPointOnLine(turf.lineString(currentRoute.coords), turf.point(clicked));
    const snapped = nearest.geometry.coordinates;

    if (!segmentPickFirst) {
      segmentPickFirst = snapped;
      L.circleMarker([snapped[1], snapped[0]], { radius: 7, color: '#17332b', fillColor: '#17332b', fillOpacity: 1 }).addTo(map);
      hintEl.textContent = 'Ora tocca il punto di fine del segmento.';
    } else {
      const { coords, distanceM } = window.RallySegments.sliceRouteBetween(currentRoute.coords, segmentPickFirst, snapped);
      segmentPickMode = false;
      hintEl.hidden = true;
      if (segmentPreviewLayer) map.removeLayer(segmentPreviewLayer);
      segmentPreviewLayer = L.polyline(coords.map(([lon, lat]) => [lat, lon]), { color: '#17332b', weight: 7, opacity: 0.85 }).addTo(map);

      const name = prompt('Nome del segmento (es. "Discesa Passo Fedaia"):', `Segmento ${distanceM < 1000 ? Math.round(distanceM) + ' m' : (distanceM/1000).toFixed(1) + ' km'}`);
      if (name) {
        window.RallySegments.saveSegment({ name, coords, distanceM }).then(refreshSegmentsList);
      }
    }
  });

  async function refreshSegmentsList() {
    const segments = await window.RallySegments.listSegments();
    updateBackendBadge();
    segmentsListEl.innerHTML = '';
    if (!segments.length) {
      segmentsListEl.innerHTML = `<li class="segments-empty">Nessun segmento ancora creato. Genera un percorso e ritagliane uno per iniziare le sfide.</li>`;
      return;
    }
    segments.forEach(seg => {
      const li = document.createElement('li');
      li.className = 'segment-item';
      const km = (seg.distance_m / 1000).toFixed(2);
      li.innerHTML = `<div class="segment-item__name">${seg.name}</div><div class="segment-item__meta">${km} km</div>`;
      li.addEventListener('click', () => openLeaderboard(seg));
      segmentsListEl.appendChild(li);
    });
  }

  function updateBackendBadge() {
    const badge = document.getElementById('backend-status');
    const backend = window.RallySegments.getLastBackend();
    badge.classList.remove('is-shared', 'is-local');
    if (backend === 'netlify' || backend === 'supabase') {
      badge.classList.add('is-shared');
      badge.textContent = backend === 'netlify'
        ? '✓ Sincronizzato — tutti i piloti vedono questi segmenti'
        : '✓ Sincronizzato con Supabase — condiviso tra tutti';
    } else {
      badge.classList.add('is-local');
      badge.textContent = '⚠ Solo su questo dispositivo (backend condiviso non raggiungibile)';
    }
  }

  window.RallySegments.checkBackend().then(updateBackendBadge);

  // ---------------- leaderboard modal ----------------
  const modal = document.getElementById('leaderboard-modal');
  let activeSegment = null;

  function formatTime(ms) {
    const totalSec = ms / 1000;
    const min = Math.floor(totalSec / 60);
    const sec = (totalSec % 60).toFixed(1).padStart(4, '0');
    return `${String(min).padStart(2, '0')}:${sec}`;
  }

  async function openLeaderboard(segment) {
    activeSegment = segment;
    document.getElementById('leaderboard-title').textContent = segment.name;
    document.getElementById('leaderboard-meta').textContent = `${(segment.distance_m / 1000).toFixed(2)} km`;
    document.getElementById('sync-note').textContent = window.RallySegments.getBackendLabel();

    if (segmentPreviewLayer) map.removeLayer(segmentPreviewLayer);
    segmentPreviewLayer = L.polyline(segment.coords.map(([lon, lat]) => [lat, lon]), { color: '#17332b', weight: 7, opacity: 0.85 }).addTo(map);
    map.fitBounds(segmentPreviewLayer.getBounds(), { padding: [60, 60] });

    const segmentNotes = window.RallyPaceNotes.generate(segment.coords);
    renderCornerPins(segmentNotes);
    renderSegmentNotes(segmentNotes);

    const results = await window.RallySegments.listResults(segment.id);
    const list = document.getElementById('leaderboard-list');
    list.innerHTML = '';
    if (!results.length) {
      list.innerHTML = `<li>Nessun tempo registrato. Sii il primo a sfidare questo segmento!</li>`;
    } else {
      results.forEach((r, i) => {
        const li = document.createElement('li');
        li.innerHTML = `<span class="rank">${i + 1}.</span><span class="name">${r.player_name}</span><span>${formatTime(r.time_ms)}</span>`;
        list.appendChild(li);
      });
    }
    modal.hidden = false;
  }

  function renderSegmentNotes(notes) {
    const box = document.getElementById('segment-notes');
    if (!notes.length) {
      box.innerHTML = `<p class="segment-notes__empty">Nessuna curva rilevante su questo tratto: sostanzialmente rettilineo.</p>`;
      return;
    }
    box.innerHTML = notes.map(note => `
      <div class="segment-note-chip ${note.isHairpin ? 'is-hairpin' : ''}">
        <span class="segment-note-chip__icon">${cornerIconSvg(note)}</span>
        <span>${note.text}</span>
      </div>
    `).join('');
  }

  document.getElementById('leaderboard-close').addEventListener('click', () => {
    modal.hidden = true;
    if (segmentPreviewLayer) { map.removeLayer(segmentPreviewLayer); segmentPreviewLayer = null; }
    
    if (currentRoute) { 
      renderCornerPins(currentNotes); 
      map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] }); 
    } else {
      cornerMarkersLayer.clearLayers();
    }
  });

  document.getElementById('delete-segment-btn').addEventListener('click', async () => {
    if (!activeSegment) return;
    if (!confirm(`Eliminare il segmento "${activeSegment.name}" e tutti i suoi tempi?`)) return;
    await window.RallySegments.deleteSegment(activeSegment.id);
    modal.hidden = true;
    refreshSegmentsList();
    
    if (segmentPreviewLayer) { map.removeLayer(segmentPreviewLayer); segmentPreviewLayer = null; }
    if (currentRoute) { 
      renderCornerPins(currentNotes); 
      map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] }); 
    } else {
      cornerMarkersLayer.clearLayers();
    }
  });

  // ---------------- GPS timer ----------------
  const hud = document.getElementById('timer-hud');
  let timer = null;

  document.getElementById('start-timer-btn').addEventListener('click', () => {
    if (!activeSegment) return;
    modal.hidden = true;
    hud.hidden = false;
    document.getElementById('timer-segment-name').textContent = activeSegment.name;
    document.getElementById('timer-clock').textContent = '00:00.0';
    document.getElementById('timer-status').textContent = 'In attesa del punto di partenza…';

    timer = window.RallySegments.createTimer({
      onStatus: (msg) => { document.getElementById('timer-status').textContent = msg; },
      onTick: (ms) => { document.getElementById('timer-clock').textContent = formatTime(ms); },
      onFinish: async (ms) => {
        document.getElementById('timer-status').textContent = 'Traguardo! 🏁';
        hud.hidden = true;
        const name = prompt(`Tempo: ${formatTime(ms)}\nCome vuoi comparire in classifica?`, localStorage.getItem('rb_playername') || 'Pilota');
        if (name) {
          localStorage.setItem('rb_playername', name);
          await window.RallySegments.saveResult({ segmentId: activeSegment.id, playerName: name, timeMs: ms });
          openLeaderboard(activeSegment);
        }
      },
      onError: (msg) => { document.getElementById('timer-status').textContent = msg; },
    });
    timer.start(activeSegment);
  });

  document.getElementById('timer-stop-btn').addEventListener('click', () => {
    if (timer) timer.stop();
    hud.hidden = true;
  });

})();