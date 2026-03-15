# worker-gateway

Cloudflare Worker for subscription proxy/obfuscation.

## Behavior

- Client endpoint: `https://assets.an1688.com/json/*`
- Reads subscription ID from request header: `X-Sub-ID`
- Validates ID with regex: `^[a-f0-9]{32}$`
- Forwards to origin: `https://hudie.an1688.com/s/{id}`
- Streams origin response body directly without transformation
- Does not store request-specific ID/response in global variables

## Security controls

- Only `POST` is allowed; all other methods return `404`
- UA whitelist is enforced:
  - Clash
  - Shadowrocket
  - Sing-box
  - Hiddify
  - V2RayN
  - V2RayNG
- Invalid/missing `X-Sub-ID` returns `403`
- Origin fetch network failure returns `502`

## Deploy

1. Install Wrangler

```bash
npm install -g wrangler
```

2. Login

```bash
wrangler login
```

3. Publish

```bash
wrangler deploy
```

4. Confirm route binding in `wrangler.toml`

```toml
routes = [
  { pattern = "assets.an1688.com/json*", zone_name = "an1688.com" }
]
```

## Origin hardening (important)

To ensure origin only accepts traffic from Cloudflare:

- Put origin behind Cloudflare proxy (orange cloud) and disable direct public exposure if possible.
- Restrict origin firewall to Cloudflare IP ranges only:
  - https://www.cloudflare.com/ips-v4
  - https://www.cloudflare.com/ips-v6
- If origin is Nginx/Apache, trust only Cloudflare real IP headers and deny unknown upstreams.
- Optionally add origin auth (e.g., mTLS, private network, Cloudflare Tunnel) for stronger protection.

## Optional anti-scan/rate-limit

Recommended to configure in Cloudflare dashboard (more reliable than stateless edge code):

- WAF custom rule: only allow `POST` and require header `X-Sub-ID`
- WAF custom rule: block non-whitelisted User-Agent patterns
- Rate Limiting rule on `assets.an1688.com/json*`
  - Example: `60 requests / minute / IP`
