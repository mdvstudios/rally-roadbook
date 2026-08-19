// ============================================================
// Funzione serverless: classifica condivisa (tempi) per segmento.
// ============================================================
// Aggiungi connectLambda qui nell'import
const { getStore, connectLambda } = require('@netlify/blobs');

exports.handler = async (event) => {
  // Collega l'evento all'ambiente Blobs
  connectLambda(event);
  
  const store = getStore('rb-results');

  try {
    // ... [il resto del tuo codice qui sotto rimane assolutamente identico]
    if (event.httpMethod === 'GET') {
      const segmentId = event.queryStringParameters?.segmentId;
      if (!segmentId) return json(400, { error: 'missing segmentId' });
      const { blobs } = await store.list({ prefix: `${segmentId}:` });
      const results = await Promise.all(blobs.map(b => store.get(b.key, { type: 'json' })));
      results.sort((a, b) => (a?.time_ms || 0) - (b?.time_ms || 0));
      return json(200, results.filter(Boolean));
    }

    if (event.httpMethod === 'POST') {
      const result = JSON.parse(event.body || '{}');
      if (!result.segment_id || !result.id) return json(400, { error: 'missing fields' });
      await store.setJSON(`${result.segment_id}:${result.id}`, result);
      return json(200, result);
    }

    return json(405, { error: 'method not allowed' });
  } catch (err) {
    return json(500, { error: String(err) });
  }
};

function json(statusCode, data) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}
