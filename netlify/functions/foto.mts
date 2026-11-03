import { getStore } from '@netlify/blobs'
import type { Config } from '@netlify/functions'

// API foto condivise tra smartphone e versione web.
// Chiave blob: "<alloggio>/<timestamp>-<id>" (alloggio = "civico-interno", codificato per URL)
//   GET    /api/foto                      -> { foto: { "<alloggio>": [id, ...] } }
//   GET    /api/foto?alloggio=K           -> { foto: [{ id, data }] }
//   GET    /api/foto?alloggio=K&id=U      -> immagine JPEG
//   PUT    /api/foto?alloggio=K&id=U&data=T  (body: JPEG)
//   DELETE /api/foto?alloggio=K&id=U

const ID_VALIDO = /^[A-Za-z0-9-]{8,64}$/
const MAX_BYTE = 5 * 1024 * 1024

const store = () => getStore({ name: 'foto-alloggi', consistency: 'strong' })

const prefisso = (alloggio: string) => encodeURIComponent(alloggio) + '/'

const parseChiave = (key: string) => {
  const [alloggio, file] = key.split('/')
  const sep = file ? file.indexOf('-') : -1
  if (sep < 0) return null
  return { alloggio: decodeURIComponent(alloggio), data: Number(file.slice(0, sep)), id: file.slice(sep + 1) }
}

const trovaChiave = async (alloggio: string, id: string) => {
  const { blobs } = await store().list({ prefix: prefisso(alloggio) })
  return blobs.find(b => parseChiave(b.key)?.id === id)?.key
}

export default async (req: Request) => {
  const url = new URL(req.url)
  const alloggio = url.searchParams.get('alloggio') || ''
  const id = url.searchParams.get('id') || ''
  const noCache = { 'Cache-Control': 'no-store' }

  if (alloggio.length > 100) return new Response('Alloggio non valido', { status: 400 })
  if (id && !ID_VALIDO.test(id)) return new Response('Id non valido', { status: 400 })

  if (req.method === 'GET' && !alloggio) {
    const { blobs } = await store().list()
    const foto: Record<string, string[]> = {}
    for (const b of blobs) {
      const p = parseChiave(b.key)
      if (p) (foto[p.alloggio] ||= []).push(p.id)
    }
    return Response.json({ foto }, { headers: noCache })
  }

  if (!alloggio) return new Response('Parametro alloggio mancante', { status: 400 })

  if (req.method === 'GET' && !id) {
    const { blobs } = await store().list({ prefix: prefisso(alloggio) })
    const foto = blobs
      .map(b => parseChiave(b.key))
      .filter(p => p !== null)
      .map(p => ({ id: p.id, data: p.data }))
      .sort((a, b) => a.data - b.data)
    return Response.json({ foto }, { headers: noCache })
  }

  if (!id) return new Response('Parametro id mancante', { status: 400 })

  if (req.method === 'GET') {
    const key = await trovaChiave(alloggio, id)
    const dati = key ? await store().get(key, { type: 'arrayBuffer' }) : null
    if (!dati) return new Response('Foto non trovata', { status: 404, headers: noCache })
    return new Response(dati, {
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=31536000, immutable' }
    })
  }

  if (req.method === 'PUT') {
    const dati = await req.arrayBuffer()
    if (!dati.byteLength) return new Response('Foto vuota', { status: 400 })
    if (dati.byteLength > MAX_BYTE) return new Response('Foto troppo grande', { status: 413 })
    const data = Number(url.searchParams.get('data')) || Date.now()
    const esistente = await trovaChiave(alloggio, id)
    if (!esistente) await store().set(prefisso(alloggio) + data + '-' + id, dati)
    return Response.json({ ok: true, id, data }, { headers: noCache })
  }

  if (req.method === 'DELETE') {
    const key = await trovaChiave(alloggio, id)
    if (key) await store().delete(key)
    return Response.json({ ok: true }, { headers: noCache })
  }

  return new Response('Metodo non consentito', { status: 405 })
}

export const config: Config = {
  path: '/api/foto'
}
