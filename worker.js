/**
 * Cloudflare Worker: Subscription proxy/obfuscation gateway
 *
 * Requirements implemented:
 * - Only allow POST requests (others return 404)
 * - Route only handles /json/* (and /json)
 * - Read subscription ID from header: X-Sub-ID
 * - Validate ID format: /^[a-f0-9]{32}$/
 * - User-Agent whitelist check
 * - Build origin URL: https://hudie.an1688.com/s/{id}
 * - Fetch origin and stream response back without body transformation
 * - No global storage of request-specific ID or response
 * - Return 502 when origin fetch throws
 */

const ORIGIN_BASE = 'https://hudie.an1688.com';
const SUB_ID_HEADER = 'X-Sub-ID';
const SUB_ID_RE = /^[a-f0-9]{32}$/;

const UA_WHITELIST = [
  /clash/i,
  /shadowrocket/i,
  /sing[- ]?box/i,
  /hiddify/i,
  /v2rayn/i,
  /v2rayng/i,
];

function isAllowedUa(ua) {
  if (!ua) return false;
  return UA_WHITELIST.some((re) => re.test(ua));
}

function notFound() {
  return new Response('Not Found', { status: 404 });
}

function forbidden(message = 'Forbidden') {
  return new Response(message, { status: 403 });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1) Only POST is allowed
    if (request.method !== 'POST') {
      return notFound();
    }

    // 2) Only /json and /json/* are handled
    const path = url.pathname;
    if (!(path === '/json' || path === '/json/' || path.startsWith('/json/'))) {
      return notFound();
    }

    // 3) User-Agent whitelist
    const ua = request.headers.get('User-Agent') || '';
    if (!isAllowedUa(ua)) {
      return forbidden('UA not allowed');
    }

    // 4) Validate X-Sub-ID header
    const subId = (request.headers.get(SUB_ID_HEADER) || '').trim();
    if (!SUB_ID_RE.test(subId)) {
      return forbidden('Invalid X-Sub-ID');
    }

    // 5) Build origin URL. Ignore any extra path after /json/* by design.
    const originUrl = `${ORIGIN_BASE}/s/${subId}`;

    let upstream;
    try {
      upstream = await fetch(originUrl, {
        method: 'GET',
        headers: {
          // Keep a stable UA to origin; do not forward client custom headers unnecessarily.
          'User-Agent': 'assets-gateway/1.0',
          'Accept': '*/*',
        },
        cf: {
          cacheTtl: 0,
          cacheEverything: false,
        },
      });
    } catch (_) {
      // 6) Origin fetch failure -> 502
      return new Response('Bad Gateway', { status: 502 });
    }

    // 7) Stream origin response as-is (body untouched)
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: upstream.headers,
    });
  },
};
