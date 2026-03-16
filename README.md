# worker-gateway

用于订阅代理与混淆的 Cloudflare Worker。

## 行为说明

- 客户端订阅入口（推荐）：`https://<worker-domain>/json/{id}/{kind}`
- 从路径段 `{id}` 读取订阅 ID
- `{kind}` 为可选路径段，仅用于混淆，不参与源站转发
- 订阅 ID 校验规则：`^[a-f0-9]{32}$`
- 转发到源站：`${ORIGIN_BASE}${ORIGIN_SUB_PATH_PREFIX}/{id}`
- 仅当请求为 `POST` 且请求头包含 `X-Sub-ID`（或 `sub_id`）时，追加 `?envelope=1`
- 源站响应体透传，不做内容改写
- 不在全局变量中保存请求级 ID 或响应内容

## 安全控制

- 仅允许 `GET` 与 `POST`
- 启用 User-Agent 白名单：
  - Clash
  - Shadowrocket
  - Sing-box
  - Hiddify
  - V2RayN
  - V2RayNG
- `GET` 请求中路径 ID 无效时返回 `404`
- 保留兼容路径：`POST` + `X-Sub-ID`
- 源站请求失败返回 `502`

## 多 Worker 部署

1. 安装 Wrangler

```bash
npm install -g wrangler
```

2. 登录 Cloudflare

```bash
wrangler login
```

3. 按域名分别部署 Worker

```bash
wrangler deploy -c wrangler.assets.toml
wrangler deploy -c wrangler.snapshot.toml
```

每个配置文件都有独立的 `name` 与 `routes`，可单独运维与回滚。

## 如何新增一个 Worker（示例：worker-snapshot）

目标：新增 `worker-snapshot`，绑定 `snapshot.hudie123.xyz`。

1. 在项目根目录新建 `wrangler.snapshot.toml`，内容如下：

```toml
name = "worker-snapshot"
main = "worker.js"
compatibility_date = "2026-03-15"
workers_dev = false

routes = [
  { pattern = "snapshot.hudie123.xyz/json/*", zone_name = "hudie123.xyz" }
]

[vars]
ROUTE_PREFIX = "/json"
ORIGIN_BASE = "https://hudie.an1688.com"
ORIGIN_SUB_PATH_PREFIX = "/json"
```

2. 执行部署命令：

```bash
wrangler deploy -c wrangler.snapshot.toml
```

3. 在 Cloudflare 控制台确认路由生效后，使用以下 URL 验证：

`https://snapshot.hudie123.xyz/json/<id>/book`

## 配置变量

- `ROUTE_PREFIX`：入口路径前缀，默认 `/json`
- `ORIGIN_BASE`：源站地址，默认 `https://hudie.an1688.com`
- `ORIGIN_SUB_PATH_PREFIX`：源站订阅前缀，默认 `/json`

## 源站加固（重要）

建议源站仅接受 Cloudflare 转发流量：

- 源站接入 Cloudflare 代理（橙云），尽量避免直接公网暴露
- 防火墙仅放行 Cloudflare IP 段：
  - https://www.cloudflare.com/ips-v4
  - https://www.cloudflare.com/ips-v6
- 若使用 Nginx/Apache，仅信任 Cloudflare 回源真实 IP 头
- 可选：增加 mTLS、Cloudflare Tunnel 或私网链路等二次认证

### 代码层改造方案（可直接落地）

1. Nginx 仅允许 Cloudflare 网段访问订阅入口，拒绝其他来源：

```nginx
location ~ ^/json/[a-f0-9]{32}(/[\w-]+)?$ {
    allow 173.245.48.0/20;
    allow 103.21.244.0/22;
    allow 103.22.200.0/22;
    allow 103.31.4.0/22;
    allow 141.101.64.0/18;
    allow 108.162.192.0/18;
    allow 190.93.240.0/20;
    allow 188.114.96.0/20;
    allow 197.234.240.0/22;
    allow 198.41.128.0/17;
    allow 162.158.0.0/15;
    allow 104.16.0.0/13;
    allow 104.24.0.0/14;
    allow 172.64.0.0/13;
    allow 131.0.72.0/22;
    deny all;
}
```

2. 应用层校验 `CF-Connecting-IP` 与 `User-Agent`，非白名单直接 `403`。
3. 为 `/json/*` 增加限流（例如每 IP 每分钟 60 次）并记录审计日志。

## 可选的防扫与限流

建议在 Cloudflare 控制台配置（稳定性高于无状态边缘代码）：

- WAF 规则：仅允许 `GET`/`POST` 访问 `*/json/*`
- WAF 规则：拦截不在白名单内的 User-Agent
- 限流规则：对 `*/json/*` 做频率限制（例如每 IP 每分钟 60 次）
