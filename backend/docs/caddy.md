# Caddy + Cloudflare 橘雲部署指南

透過內建的 Caddy service 把已部署的 prod stack 對外公開，前面再套 Cloudflare
proxy（橘雲）。這是本模板內建的對外方式（`docker-compose.prod.yml` 已含
`caddy` service，設定檔在 `docker/Caddyfile`）。

## 架構

```
訪客 ──HTTPS──▶ Cloudflare edge ──HTTPS──▶ Caddy 容器 (443) ──▶ http://api:8000
                (橘雲 proxy，                (tls internal        (compose 內部網路)
                 訪客端憑證由 CF 簽)          自簽憑證)
```

- **前半段 TLS**（訪客 ↔ Cloudflare）：Cloudflare 自動簽發與續期 edge 憑證。
- **後半段 TLS**（Cloudflare ↔ Caddy）：Caddy 用 `tls internal` 自簽憑證加密，
  搭配 Cloudflare SSL mode「**Full**」——Full 只要求後半段有加密、不驗證憑證
  來源，所以不需要 Let's Encrypt，也就沒有 ACME 的 DNS 驗證前置條件。
  - 取捨：Full（非 strict）理論上擋不住 Cloudflare↔源站之間的中間人。單機規模
    通常可接受；要更高保證時改裝 Cloudflare Origin CA 憑證並升級成
    「Full (strict)」。
- **真實 client IP**：Cloudflare 把訪客 IP 放進 `X-Forwarded-For`，Caddyfile 的
  `trusted_proxies`（Cloudflare IP 段）讓 Caddy 保留它並附加 edge IP 後轉給
  api；`NINJA_NUM_PROXIES=2` 對應這兩層，per-IP 節流才拿得到真實來源。

橘雲帶來的好處：源站 IP 不公開、免費 WAF/DDoS 緩解、edge 憑證全自動。
代價：對外可用性綁在 Cloudflare 上。

## 前置需求

