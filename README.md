# Road Book — appunti di rally automatici + sfide sui segmenti

Sito statico (HTML/CSS/JS puro, nessuna build necessaria) che:

- fa scegliere partenza e arrivo (geocoding **Nominatim**, dati OpenStreetMap);
- calcola il percorso stradale reale (routing **OSRM**);
- **genera automaticamente gli appunti di rally**: analizza la geometria del
  percorso curva per curva e produce note tipo "Destra 4", "Sinistra
  tornante", "Chicane destra-sinistra", con la distanza reale su strada tra
  una nota e l'altra (motore in `pacenotes.js`);
- permette di **ritagliare un tratto del percorso come segmento cronometrato**
  e sfidare altri piloti in stile Strava, con cronometro GPS e classifica
  (`segments.js`).

## Pubblicare su Netlify

Il sito è statico (non serve una build), ma include due funzioni serverless
per la condivisione dei segmenti tra dispositivi: per attivarle davvero,
usa uno di questi due metodi.

**Deploy da Git (consigliato — attiva la condivisione, ed è il modo più
semplice per aggiornare il sito in futuro):**
1. Crea una repo (GitHub/GitLab/Bitbucket) e caricaci tutti questi file,
   inclusa la cartella `netlify/functions` e `package.json`.
2. Su Netlify: *Add new site → Import an existing project*, collega la repo.
3. Build command: vuoto. Publish directory: `.` (già impostato in `netlify.toml`).
   Netlify farà da solo `npm install` e attiverà le funzioni.

**Netlify CLI (da terminale, attiva la condivisione):**
```
npm install -g netlify-cli
cd rally-pacenotes
npm install
netlify deploy --prod
```

