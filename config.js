// ============================================================
// CONFIG — endpoint pubblici e (opzionale) backend condiviso
// ============================================================
window.APP_CONFIG = {

  // Geocoding (indirizzo -> coordinate). Nominatim è il servizio
  // pubblico di OpenStreetMap: gratuito ma con policy d'uso leggero
  // (no bombardamento di richieste). Per un sito con molto traffico
  // conviene un provider a pagamento o un'istanza Nominatim propria.
  NOMINATIM_URL: 'https://nominatim.openstreetmap.org/search',
  NOMINATIM_REVERSE_URL: 'https://nominatim.openstreetmap.org/reverse',

  // Routing (percorso stradale reale + geometria). Server demo
  // pubblico OSRM: comodo per iniziare, ma non pensato per traffico
  // di produzione elevato. Per un uso serio si può ospitare la
  // propria istanza OSRM (open source) o usare un provider dedicato.
  OSRM_URL: 'https://router.project-osrm.org/route/v1/driving',

  // ---- Classifica condivisa tra dispositivi (opzionale) ----
  // Di default i segmenti e i tempi vengono salvati SOLO nel
  // browser (localStorage): funzionano subito ma non sono condivisi
  // con altri piloti. Per una classifica vera, in stile Strava,
  // visibile a tutti, crea un progetto gratuito su https://supabase.com,
  // crea le due tabelle indicate nel README e incolla qui le chiavi.
  // Se questi valori restano vuoti, l'app usa automaticamente il
  // solo localStorage.
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
};
