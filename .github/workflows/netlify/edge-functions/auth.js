// Site-wide HTTP Basic Auth — protects every route, including leads-data.js,
// so the skip-traced PII is never served to anonymous visitors.
//
// ACTIVATION (do this in Netlify, not in code):
//   Site settings -> Environment variables -> add:
//     SITE_PASSWORD = <a strong password>      (required to arm the lock)
//     SITE_USER     = <username>               (optional, defaults to "admin")
//
// Until SITE_PASSWORD is set, the site stays open so your first deploy can't
// lock you out. SET IT IMMEDIATELY after deploying — that's what closes the
// public PII exposure.
export default async (request, context) => {
  const USER = Netlify.env.get('SITE_USER') || 'admin';
  const PASS = Netlify.env.get('SITE_PASSWORD');
  if (!PASS) return context.next();               // not configured yet -> open (set the env var!)

  const header = request.headers.get('authorization') || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    let decoded = '';
    try { decoded = atob(encoded); } catch (_) {}
    const i = decoded.indexOf(':');
    if (i > -1 && decoded.slice(0, i) === USER && decoded.slice(i + 1) === PASS) {
      return context.next();
    }
  }
  return new Response('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="UrthMapper", charset="UTF-8"' }
  });
};

export const config = { path: '/*' };