**Drag & drop su [netlify.app/drop](https://app.netlify.com/drop):** è il
modo più rapido per vedere l'interfaccia online, ma **non installa le
dipendenze e non attiva le funzioni serverless** — i segmenti restano
salvati solo nel browser di chi li crea, senza condivisione tra
dispositivi. Usalo solo per una prova veloce, non per l'uso reale.

## Limiti dei servizi pubblici usati

- **Nominatim** (geocoding) e il **server demo OSRM** (routing) sono servizi
  pubblici e gratuiti pensati per un uso leggero, non per traffico intenso.
  Per un sito con molti visitatori conviene ospitare una propria istanza
  OSRM/Nominatim oppure usare un provider a pagamento (es. Mapbox,
  OpenRouteService, GraphHopper): basta cambiare gli URL in `config.js`.
- Il **cronometro dei segmenti** usa la geolocalizzazione del browser
  (`navigator.geolocation`): richiede il consenso dell'utente, funziona meglio
  all'aperto e in movimento reale (a piedi, in bici, in auto come passeggero),
  e richiede **HTTPS** — Netlify lo fornisce automaticamente.

## Classifica e segmenti condivisi tra tutti i piloti

Il sito include due funzioni serverless (`netlify/functions/segments.js` e
`results.js`) che usano **Netlify Blobs**, il database incluso in ogni sito
Netlify: pubblicando con uno dei metodi consigliati sopra (Git o CLI), tutti
i visitatori vedono gli stessi segmenti e la stessa classifica, senza
creare account esterni.

Se apri il sito come file locale (`file://…`), o se lo pubblichi con il
semplice drag & drop, queste funzioni non sono raggiungibili: l'app lo
rileva da sola e usa `localStorage` (solo su quel browser) come ripiego.

### Alternativa: usare un tuo Supabase al posto di Netlify Blobs

Se preferisci un database tuo (per portabilità, backup, o per usarlo anche
fuori da Netlify), puoi comunque configurare Supabase; l'app lo userà come
secondo tentativo se le funzioni Netlify non rispondono:

1. Crea un progetto gratuito su [supabase.com](https://supabase.com).
2. Nell'editor SQL del progetto, esegui:

```sql
create table segments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  coords jsonb not null,
  distance_m numeric not null,
  created_at timestamptz not null default now()
);

create table results (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid references segments(id) on delete cascade,
  player_name text not null,
  time_ms integer not null,
  created_at timestamptz not null default now()
);

alter table segments enable row level security;
alter table results enable row level security;

create policy "public read segments" on segments for select using (true);
create policy "public insert segments" on segments for insert with check (true);
create policy "public delete segments" on segments for delete using (true);
create policy "public read results" on results for select using (true);
create policy "public insert results" on results for insert with check (true);
```

3. In *Project Settings → API*, copia **Project URL** e **anon public key**.
4. Incollali in `config.js` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`).

### Come verificare se la condivisione funziona

Nella scheda **Segmenti** del sito compare ora un indicatore:

- **✓ Sincronizzato** (pallino verde) — i segmenti sono davvero condivisi tra
  tutti i dispositivi.
- **⚠ Solo su questo dispositivo** (pallino giallo) — il backend condiviso
  non è raggiungibile: i dati restano nel `localStorage` di quel browser.

### "Ho pubblicato il sito ma i segmenti non si vedono tra dispositivi diversi"

La causa quasi sempre è questa: **il drag & drop su
[netlify.app/drop](https://app.netlify.com/drop) non installa le dipendenze
npm e non esegue una build**. Le funzioni serverless richiedono il pacchetto
`@netlify/blobs` elencato in `package.json`: se non viene installato, la
funzione va in errore e il sito torna, in silenzio, al solo `localStorage`
(da qui l'indicatore giallo sopra).

**Soluzione: pubblica con uno di questi due metodi, non il semplice
trascinamento della cartella:**

1. **Deploy da Git (il più semplice da mantenere nel tempo)**
   - Crea una repository su GitHub (o GitLab/Bitbucket) e caricaci tutti i
     file del progetto, inclusa la cartella `netlify/functions` e
     `package.json`.
   - Su Netlify: *Add new site → Import an existing project*, collega la
     repository.
   - Lascia il *Build command* vuoto e *Publish directory* = `.` (Netlify
     legge comunque `netlify.toml`). Netlify farà da solo `npm install` e
     attiverà le funzioni.

2. **Netlify CLI da terminale**
   ```
   npm install -g netlify-cli
   cd rally-pacenotes
   npm install
   netlify deploy --prod
   ```
   Il comando `npm install` locale è importante: scarica `@netlify/blobs`
   prima del deploy.

**Per controllare direttamente se la funzione è attiva:** apri nel browser
`https://tuosito.netlify.app/.netlify/functions/segments` — se risponde
`[]` (o una lista di segmenti) la condivisione funziona; se vedi una
pagina di errore, il deploy non ha incluso correttamente le funzioni (torna
al punto sopra). Per i dettagli dell'errore, nel pannello Netlify vai su
*Functions* e apri i log della funzione `segments`.

## Generazione automatica degli appunti anche per i segmenti

Quando selezioni un segmento dalla lista "Segmenti", il sito rigenera al
volo gli appunti di rally per quel singolo tratto (stesso motore usato per
il percorso intero) e li mostra come una fila di etichette sopra la
classifica, oltre a evidenziare le curve sulla mappa.


## Come funziona la generazione degli appunti (in breve)

1. Il percorso restituito da OSRM viene **semplificato** (algoritmo
   Douglas-Peucker) per isolare i punti in cui la strada cambia davvero
   direzione, ignorando il rumore del tracciato GPS/stradale.
2. Per ogni vertice si calcola l'angolo di svolta tra il segmento in entrata
   e quello in uscita.
3. Le svolte molto ravvicinate nella stessa direzione vengono unite in
   un'unica curva; due svolte opposte molto ravvicinate diventano una
   **chicane**.
4. Ogni curva viene classificata su una scala **1–6** (1 = tornante
   strettissimo, 6 = curva veloce), la stessa logica usata in molti road book
   di gara reali.
5. La distanza tra una nota e la successiva è calcolata **lungo la strada
   reale** (non in linea d'aria).

La scala e le soglie sono euristiche ragionevoli, non uno standard FIA
ufficiale: si possono affinare cambiando le costanti in cima a
`pacenotes.js` (`MIN_TURN_DEG`, `MERGE_DIST_M`, `CHICANE_DIST_M`, e la
funzione `classify`).

## Struttura dei file

```
index.html      struttura della pagina
style.css       identità visiva "road book"
config.js       endpoint pubblici + chiavi Supabase opzionali
pacenotes.js     motore di generazione appunti di rally
segments.js      storage segmenti/classifica + cronometro GPS
app.js          mappa, geocoding, routing, rendering, interazioni
netlify.toml    configurazione di pubblicazione
```
