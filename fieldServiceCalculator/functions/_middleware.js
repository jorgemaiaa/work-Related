// Cloudflare Pages Function middleware — runs for every request.
//
// Access rule: the app only opens inside Zoho CRM (Web Tab). No password.
//
// Browsers label every request with Sec-Fetch-* headers. Opening the URL
// directly is a top-level navigation (Sec-Fetch-Dest: document) → refused.
// Framed loads are allowed, and the CSP frame-ancestors header makes the
// browser render the app only when the framing page is on a Zoho domain.
//
// This stops normal browsing outside Zoho. It is NOT authentication:
// non-browser clients (curl, scripts) can send any headers they like.
//
// Env vars (optional, set in the Pages dashboard):
//   ALLOW_DIRECT_ACCESS — "true" turns the rule off (app opens anywhere).
//   FRAME_ANCESTORS     — who may embed the app; default below.

const DEFAULT_FRAME_ANCESTORS = 'https://*.zoho.eu https://*.zoho.com';

function isTruthy(v) { return /^(1|true|yes|on)$/i.test(String(v || '').trim()); }

function blockedResponse(isApi) {
  if (isApi) {
    return new Response(JSON.stringify({ error: 'zoho only' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(`<!DOCTYPE html>
<html lang="pt"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Acesso restrito</title>
<style>body{font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f6f7f9;color:#1f2530;display:grid;place-items:center;height:100vh;margin:0}
.box{background:#fff;padding:24px;border-radius:10px;box-shadow:0 4px 12px rgba(0,0,0,.08);max-width:340px}h1{font-size:17px;margin:0 0 6px}p{color:#6b7280;margin:0;font-size:13px}</style>
</head><body><div class="box"><h1>🔒 Acesso restrito</h1><p>Esta aplicação só está disponível dentro do Zoho CRM.</p></div></body></html>`, {
    status: 403,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export async function onRequest(context) {
  const { request, env, next } = context;
  if (isTruthy(env.ALLOW_DIRECT_ACCESS)) return next();

  const site = request.headers.get('Sec-Fetch-Site');
  const dest = request.headers.get('Sec-Fetch-Dest');
  if (!site || dest === 'document') {
    return blockedResponse(new URL(request.url).pathname.startsWith('/api/'));
  }
  const res = await next();
  const out = new Response(res.body, res);
  out.headers.set('Content-Security-Policy', `frame-ancestors ${env.FRAME_ANCESTORS || DEFAULT_FRAME_ANCESTORS}`);
  return out;
}
