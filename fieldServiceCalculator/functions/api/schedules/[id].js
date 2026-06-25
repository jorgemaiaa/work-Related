// Cloudflare Pages Function — /api/schedules/:id
// PATCH (partial update) and DELETE one record.

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

export async function onRequestPatch({ request, env, params }) {
  const email = getEmail(request);
  if (!email) return unauthorized();
  const id = params.id;
  let body;
  try { body = await request.json(); }
  catch (e) { return new Response('Bad JSON', { status: 400 }); }
  const records = await readAll(env);
  const idx = records.findIndex(r => r.id === id);
  if (idx < 0) return new Response('Not found', { status: 404 });
  const next = { ...records[idx] };
  if (body.type !== undefined) {
    if (!TYPES.includes(body.type)) return new Response('invalid type', { status: 400 });
    next.type = body.type;
  }
  if (body.installerId !== undefined) {
    if (typeof body.installerId !== 'string' || !body.installerId) return new Response('invalid installerId', { status: 400 });
    next.installerId = body.installerId;
  }
  if (body.datetime !== undefined) {
    if (typeof body.datetime !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(body.datetime)) {
      return new Response('invalid datetime', { status: 400 });
    }
    next.datetime = body.datetime;
  }
  if (body.reference !== undefined) next.reference = String(body.reference || '');
  if (body.link !== undefined) next.link = String(body.link || '');
  next.updatedAt = new Date().toISOString();
  next.updatedBy = email;
  records[idx] = next;
  await writeAll(env, records);
  return Response.json({ record: next });
}

export async function onRequestDelete({ request, env, params }) {
  if (!getEmail(request)) return unauthorized();
  const id = params.id;
  const records = await readAll(env);
  const idx = records.findIndex(r => r.id === id);
  if (idx < 0) return new Response('Not found', { status: 404 });
  records.splice(idx, 1);
  await writeAll(env, records);
  return new Response(null, { status: 204 });
}
