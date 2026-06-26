// Cloudflare Pages Function — POST /api/auth (login), DELETE /api/auth (logout)
//
// Login: { password: "..." } → on success, sets the agenda_session cookie.
// Rate limit: failed attempts per IP are counted in KV with a short TTL.

import { signSession, sessionCookie, clearSessionCookie } from './_middleware.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const RL_WINDOW_SECONDS = 60;
const RL_MAX_FAILS = 5;

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function onRequestPost({ request, env }) {
  if (!env.AGENDA_PASSWORD || !env.SESSION_SECRET) {
    return new Response(JSON.stringify({ error: 'server misconfigured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rlKey = `ratelimit:auth:${ip}`;

  if (env.SCHEDULES_KV) {
    const current = parseInt((await env.SCHEDULES_KV.get(rlKey)) || '0', 10);
    if (current >= RL_MAX_FAILS) {
      return new Response(JSON.stringify({ error: 'too many attempts, try again in a minute' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  let body;
  try { body = await request.json(); }
  catch (e) { return new Response(JSON.stringify({ error: 'bad json' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const password = typeof body.password === 'string' ? body.password : '';
  if (!constantTimeEqual(password, env.AGENDA_PASSWORD)) {
    if (env.SCHEDULES_KV) {
      const current = parseInt((await env.SCHEDULES_KV.get(rlKey)) || '0', 10);
      await env.SCHEDULES_KV.put(rlKey, String(current + 1), { expirationTtl: RL_WINDOW_SECONDS });
    }
    return new Response(JSON.stringify({ error: 'invalid password' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const token = await signSession(SESSION_TTL_MS, env.SESSION_SECRET);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': sessionCookie(token, SESSION_TTL_MS),
    },
  });
}

export async function onRequestDelete() {
  return new Response(null, {
    status: 204,
    headers: { 'Set-Cookie': clearSessionCookie() },
  });
}
