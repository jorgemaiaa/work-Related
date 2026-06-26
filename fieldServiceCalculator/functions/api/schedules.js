// Cloudflare Pages Function — /api/schedules
//
// Auth is enforced by functions/api/_middleware.js (shared-password session
// cookie). If a request reaches here, it's already authenticated.

const KEY = 'all';
const TYPES = ['instalacao', 'visita', 'pos_venda'];

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

export async function onRequestGet({ env }) {
  const records = await readAll(env);
  return Response.json({ records });
}

export async function onRequestPost({ request, env }) {
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
  };
  const records = await readAll(env);
  records.push(record);
  await writeAll(env, records);
  return Response.json({ record }, { status: 201 });
}