- 網域已加入 Cloudflare（NS 指向 Cloudflare）。
- 主機防火牆／雲端 security group 開放 inbound **443**（80 選開——只有想讓
  Cloudflare 走 HTTP 回源除錯時才用得到）。可進一步只允許
  [Cloudflare IP 段](https://www.cloudflare.com/ips/) 連入，源站就完全不受
  直接掃描。
- `.env.prod` 其他必填欄位已設定（完整變數表見 [deployment.md](deployment.md)），
  `make prod-up` 可正常啟動。

## 步驟一：Cloudflare 端

1. **DNS**：新增 A record（例如 `api`）指向主機 IP，**Proxy status 開橘雲**。
2. **SSL/TLS → Overview**：encryption mode 設 **Full**。
   （不要用 Flexible——後半段會變明文 HTTP；也先不用 Full (strict)——那需要
   Origin CA 憑證。）
3. **SSL/TLS → Edge Certificates**：**Always Use HTTPS: On**（http 一律 301）。

## 步驟二：專案端 —— `.env.prod`

```bash
# API 對外域名
DOMAIN=api.your-domain.com

# Django 端也要認得同一個域名
ALLOWED_HOSTS=api.your-domain.com
CSRF_TRUSTED_ORIGINS=https://api.your-domain.com

# caddy 從 compose bridge 網段連進 api 容器（.env.prod.example 預設值即是）
FORWARDED_ALLOW_IPS=172.16.0.0/12

# 反代層數：Cloudflare edge + Caddy 共 2 層（.env.prod.example 已設）
NINJA_NUM_PROXIES=2
```

然後：

```bash
make prod-up
```

## 步驟三：驗證

1. **端到端**：

   ```bash
   curl -i https://api.your-domain.com/health/live   # 應為 200
   curl -i http://api.your-domain.com/health/live    # 應為 301 → https
   ```

2. **後半段確實加密**：Cloudflare dashboard SSL/TLS mode 顯示 Full，且
   `docker compose -f docker/docker-compose.prod.yml logs caddy` 沒有 TLS
   handshake 錯誤。

3. **真實 client IP（重要，per-IP 節流靠它）**：打一個會留 log 的端點
   （例如故意輸錯密碼的 `POST /auth/login`），`make prod-logs` 看 api 的
   warning log 內的 client IP，應是你的真實對外 IP，而**不是** Cloudflare 的
   IP（104.x／172.6x 等）也不是 `172.1x` bridge IP。看到 Cloudflare IP 表示
   `NINJA_NUM_PROXIES` 不是 2 或 Caddyfile 的 `trusted_proxies` 沒生效。

## 保護 `/admin/`（建議）

`/admin/` 沒有 rate limit（`.env.prod.example` 內有註記）。兩個選項擇一：

**選項 A —— Caddyfile IP allowlist**（有固定 IP 時最簡單）：
`docker/Caddyfile` 內已附註解掉的範例，取消註解並換成你的 IP/CIDR：

```caddyfile
@admin_blocked {
	path /admin/*
	not client_ip 203.0.113.0/24   # 換成你的固定 IP/CIDR
}
respond @admin_blocked 403
```

注意用的是 `client_ip`（經 `trusted_proxies` 解析的真實來源），不是
`remote_ip`——橘雲之後 remote_ip 永遠是 Cloudflare edge 的 IP。改完
`make prod-up` 重啟即生效。

**選項 B —— Cloudflare Zero Trust Access**（沒有固定 IP 時）：
Zero Trust dashboard → Access → Applications → Add an application →
Self-hosted，domain 填 `api.your-domain.com`、path 填 `admin`，建一條
Allow policy（如 Include → Emails 填自己的信箱，登入走 one-time PIN）。
免費方案即可。

兩者都不影響 API 路徑（`/auth/*`、`/articles/*` 等）。

## 疑難排解

| 症狀 | 常見原因 | 處理 |
| --- | --- | --- |
| caddy 啟動即退出 | `DOMAIN` 未設或格式錯 | 確認 `.env.prod` 的 `DOMAIN`；`make prod-logs` 看錯誤訊息 |
| 521/522（Cloudflare 錯誤頁） | 主機 443 未開、或 caddy 沒起來 | 防火牆開 443；`docker compose ps` 確認 caddy running |
| 525 SSL handshake failed | SSL mode 不是 Full、或 caddy 憑證異常 | Cloudflare SSL mode 設 Full；看 caddy logs |
| 526 Invalid SSL certificate | SSL mode 誤設 Full (strict) | 自簽憑證過不了 strict——改回 Full，或裝 Origin CA 憑證 |
| 502 Bad Gateway | api 容器不健康 | `make prod-logs` 看 api 是否啟動失敗（Settings 驗證錯誤會寫明原因） |
| 400 Bad Request (DisallowedHost) | `ALLOWED_HOSTS` 沒含對外域名 | 加上 `api.your-domain.com` 後重啟 |
| admin 登入 403 CSRF | `CSRF_TRUSTED_ORIGINS` 沒設 | 填 `https://api.your-domain.com` |
| api log 的 client IP 是 Cloudflare IP | `NINJA_NUM_PROXIES` 不是 2 或 `trusted_proxies` 沒生效 | 見步驟三第 3 點 |
| admin allowlist 擋不住人 | 範例用了 `remote_ip` | 改用 `client_ip` matcher |

## 不使用內建 Caddy 時

1. 刪除 `docker-compose.prod.yml` 的 `caddy` service（與檔尾 `caddy_data` /
   `caddy_config` volumes）。
2. `.env.prod` 移除 `DOMAIN`，並依新拓撲重算 `NINJA_NUM_PROXIES`。
3. 自架反代（nginx 等）指向 `127.0.0.1:8000`，並依 `.env.prod.example` 的說明
   重設 `FORWARDED_ALLOW_IPS`。
