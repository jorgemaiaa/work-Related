// Cloudflare Pages Function — /api/installers
// GET: return the shared installer list (seeds defaults if KV is empty).
// POST: append a new installer, server-assigns the id.
// PUT: bulk replace (used by "Reset to defaults").

const KEY = 'installers';

// Kept in sync with DEFAULT_TECHNICIANS in index.html.
const DEFAULTS = [
  { id: 't_ev',    name: 'EV Chargers', origin: 'Almada', lat: 38.6803, lng: -9.1583, rate: 2,   color: '#16a34a' },
  { id: 't_norte', name: 'Q-CM Norte',  origin: 'Grijó',  lat: 41.0392, lng: -8.5728, rate: 0.4, color: '#1e3a8a' },
  { id: 't_sul',   name: 'Q-CM Sul',    origin: 'Lisboa', lat: 38.7223, lng: -9.1393, rate: 0.4, color: '#1e3a8a' },
  { id: 't_emob',  name: 'E-Mob',       origin: 'Porto',  lat: 41.1496, lng: -8.6109, rate: 0.4, color: '#38bdf8' },
];

async function readAll(env) {
  const raw = await env.SCHEDULES_KV.get(KEY);
  if (!raw) return DEFAULTS.slice();
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : DEFAULTS.slice();
  } catch (e) {
    return DEFAULTS.slice();
  }
}
async function writeAll(env, list) {
  await env.SCHEDULES_KV.put(KEY, JSON.stringify(list));
}
function validate(body) {
  if (!body || typeof body !== 'object') return 'invalid body';
  if (typeof body.name !== 'string' || !body.name) return 'invalid name';
  if (typeof body.origin !== 'string' || !body.origin) return 'invalid origin';
  if (typeof body.rate !== 'number' || !isFinite(body.rate) || body.rate < 0) return 'invalid rate';
  if (typeof body.color !== 'string' || !body.color) return 'invalid color';
  if (typeof body.lat !== 'number' || !isFinite(body.lat)) return 'invalid lat';
  if (typeof body.lng !== 'number' || !isFinite(body.lng)) return 'invalid lng';
  return null;
}
function newId() {
  return 't_' + crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}

export async function onRequestGet({ env }) {
  const installers = await readAll(env);
  return Response.json({ installers });
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); }
  catch (e) { return new Response('Bad JSON', { status: 400 }); }
  const err = validate(body);
  if (err) return new Response(err, { status: 400 });
  const installer = {
    id: newId(),
    name: body.name,
    origin: body.origin,
    rate: body.rate,
    color: body.color,
    lat: body.lat,
    lng: body.lng,
  };
  const list = await readAll(env);
  list.push(installer);
  await writeAll(env, list);
  return Response.json({ installer }, { status: 201 });
}

export async function onRequestPut({ request, env }) {
  let body;
  try { body = await request.json(); }
  catch (e) { return new Response('Bad JSON', { status: 400 }); }
  if (!Array.isArray(body.installers)) return new Response('invalid installers', { status: 400 });
  for (const it of body.installers) {
    const err = validate(it);
    if (err) return new Response(err, { status: 400 });
    if (typeof it.id !== 'string' || !it.id) return new Response('invalid id', { status: 400 });
  }
  await writeAll(env, body.installers);
  return Response.json({ installers: body.installers });
}
