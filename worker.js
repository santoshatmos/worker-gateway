const SUB_ID_HEADER = 'X-Sub-ID';
const SUB_KIND_HEADER = 'X-Sub-Kind';
const SUB_ID_RE = /^[a-z0-9_-]{3,128}$/i;
const KIND_RE = /^[a-z0-9-]{1,24}$/i;

const ASSETS_PATH = '/api/v1/assets';
const LATEST_PATH = '/api/v1/latest';
const ORDERINFO_PATH = '/api/v1/orderinfo';
const ORDERINFO_UPSTREAM_PATH = '/api/v1/orderinfo';

let preferredOriginBase = '';

const UA_WHITELIST = [
  /clash/i,
  /shadowrocket/i,
  /sing[- ]?box/i,
  /hiddify/i,
  /v2rayn/i,
  /v2rayng/i,
  /quantumult/i,
  /surge/i,
  /stash/i,
  /clash-meta/i,
  /bytefly/i,
  /curl/i,
  /mozilla/i,
];

function logInfo(event, payload = {}) {
  console.log(`[worker-gateway] ${event}`, JSON.stringify(payload));
}

function logWarn(event, payload = {}) {
  console.warn(`[worker-gateway] ${event}`, JSON.stringify(payload));
}

function maskSubId(subId) {
  if (!subId || subId.length <= 8) {
    return '***';
  }
  return `${subId.slice(0, 4)}***${subId.slice(-4)}`;
}

function normalizePath(pathname) {
  const normalized = String(pathname || '/').replace(/\/+$/, '');
  return normalized || '/';
}

function isAllowedUa(ua) {
  if (!ua) return false;
  return UA_WHITELIST.some((re) => re.test(ua));
}

