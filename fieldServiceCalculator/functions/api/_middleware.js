// Cloudflare Pages Function middleware — runs for every /api/* request.
//
// Gates everything except /api/auth behind a session cookie that's set by
// /api/auth on successful login. Cookie is HMAC-signed; the signing secret
// is in env.SESSION_SECRET. The shared password is env.AGENDA_PASSWORD.

const COOKIE_NAME = 'agenda_session';

function b64urlEncode(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return b64urlEncode(new Uint8Array(sig));
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function parseCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

export async function verifySession(token, secret) {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot < 0) return false;
  const expiryStr = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expiry = parseInt(expiryStr, 10);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false;
  const expected = await hmac(expiryStr, secret);
  return constantTimeEqual(sig, expected);
}

export async function signSession(ttlMs, secret) {
  const expiry = String(Date.now() + ttlMs);
  const sig = await hmac(expiry, secret);
  return `${expiry}.${sig}`;
}

export function sessionCookie(token, ttlMs) {
  const maxAge = Math.floor(ttlMs / 1000);
  return `${COOKIE_NAME}=${token}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Lax`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`;
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // Auth endpoints are public (login + logout don't need a session).
  if (url.pathname === '/api/auth' || url.pathname.startsWith('/api/auth/')) {
    return next();
  }

  if (!env.SESSION_SECRET || !env.AGENDA_PASSWORD) {
    return new Response(JSON.stringify({ error: 'server misconfigured (missing env vars)' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const token = parseCookie(request.headers.get('Cookie'), COOKIE_NAME);
  if (await verifySession(token, env.SESSION_SECRET)) {
    return next();
  }
  return new Response(JSON.stringify({ error: 'auth required' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
