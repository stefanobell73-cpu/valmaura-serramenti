// Sincronizzazione di stati, note ed esiti collaudo tra dispositivi (Netlify Blobs).
// GET  /api/dati  -> { "<id alloggio>": { _t, stato, note, collaudo:{...} }, ... }
// POST /api/dati  -> unisce le modifiche ricevute: per ogni alloggio vince la più recente (_t)
import { getStore } from "@netlify/blobs";

const s = (x, n = 2000) => String(x ?? "").slice(0, n);

function pulisci(v) {
  if (!v || typeof v !== "object") return null;
  const c = v.collaudo || {};
  return {
    _t: Number(v._t) || 0,
    stato: s(v.stato, 40),
    note: s(v.note),
    collaudo: {
      data: s(c.data, 20),
      tecnico: s(c.tecnico, 200),
      esito: s(c.esito, 40),
      noteVerifica: s(c.noteVerifica, 4000),
      fileWord: s(c.fileWord, 300),
    },
  };
}

export default async (req) => {
  const store = getStore({ name: "valmaura-dati", consistency: "strong" });
  const headers = { "Cache-Control": "no-store" };

  // L'elenco importato resta nello stesso archivio già usato dal sito.
  if (new URL(req.url).searchParams.has('elenco')) {
    if (req.method === 'GET') {
      return Response.json(await store.get('elenco', { type: 'json' }), { headers });
    }
    if (req.method !== 'PUT') return new Response('Metodo non consentito', { status: 405 });
    let righe;
    try { righe = await req.json(); } catch { return new Response('File non valido', { status: 400 }); }
    if (!Array.isArray(righe) || !righe.length || righe.length > 10000 ||
        righe.some(a => !a || typeof a !== 'object' || !String(a.civico || '').trim() || !String(a.interno || '').trim())) {
      return new Response('Elenco non valido (massimo 10000 alloggi, civico e interno obbligatori)', { status: 400 });
    }
    const versione = crypto.randomUUID();
    const alloggi = righe.map((a, i) => ({
      id: `${versione}-${i + 1}`,
      ...Object.fromEntries(['impresa', 'fase', 'civico', 'interno', 'telefono', 'nominativo', 'email'].map(k => [k, s(a[k], 500)])),
      stato: 'In produzione', note: '', _t: 0,
      collaudo: { data: '', tecnico: '', esito: 'Da eseguire', noteVerifica: '', fileWord: '', foto: [] }
    }));
    const elenco = { versione, alloggi };
    await store.setJSON('elenco', elenco);
    return Response.json(elenco, { headers });
  }

  if (req.method === "GET") {
    const dati = (await store.get("alloggi", { type: "json" })) || {};
    return Response.json(dati, { headers });
  }

  if (req.method === "POST") {
    let ricevuti;
    try { ricevuti = await req.json(); } catch { return new Response("JSON non valido", { status: 400 }); }
    // scrittura condizionata (etag): se un altro dispositivo salva nello stesso istante, riprovo l'unione
    for (let tentativo = 0; tentativo < 5; tentativo++) {
      const letto = await store.getWithMetadata("alloggi", { type: "json" });
      const attuali = (letto && letto.data) || {};
      for (const [id, v] of Object.entries(ricevuti || {})) {
        const nuovo = pulisci(v);
        if (!nuovo) continue;
        if (!attuali[id] || nuovo._t > (attuali[id]._t || 0)) attuali[id] = nuovo;
      }
      const esito = letto
        ? await store.setJSON("alloggi", attuali, { onlyIfMatch: letto.etag })
        : await store.setJSON("alloggi", attuali, { onlyIfNew: true });
      if (esito.modified) return Response.json(attuali, { headers });
    }
    return new Response("Salvataggio concorrente, riprovare", { status: 409, headers });
  }

  return new Response("Metodo non consentito", { status: 405 });
};

export const config = { path: "/api/dati" };