function notFound() {
  return new Response('Not Found', {
    status: 404,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}

function forbidden(message = 'Forbidden') {
  return new Response(message, {
    status: 403,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}

function badGateway(message = 'Bad Gateway') {
  return new Response(message, {
    status: 502,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}

function sanitizeProxyHeaders(upstream) {
  const headers = new Headers(upstream.headers);
  headers.delete('server');
  headers.delete('cf-ray');
  headers.delete('x-powered-by');
  headers.delete('via');
  headers.set('Cache-Control', 'no-store');
  return headers;
}

function copyForwardHeaders(request) {
  const headers = new Headers();
  const authorization = request.headers.get('Authorization');
  if (authorization) {
    headers.set('Authorization', authorization);
  }
  headers.set('User-Agent', 'assets-gateway/3.0');
  headers.set('Accept', 'application/json, text/plain, */*');
  return headers;
}

function parseBaseUrls(raw) {
  return String(raw || '')
    .split(/[;,\n]/)
    .map((x) => x.trim().replace(/\/+$/, ''))
    .filter((x) => /^https?:\/\//i.test(x));
}

function getOriginBases(env) {
  const fromLatest = parseBaseUrls(env.LATEST_SOURCE_URLS || '');
  const fromOrigin = parseBaseUrls(env.ORIGIN_BASE || '');
  const dedup = [...new Set([...fromLatest, ...fromOrigin])];

  if (preferredOriginBase && dedup.includes(preferredOriginBase)) {
    return [preferredOriginBase, ...dedup.filter((x) => x !== preferredOriginBase)];
  }

  return dedup;
}

function latestOriginResponse(env) {
  const urls = getOriginBases(env);
  const payload = {
    latest: {
      url: urls.join('; '),
    },
  };

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
    },
  });
}

function getHeaderSubId(request) {
  const subId = (request.headers.get(SUB_ID_HEADER) || '').trim();
  if (!SUB_ID_RE.test(subId)) {
    return '';
  }
  return subId;
}

function getHeaderSubKind(request) {
  const raw = (request.headers.get(SUB_KIND_HEADER) || '').trim();
  if (!raw) {
    return 'agent';
  }
  if (!KIND_RE.test(raw)) {
    return '';
  }
  return raw;
}

async function proxyFirstHealthyJson(env, request, pathWithQuery) {
  const originBases = getOriginBases(env);
  let upstream;
  let fallback;

  for (const originBase of originBases) {
    const originUrl = `${originBase}${pathWithQuery}`;
    try {
      const response = await fetch(originUrl, {
        method: 'GET',
        headers: copyForwardHeaders(request),
        cf: {
          cacheTtl: 0,
          cacheEverything: false,
        },
      });

      if (response.status >= 500) {
        fallback = fallback || response;
        logWarn('orderinfo_origin_5xx', { originBase, status: response.status });
        continue;
      }

      preferredOriginBase = originBase;
      upstream = response;
      break;
    } catch (err) {
      logWarn('orderinfo_origin_error', {
        originBase,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (!upstream) {
    if (fallback) {
      upstream = fallback;
    } else {
      return badGateway();
    }
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: sanitizeProxyHeaders(upstream),
  });
}

async function proxyAssetsRequest(env, request, subId, subKind) {
  const originBases = getOriginBases(env);
  let upstream;
  let fallback;

  for (const originBase of originBases) {
    const originUrl = `${originBase}${ASSETS_PATH}`;
    const startAt = Date.now();

    try {
      const response = await fetch(originUrl, {
        method: 'POST',
        headers: {
          'User-Agent': 'assets-gateway/3.0',
          'Accept': 'application/json',
          [SUB_ID_HEADER]: subId,
          [SUB_KIND_HEADER]: subKind,
        },
        cf: {
          cacheTtl: 0,
          cacheEverything: false,
        },
      });

      const cost = Date.now() - startAt;
      logInfo('assets_upstream_result', {
        originBase,
        status: response.status,
        cost_ms: cost,
        sub_id: maskSubId(subId),
      });

      if (response.status >= 500) {
        fallback = fallback || response;
        continue;
      }

      preferredOriginBase = originBase;
      upstream = response;
      break;
    } catch (err) {
      logWarn('assets_upstream_error', {
        originBase,
        sub_id: maskSubId(subId),
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (!upstream) {
    if (fallback) {
      upstream = fallback;
    } else {
      return badGateway();
    }
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: sanitizeProxyHeaders(upstream),
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = normalizePath(url.pathname);

    if (request.method === 'GET' && path === LATEST_PATH) {
      return latestOriginResponse(env);
    }

    if (request.method === 'GET' && path === ORDERINFO_PATH) {
      const ua = request.headers.get('User-Agent') || '';
      if (!isAllowedUa(ua)) {
        logWarn('orderinfo_ua_rejected', { ua });
        return forbidden('UA not allowed');
      }
      return proxyFirstHealthyJson(env, request, `${ORDERINFO_UPSTREAM_PATH}${url.search || ''}`);
    }

    if (request.method === 'POST' && path === ASSETS_PATH) {
      if (url.search && url.search.length > 0) {
        logWarn('assets_query_rejected', { query: url.search });
        return forbidden('Query parameters are not supported');
      }

      const ua = request.headers.get('User-Agent') || '';
      if (!isAllowedUa(ua)) {
        logWarn('assets_ua_rejected', { ua });
        return forbidden('UA not allowed');
      }

      const subId = getHeaderSubId(request);
      if (!subId) {
        logWarn('assets_missing_sub_id');
        return forbidden('Invalid subscription id');
      }

      const subKind = getHeaderSubKind(request);
      if (!subKind) {
        logWarn('assets_invalid_sub_kind', { sub_id: maskSubId(subId) });
        return forbidden('Invalid subscription kind');
      }

      logInfo('assets_request_received', {
        sub_id: maskSubId(subId),
        sub_kind: subKind,
      });

      return proxyAssetsRequest(env, request, subId, subKind);
    }

    return notFound();
  },
};
