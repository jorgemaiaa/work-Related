// Cloudflare Pages Function — /api/schedules
//
// Auth: trusts the `Cf-Access-Authenticated-User-Email` header injected by
// Cloudflare Access. This is safe ONLY when Access actually gates the
// /api/* route at the edge (configure that in the Access dashboard).
// If the route is unprotected, anyone can hit it; fail-closed if the
// header is missing.
//
// Storage: a single JSON blob in KV under the key "all".

const KEY = 'all';
const TYPES = ['instalacao', 'visita', 'pos_venda'];

function getEmail(request) {
  return request.headers.get('Cf-Access-Authenticated-User-Email');
}
function unauthorized() {
  return new Response(JSON.stringify({ error: 'auth required' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
async function readAll(env) {
  const raw = await env.SCHEDULES_KV.get(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}
async function writeAll(env, records) {
  await env.SCHEDULES_KV.put(KEY, JSON.stringify(records));
}
function validateNew(body) {
  if (!body || typeof body !== 'object') return 'invalid body';
  if (!TYPES.includes(body.type)) return 'invalid type';
  if (typeof body.installerId !== 'string' || !body.installerId) return 'invalid installerId';
  if (typeof body.datetime !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(body.datetime)) return 'invalid datetime';
  if (body.reference != null && typeof body.reference !== 'string') return 'invalid reference';
  if (body.client != null && typeof body.client !== 'string') return 'invalid client';
  if (body.protocol != null && typeof body.protocol !== 'string') return 'invalid protocol';
  if (body.link != null && typeof body.link !== 'string') return 'invalid link';
  return null;
}
function newId() {
  const uuid = crypto.randomUUID().replace(/-/g, '');
  return 'r_' + uuid.slice(0, 12);
}

export async function onRequestGet({ request, env }) {
  if (!getEmail(request)) return unauthorized();
  const records = await readAll(env);
  return Response.json({ records });
}

export async function onRequestPost({ request, env }) {
  const email = getEmail(request);
  if (!email) return unauthorized();
  let body;
  try { body = await request.json(); }
  catch (e) { return new Response('Bad JSON', { status: 400 }); }
  const err = validateNew(body);
  if (err) return new Response(err, { status: 400 });
  const now = new Date().toISOString();
  const record = {
    id: newId(),
    type: body.type,
    installerId: body.installerId,
    reference: typeof body.reference === 'string' ? body.reference : '',
    client: typeof body.client === 'string' ? body.client : '',
    protocol: typeof body.protocol === 'string' ? body.protocol : '',
    datetime: body.datetime,
    link: typeof body.link === 'string' ? body.link : '',
    createdAt: now,
    updatedAt: now,
    createdBy: email,
  };
  const records = await readAll(env);
  records.push(record);
  await writeAll(env, records);
  return Response.json({ record }, { status: 201 });
}
