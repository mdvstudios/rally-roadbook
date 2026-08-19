const { getStore, connectLambda } = require('@netlify/blobs');

exports.handler = async (event) => {
  connectLambda(event);
  const store = getStore('rb-segments');

  try {
    // GET: Recupera tutti i segmenti salvati
    if (event.httpMethod === 'GET') {
      const { blobs } = await store.list();
      let segments = await Promise.all(blobs.map(b => store.get(b.key, { type: 'json' })));
      
      segments = segments.filter(Boolean); 
      
      // Ordina dal più recente
      segments.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      
      return json(200, segments);
    }

    // POST: Salva un nuovo segmento
    if (event.httpMethod === 'POST') {
      const segment = JSON.parse(event.body || '{}');
      if (!segment.id || !segment.name || !segment.coords) {
        return json(400, { error: 'Campi obbligatori mancanti' });
      }
      await store.setJSON(segment.id, segment);
      return json(200, segment);
    }

    // DELETE: Elimina un segmento
    if (event.httpMethod === 'DELETE') {
      const id = event.queryStringParameters?.id;
      if (!id) return json(400, { error: 'ID segmento mancante' });
      await store.delete(id);
      return json(200, { success: true, deleted: id });
    }

    return json(405, { error: 'Metodo non consentito' });
  } catch (err) {
    return json(500, { error: String(err) });
  }
};

function json(statusCode, data) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  };
}

function json(statusCode, data) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  };
}
