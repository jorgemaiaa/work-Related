// Cloudflare Pages Function middleware — gates the entire site.
//
// Every request that lands on Pages flows through here. If the visitor has
// a valid session cookie they continue to the real route (static file or
// API Function). Otherwise:
//   - /api/* → 401 JSON
//   - everything else → minimal login HTML page
//
// /api/auth (login + logout) is the one exception — it must be reachable
// without a session for the password exchange to happen.
//
// Env vars (set in Pages dashboard, encrypted):
//   AGENDA_PASSWORD  — shared team password (compared by /api/auth)
//   SESSION_SECRET   — long random string used to sign session cookies

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

function loginPage() {
  return `<!DOCTYPE html>
<html lang="pt">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Acesso protegido</title>
<style>
  body { font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         background: #f6f7f9; color: #1f2530;
         display: grid; place-items: center; height: 100vh; margin: 0; }
  .box { background: #fff; padding: 24px; border-radius: 10px;
         box-shadow: 0 4px 12px rgba(0,0,0,.08); width: 320px; }
  h1 { font-size: 17px; margin: 0 0 4px; }
  p  { color: #6b7280; margin: 0 0 14px; font-size: 13px; }
  input { width: 100%; padding: 9px 11px; border: 1px solid #e3e6eb;
          border-radius: 6px; font: inherit; box-sizing: border-box; }
  button { width: 100%; margin-top: 10px; padding: 9px;
           background: #2563eb; color: #fff; border: none;
           border-radius: 6px; font: inherit; cursor: pointer; }
  button:hover { background: #1d4ed8; }
  .err { color: #dc2626; font-size: 12px; min-height: 14px; margin-top: 6px; }
</style>
</head>
<body>
<div class="box">
  <h1>🔒 Acesso protegido</h1>
  <p>Introduz a palavra-passe para abrir a aplicação.</p>
  <form id="f">
    <input type="password" id="pwd" autocomplete="current-password" autofocus />
    <div class="err" id="err"></div>
    <button type="submit">Entrar</button>
  </form>
</div>
<script>
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pwd = document.getElementById('pwd').value;
  const err = document.getElementById('err');
  err.textContent = '';
  try {
    const r = await fetch('/api/auth', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd }),
    });
    if (r.ok) { location.reload(); return; }
    if (r.status === 429) { err.textContent = 'Demasiadas tentativas. Tenta dentro de 1 minuto.'; return; }
    err.textContent = 'Palavra-passe incorrecta.';
  } catch (e2) {
    err.textContent = 'Erro de rede: ' + e2.message;
  }
});
</script>
</body>
</html>`;
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // /api/auth (login + logout) is the only public endpoint.
  if (url.pathname === '/api/auth' || url.pathname.startsWith('/api/auth/')) {
    return next();
  }

  if (!env.SESSION_SECRET || !env.AGENDA_PASSWORD) {
    return new Response(
      'Server misconfigured: missing AGENDA_PASSWORD or SESSION_SECRET env vars.',
      { status: 500 },
    );
  }

  const token = parseCookie(request.headers.get('Cookie'), COOKIE_NAME);
  if (await verifySession(token, env.SESSION_SECRET)) {
    return next();
  }

  // Unauthenticated.
  if (url.pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'auth required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(loginPage(), {
    status: 401,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
