// Cloudflare Pages Function — /api/prices
// Price matrix: { [installerId]: { [productId]: number } }
// GET returns it ({} when unset); PUT replaces it.
// Auth handled by functions/_middleware.js.

const KEY = 'prices';

function validate(prices) {
  if (!prices || typeof prices !== 'object' || Array.isArray(prices)) return 'invalid prices';
  for (const [installerId, row] of Object.entries(prices)) {
    if (!installerId) return 'invalid installer id';
    if (!row || typeof row !== 'object' || Array.isArray(row)) return 'invalid row for ' + installerId;
    for (const [productId, value] of Object.entries(row)) {
      if (!productId) return 'invalid product id';
      if (typeof value !== 'number' || !isFinite(value) || value < 0) return `invalid price ${installerId}/${productId}`;
    }
  }
  return null;
}

export async function onRequestGet({ env }) {
  const raw = await env.SCHEDULES_KV.get(KEY);
  let prices = {};
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) prices = parsed;
    } catch (e) {}
  }
  return Response.json({ prices });
}

export async function onRequestPut({ request, env }) {
  let body;
  try { body = await request.json(); }
  catch (e) { return new Response('Bad JSON', { status: 400 }); }
  const err = validate(body && body.prices);
  if (err) return new Response(err, { status: 400 });
  await env.SCHEDULES_KV.put(KEY, JSON.stringify(body.prices));
  return Response.json({ prices: body.prices });
}
