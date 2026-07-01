// Cloudflare Pages Function — /api/installers/:id
// PATCH (partial update) and DELETE one installer.

const KEY = 'installers';

async function readAll(env) {
  const raw = await env.SCHEDULES_KV.get(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) { return []; }
}
async function writeAll(env, list) {
  await env.SCHEDULES_KV.put(KEY, JSON.stringify(list));
}

export async function onRequestPatch({ request, env, params }) {
  const id = params.id;
  let body;
  try { body = await request.json(); }
  catch (e) { return new Response('Bad JSON', { status: 400 }); }
  const list = await readAll(env);
  const idx = list.findIndex(x => x.id === id);
  if (idx < 0) return new Response('Not found', { status: 404 });
  const next = { ...list[idx] };
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name) return new Response('invalid name', { status: 400 });
    next.name = body.name;
  }
  if (body.origin !== undefined) {
    if (typeof body.origin !== 'string' || !body.origin) return new Response('invalid origin', { status: 400 });
    next.origin = body.origin;
  }
  if (body.rate !== undefined) {
    if (typeof body.rate !== 'number' || !isFinite(body.rate) || body.rate < 0) return new Response('invalid rate', { status: 400 });
    next.rate = body.rate;
  }
  if (body.color !== undefined) {
    if (typeof body.color !== 'string' || !body.color) return new Response('invalid color', { status: 400 });
    next.color = body.color;
  }
  if (body.lat !== undefined) {
    if (typeof body.lat !== 'number' || !isFinite(body.lat)) return new Response('invalid lat', { status: 400 });
    next.lat = body.lat;
  }
  if (body.lng !== undefined) {
    if (typeof body.lng !== 'number' || !isFinite(body.lng)) return new Response('invalid lng', { status: 400 });
    next.lng = body.lng;
  }
  list[idx] = next;
  await writeAll(env, list);
  return Response.json({ installer: next });
}

export async function onRequestDelete({ env, params }) {
  const id = params.id;
  const list = await readAll(env);
  const idx = list.findIndex(x => x.id === id);
  if (idx < 0) return new Response('Not found', { status: 404 });
  list.splice(idx, 1);
  await writeAll(env, list);
  return new Response(null, { status: 204 });
}
