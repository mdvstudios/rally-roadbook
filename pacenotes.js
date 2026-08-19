// ============================================================
// PACE NOTES ENGINE
// Analizza la geometria di un percorso (coordinate [lon,lat])
// e ne estrae automaticamente gli appunti di percorrenza in
// stile rally: direzione + severità 1-6, tornanti, chicane,
// distanza reale su strada fino alla nota successiva.
//
// Scala severità (convenzione usata in molti road book, es. 1-6):
//   1 = tornante / curva strettissima      6 = curva veloce, quasi dritto
// ============================================================
window.RallyPaceNotes = (function () {

  const MIN_TURN_DEG = 12;        // sotto questa soglia: rumore, si ignora
  const MERGE_DIST_M = 35;        // vertici vicini con stessa direzione -> stessa curva
  const CHICANE_DIST_M = 45;      // due curve opposte ravvicinate -> chicane
  const CHICANE_MIN_ANGLE = 24;   // entrambe le curve devono essere almeno così strette

  function normalizeAngle(a) {
    a = ((a + 180) % 360 + 360) % 360 - 180;
    return a;
  }

  function distanceM(a, b) {
    return turf.distance(turf.point(a), turf.point(b), { units: 'kilometers' }) * 1000;
  }

  function classify(absAngle) {
    if (absAngle >= 150) return { severity: 1, isHairpin: true };
    if (absAngle >= 120) return { severity: 1, isHairpin: false };
    if (absAngle >= 95) return { severity: 2, isHairpin: false };
    if (absAngle >= 75) return { severity: 3, isHairpin: false };
    if (absAngle >= 55) return { severity: 4, isHairpin: false };
    if (absAngle >= 35) return { severity: 5, isHairpin: false };
    return { severity: 6, isHairpin: false };
  }

  function adaptiveTolerance(totalLengthKm) {
    // strade corte e tortuose -> più precisione; percorsi lunghi -> più sintesi
    const meters = Math.min(30, Math.max(7, totalLengthKm * 0.4));
    return meters / 111320; // gradi approssimati
  }

  function roadDistanceBetween(originalLine, coordA, coordB) {
    try {
      const sliced = turf.lineSlice(turf.point(coordA), turf.point(coordB), originalLine);
      return turf.length(sliced, { units: 'kilometers' }) * 1000;
    } catch (e) {
      return distanceM(coordA, coordB);
    }
  }

  function detectCorners(simplifiedCoords) {
    const corners = [];
    for (let i = 1; i < simplifiedCoords.length - 1; i++) {
      const prev = simplifiedCoords[i - 1];
      const curr = simplifiedCoords[i];
      const next = simplifiedCoords[i + 1];
      const bIn = turf.bearing(turf.point(prev), turf.point(curr));
      const bOut = turf.bearing(turf.point(curr), turf.point(next));
      const turn = normalizeAngle(bOut - bIn);
      if (Math.abs(turn) >= MIN_TURN_DEG) {
        corners.push({ coord: curr, angle: turn });
      }
    }
    return corners;
  }

  function mergeSameDirection(corners) {
    const merged = [];
    for (const c of corners) {
      const last = merged[merged.length - 1];
      if (last && Math.sign(last.angle) === Math.sign(c.angle) &&
          distanceM(last.coord, c.coord) < MERGE_DIST_M) {
        last.angle = normalizeAngle(last.angle + c.angle);
        last.coord = c.coord; // fine della curva composta
      } else {
        merged.push({ coord: c.coord, angle: c.angle });
      }
    }
    return merged;
  }

  const HAIRPIN_GRADE_DEG = 100;   // oltre questa ampiezza è "roba da tornante", mai una chicane
  const CHICANE_RATIO_MIN = 0.35;  // le due curve devono avere ampiezza paragonabile

  function cornerNote(c) {
    return { type: 'corner', coord: c.coord, angle: c.angle, ...classify(Math.abs(c.angle)) };
  }

  function mergeChicanes(corners) {
    const out = [];
    for (let i = 0; i < corners.length; i++) {
      const cur = corners[i];
      const nxt = corners[i + 1];
      const isCandidatePair = nxt &&
          Math.sign(cur.angle) !== Math.sign(nxt.angle) &&
          Math.abs(cur.angle) >= CHICANE_MIN_ANGLE &&
          Math.abs(nxt.angle) >= CHICANE_MIN_ANGLE &&
          distanceM(cur.coord, nxt.coord) < CHICANE_DIST_M;

      if (isCandidatePair) {
        const a1 = Math.abs(cur.angle), a2 = Math.abs(nxt.angle);
        const bothModerate = a1 < HAIRPIN_GRADE_DEG && a2 < HAIRPIN_GRADE_DEG;
        const comparable = Math.min(a1, a2) / Math.max(a1, a2) >= CHICANE_RATIO_MIN;

        if (bothModerate && comparable) {
          // vera chicane: due curve opposte di ampiezza simile, ravvicinate
          out.push({
            type: 'chicane',
            coord: nxt.coord,
            dir1: cur.angle > 0 ? 'destra' : 'sinistra',
            dir2: nxt.angle > 0 ? 'destra' : 'sinistra',
            severity: Math.min(classify(a1).severity, classify(a2).severity),
          });
        } else {
          // una delle due domina nettamente (es. piccolo "rimbalzo" del
          // tracciato appena prima di un tornante): la curva minore è
          // rumore e va scartata, si segnala solo quella dominante
          out.push(cornerNote(a1 >= a2 ? cur : nxt));
        }
        i++; // consuma anche il secondo elemento in entrambi i casi
      } else {
        out.push(cornerNote(cur));
      }
    }
    return out;
  }

  function buildText(note) {
    if (note.type === 'chicane') {
      const d1 = note.dir1[0].toUpperCase() + note.dir1.slice(1);
      return `Chicane ${d1.toLowerCase()}-${note.dir2}`;
    }
    const dirWord = note.angle > 0 ? 'Destra' : 'Sinistra';
    if (note.isHairpin) return `${dirWord} tornante`;
    return `${dirWord} ${note.severity}`;
  }

  /**
   * @param {Array<[number,number]>} routeCoords  coordinate [lon,lat] del percorso (da OSRM)
   * @returns {Array<object>} lista di appunti ordinati con testo, distanza dal precedente, coordinate
   */
  function generate(routeCoords) {
    if (!routeCoords || routeCoords.length < 3) return [];

    const originalLine = turf.lineString(routeCoords);
    const totalKm = turf.length(originalLine, { units: 'kilometers' });
    const tolerance = adaptiveTolerance(totalKm);

    const simplified = turf.simplify(originalLine, { tolerance, highQuality: true });
    const simplifiedCoords = simplified.geometry.coordinates;

    const rawCorners = detectCorners(simplifiedCoords);
    const merged = mergeSameDirection(rawCorners);
    const withChicanes = mergeChicanes(merged);

    let prevCoord = routeCoords[0];
    const notes = withChicanes.map((note, idx) => {
      const distFromPrev = roadDistanceBetween(originalLine, prevCoord, note.coord);
      prevCoord = note.coord;
      return {
        order: idx + 1,
        type: note.type,
        text: buildText(note),
        severity: note.severity,
        isHairpin: !!note.isHairpin,
        isChicane: note.type === 'chicane',
        coord: note.coord, // [lon,lat]
        distFromPrevM: Math.round(distFromPrev / 5) * 5,
      };
    });

    return notes;
  }

  return { generate, normalizeAngle, distanceM };
})();
