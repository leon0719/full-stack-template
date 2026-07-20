# Cloudflare Tunnel 部署指南

透過 Cloudflare Tunnel 把已部署的 prod stack 對外公開。這是本模板內建的對外方式
（`docker-compose.prod.yml` 已含 `cloudflared` service）。

## 架構

```
Client ──HTTPS──▶ Cloudflare edge ──tunnel──▶ cloudflared 容器 ──▶ http://api:8000
                  (TLS 終止於此)              (主動向外連線)       (compose 內部網路)
```

選這條路的理由（相對於自架 nginx/Caddy 反代）：

- **主機不需開放任何 inbound port**（80/443/8000 都不用）——cloudflared 是向外連到
  Cloudflare，防火牆可以全關。
- **不用管 TLS 憑證**——edge 憑證由 Cloudflare 自動簽發與續期。
- **少一個反代元件**——不用裝設定 nginx/Caddy，failure mode 更少。

取捨：對外可用性綁在 Cloudflare 上。單機 docker compose 規模下這是划算的交換。

## 前置需求

- 網域已加入 Cloudflare（NS 已指向 Cloudflare）。
- `.env.prod` 其他必填欄位已設定（完整變數表見 [deployment.md](deployment.md)），
  `make prod-up` 可正常啟動。

## 步驟一：Cloudflare 端 —— 建立 Tunnel

1. 進入 [Zero Trust dashboard](https://one.dash.cloudflare.com) →
   **Networks → Tunnels** → **Create a tunnel** → 選 **Cloudflared**。
2. 命名（例如 `django-api`）→ Save。
3. 安裝方式選 **Docker**，複製指令中 `--token` 後面那串（`eyJ` 開頭）——
   **只需要 token 值**，不用照它的指令跑（compose 已定義好 service）。
4. **Published application routes** 分頁（舊版 UI 稱 Public Hostname）→
   **Add a published application route**：
   - **Subdomain / Domain**：例如 `api` / `your-domain.com`
   - **Service**：Type 選 `HTTP`，URL 填 `api:8000`
     （`api` 是 compose service 名稱——cloudflared 和 api 在同一個 compose
     網路，直接用服務名解析，連 `127.0.0.1:8000` 的 port mapping 都不經過）
5. 儲存後 Cloudflare 會自動建立該 hostname 的 proxied DNS 記錄（橘雲 CNAME），
   不用手動加 DNS。

## 步驟二：專案端 —— `.env.prod`

```bash
# Tunnel token（步驟一第 3 點複製的值）
TUNNEL_TOKEN=eyJ...

# API 對外域名
ALLOWED_HOSTS=api.your-domain.com
CSRF_TRUSTED_ORIGINS=https://api.your-domain.com

# cloudflared 從 compose bridge 網段連進 api 容器（.env.prod.example 預設值即是）
FORWARDED_ALLOW_IPS=172.16.0.0/12

# NINJA_NUM_PROXIES 維持預設 1，不用設：
# 客戶端真實 IP 由 Cloudflare edge 附加在 X-Forwarded-For 最右側，
# cloudflared 不會再加一跳，所以信任 1 層即正確。
```

然後：

```bash
make prod-up
```

## 步驟三：驗證

1. **Tunnel 狀態**：dashboard 的 Tunnels 列表應顯示 **HEALTHY**；
   本機看 `docker compose -f docker/docker-compose.prod.yml logs cloudflared`，
   應有 `Registered tunnel connection` 字樣。
2. **端到端**：

   ```bash
   curl -i https://api.your-domain.com/health/live   # 應為 200
   ```

3. **真實 client IP（重要，per-IP 節流靠它）**：`make prod-logs` 看 api 的
   access log，來源 IP 應是你的真實對外 IP，而**不是** `172.x.x.x`。
   如果看到 172 開頭，表示 `FORWARDED_ALLOW_IPS` 沒涵蓋 bridge 網段，
   `/auth/login`、`/auth/register` 的 per-IP 節流會把所有人算成同一個 IP。

## 步驟四：建議的 Cloudflare 加固設定

| 位置 | 設定 | 說明 |
| --- | --- | --- |
| SSL/TLS → Edge Certificates | **Always Use HTTPS: On** | http 一律 301 到 https |
| SSL/TLS → Overview | **Full (strict)** | Tunnel 本身不受此影響，但避免同 zone 其他記錄意外降級 |
| Security → WAF | Managed rules 維持開啟 | 免費版即可，不需特別調 |

### 保護 `/admin/`（建議）

`/admin/` 沒有 rate limit（`.env.prod.example` 內有註記），用 **Zero Trust Access**
在它前面加一層登入牆，免費方案就有：

1. Zero Trust dashboard → **Access → Applications** → **Add an application** →
   **Self-hosted**。
2. Application domain 填 `api.your-domain.com`，Path 填 `admin`。
3. 建一條 **Allow** policy，例如 Include → Emails 填你的信箱
   （登入時 Cloudflare 會寄 one-time PIN），或 Include → IP ranges 限公司 IP。

之後存取 `/admin/` 會先經過 Cloudflare 的驗證頁，API 路徑（`/auth/*`、
`/articles/*` 等）不受影響。

## 疑難排解

| 症狀 | 常見原因 | 處理 |
| --- | --- | --- |
| cloudflared 啟動即退出 | `TUNNEL_TOKEN` 未設或貼錯 | 確認 `.env.prod` 的 token；`make prod-logs` 看錯誤訊息 |
| 502 Bad Gateway | Published application route 的 Service URL 錯 | 應為 `HTTP://api:8000`（compose service 名，不是 localhost）；並確認 api 容器 healthy |
| 400 Bad Request (DisallowedHost) | `ALLOWED_HOSTS` 沒含對外域名 | 加上 `api.your-domain.com` 後重啟 |
| admin 登入 403 CSRF | `CSRF_TRUSTED_ORIGINS` 沒設 | 填 `https://api.your-domain.com` |
| access log 全是 172.x IP | `FORWARDED_ALLOW_IPS` 沒涵蓋 bridge 網段 | 設為 `172.16.0.0/12`（見步驟三第 3 點） |

## 不使用 Cloudflare Tunnel 時

1. 刪除 `docker-compose.prod.yml` 的 `cloudflared` service。
2. `.env.prod` 移除 `TUNNEL_TOKEN`。
3. 自架反代（nginx/Caddy）指向 `127.0.0.1:8000`，並依 `.env.prod.example` 的說明
   重設 `FORWARDED_ALLOW_IPS`；若反代前面還有 CDN/LB，`NINJA_NUM_PROXIES` 每多一層
   +1。
4. （若原本已建立）到 dashboard 刪除 tunnel 與對應 DNS 記錄。
