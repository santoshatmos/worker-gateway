const SUB_ID_HEADER = 'X-Sub-ID';
const SUB_ID_HEADER_ALT = 'sub_id';
const SUB_KIND_HEADER = 'X-Sub-Kind';
const SUB_KIND_HEADER_ALT = 'sub_kind';
const SUB_ID_RE = /^[a-z0-9_-]{3,128}$/i;
const KIND_RE = /^[a-z0-9-]{1,24}$/i;
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

function copyForwardHeaders(request) {
  const headers = new Headers();
  const authorization = request.headers.get('Authorization');
  if (authorization) {
    headers.set('Authorization', authorization);
  }
  headers.set('User-Agent', 'assets-gateway/2.0');
  headers.set('Accept', 'application/json, text/plain, */*');
  return headers;
}

function sanitizeProxyHeaders(upstream, canCache = false) {
  const headers = new Headers(upstream.headers);
  headers.delete('server');
  headers.delete('cf-ray');
  headers.delete('x-powered-by');
  headers.delete('via');
  if (canCache && upstream.ok) {
    headers.set('Cache-Control', 'public, max-age=60');
  } else {
    headers.set('Cache-Control', 'no-store');
  }
  return headers;
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
        continue;
      }
      preferredOriginBase = originBase;
      upstream = response;
      break;
    } catch (_) {
    }
  }

  if (!upstream) {
    if (fallback) {
      upstream = fallback;
    } else {
      return new Response('Bad Gateway', { status: 502 });
    }
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: sanitizeProxyHeaders(upstream, false),
  });
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

function normalizePrefix(rawPrefix) {
  const prefix = `/${String(rawPrefix || '/json')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')}`;
  return prefix === '/' ? '/json' : prefix;
}

function getOriginBase(env) {
  return getOriginBases(env)[0];
}

function getOriginSubPathPrefix(env) {
  return normalizePrefix(env.ORIGIN_SUB_PATH_PREFIX || '/json');
}

function getHeaderSubId(request) {
  const xSubId = (request.headers.get(SUB_ID_HEADER) || '').trim();
  if (SUB_ID_RE.test(xSubId)) {
    return xSubId;
  }

  const subId = (request.headers.get(SUB_ID_HEADER_ALT) || '').trim();
  if (SUB_ID_RE.test(subId)) {
    return subId;
  }

  return '';
}

function getHeaderSubKind(request) {
  const xSubKind = (request.headers.get(SUB_KIND_HEADER) || '').trim();
  if (KIND_RE.test(xSubKind)) {
    return xSubKind;
  }

  const subKind = (request.headers.get(SUB_KIND_HEADER_ALT) || '').trim();
  if (KIND_RE.test(subKind)) {
    return subKind;
  }

  return '';
}

function splitPath(pathname) {
  return String(pathname || '/')
    .replace(/\/+$/, '')
    .split('/')
    .filter(Boolean);
}

function extractSubIdFromPath(pathname, routePrefix) {
  const routeParts = splitPath(routePrefix);
  const pathParts = splitPath(pathname);

  if (pathParts.length < routeParts.length + 1) {
    return '';
  }

  for (let i = 0; i < routeParts.length; i += 1) {
    if (pathParts[i] !== routeParts[i]) {
      return '';
    }
  }

  const candidateId = (pathParts[routeParts.length] || '').trim();
  if (!SUB_ID_RE.test(candidateId)) {
    return '';
  }

  const kind = pathParts[routeParts.length + 1];
  if (kind && !KIND_RE.test(kind)) {
    return '';
  }

  return candidateId;
}

function extractAssetsSubIdFromPath(pathname) {
  const pathParts = splitPath(pathname);
  if (pathParts.length < 4) {
    return '';
  }

  if (pathParts[0] !== 'api' || pathParts[1] !== 'v1' || pathParts[2] !== 'assets') {
    return '';
  }

  const candidateId = (pathParts[3] || '').trim();
  if (!SUB_ID_RE.test(candidateId)) {
    return '';
  }

  return candidateId;
}

function isLegacyPrefixPath(pathname, routePrefix) {
  const normalizedPath = String(pathname || '/').replace(/\/+$/, '');
  return normalizedPath === routePrefix || normalizedPath.startsWith(`${routePrefix}/`);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const routePrefix = normalizePrefix(env.ROUTE_PREFIX || '/json');

    if (request.method === 'GET' && (url.pathname === '/api/v1/latest')) {
      return latestOriginResponse(env);
    }

    if (request.method === 'GET' && (url.pathname === '/api/v1/orderinfo')) {
      const ua = request.headers.get('User-Agent') || '';
      if (!isAllowedUa(ua)) {
        return forbidden('UA not allowed');
      }
      return proxyFirstHealthyJson(env, request, `/api/v1/user/getSubscribe${url.search || ''}`);
    }

    if (request.method !== 'GET' && request.method !== 'POST') {
      return notFound();
    }

    const path = url.pathname;
    let subId = extractAssetsSubIdFromPath(path) || extractSubIdFromPath(path, routePrefix);
    const headerSubId = getHeaderSubId(request);
    const headerSubKind = getHeaderSubKind(request);
    const isByteflyPost = request.method === 'POST' && headerSubId !== '';
    const isUnifiedAssetsGet = request.method === 'GET' && extractAssetsSubIdFromPath(path) !== '';
    const isUnifiedAssetsPost = request.method === 'POST' && (path === '/api/v1/assets' || extractAssetsSubIdFromPath(path) !== '') && headerSubId !== '';

    if (isUnifiedAssetsPost || isByteflyPost) {
      subId = headerSubId;
    } else if (!subId && isLegacyPrefixPath(path, routePrefix)) {
      subId = headerSubId;
    }

    if (!subId) {
      return request.method === 'GET' ? notFound() : forbidden('Invalid subscription id');
    }

    const ua = request.headers.get('User-Agent') || '';
    if (!isAllowedUa(ua)) {
      return forbidden('UA not allowed');
    }

    const originBases = getOriginBases(env);
    const originSubPathPrefix = getOriginSubPathPrefix(env);
    const cache = caches.default;
    const canCache = request.method === 'GET' && !isUnifiedAssetsGet;
    const cacheKey = request.url;

    if (canCache) {
      const cached = await cache.match(cacheKey);
      if (cached) {
        return cached;
      }
    }

    let upstream;
    let fallback;
    for (const originBase of originBases) {
      const originPath = `${originBase}${originSubPathPrefix}/${subId}`;
      const originUrl = (isUnifiedAssetsPost || isByteflyPost)
        ? `${originPath}?envelope=1`
        : originPath;
      try {
        const response = await fetch(originUrl, {
          method: 'GET',
          headers: {
            'User-Agent': 'assets-gateway/2.0',
            'Accept': '*/*',
            ...(headerSubKind ? { [SUB_KIND_HEADER]: headerSubKind } : {}),
          },
          cf: {
            cacheTtl: 0,
            cacheEverything: false,
          },
        });
        if (response.status >= 500) {
          fallback = fallback || response;
          continue;
        }
        preferredOriginBase = originBase;
        upstream = response;
        break;
      } catch (_) {
      }
    }

    if (!upstream) {
      if (fallback) {
        upstream = fallback;
      } else {
        return new Response('Bad Gateway', { status: 502 });
      }
    }

    const response = new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: sanitizeProxyHeaders(upstream, canCache),
    });

    if (canCache && upstream.ok) {
      const cacheResponse = response.clone();
      if (ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(cache.put(cacheKey, cacheResponse));
      }
    }

    return response;
  },
};
