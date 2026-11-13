# 主機 nginx 反向代理（取代內建 Caddy）

模板預設用 compose 內建的 Caddy（[caddy.md](caddy.md)）。這份說明改用**主機上的 nginx**
時要做什麼；站台設定範例在 [`docker/nginx/api.conf`](../docker/nginx/api.conf)，CI 的
`nginx` job 會用 `nginx -t` 檢查它的語法。

## 什麼時候選哪個

| 情境 | 選擇 | 理由 |
| --- | --- | --- |
| 新主機、只跑這一個服務、前面有 Cloudflare 橘雲 | **Caddy**（預設） | 設定跟著 repo、隨 `make prod-up` 一起起來；`tls internal` 免申請憑證 |
| 想要 Let's Encrypt 自動續約、但不想自己管 certbot | **Caddy** | 把 `tls internal` 拿掉即自動 ACME |
| 主機上**已經有 nginx** 在服務其他站台（共用 80/443） | **nginx** | 兩個 process 不能同時綁 443；在既有 nginx 加一個 server block 比搬遷全部站台簡單 |
| 團隊維運慣例、監控、log 收集都圍繞 nginx | **nginx** | 少一種要學的東西 |
| 需要 nginx 特有功能（`limit_req`、`geo`、既有的 WAF 模組、`auth_request`） | **nginx** | |
| 公司 IT 只發 wildcard 憑證檔（Origin CA / 自家 CA），要和其他站台共用 | **nginx**（或 Caddy 指定檔案） | 兩者都行；已有 nginx 時直接共用路徑最省事 |

不確定就用 Caddy；**不要兩個都開**——對外只能有一層綁 443。

## 切換步驟

1. **停用 compose 內的 Caddy**：刪除 `docker/docker-compose.prod.yml` 的 `caddy` service 與檔尾的
   `caddy_data` / `caddy_config` volumes；`.env.prod` 的 `DOMAIN` 可刪。
2. **確認 api 只綁 loopback**：prod compose 已是 `127.0.0.1:8000:8000`。nginx 在**同一台主機**
   直接 `proxy_pass http://127.0.0.1:8000`。nginx 在別台時要改綁私網 IP，並用防火牆擋掉
   公網對 8000 的存取——能直連 uvicorn 的人可以偽造 `X-Forwarded-*`。
3. **安裝站台設定**（需要 sudo，不放進 CD）：

   ```bash
   sudo cp docker/nginx/api.conf /etc/nginx/sites-available/api
   sudo ln -sf /etc/nginx/sites-available/api /etc/nginx/sites-enabled/api
   # 改 CHANGEME：server_name、憑證路徑、/admin/ allowlist
   sudo nginx -t && sudo systemctl reload nginx
   ```

   憑證：Let's Encrypt 用 `certbot --nginx` 或 `certbot certonly --webroot -w /var/www/html`
   （範例的 80 port server 已保留 `/.well-known/acme-challenge/`）；前面有 Cloudflare 時也可用
   Cloudflare Origin CA 憑證（SSL mode 設 **Full (strict)**）。
4. **重算 proxy 信任設定**（`.env.prod`），規則同 [caddy.md](caddy.md)：

   | 拓撲 | `NINJA_NUM_PROXIES` | `FORWARDED_ALLOW_IPS` | nginx |
   | --- | --- | --- | --- |
   | 訪客 → nginx → api | `1` | `172.16.0.0/12`（docker 的 port 轉發從 bridge gateway 連入容器） | 不需要 `real_ip_*` |
   | 訪客 → Cloudflare 橘雲 → nginx → api | `2` | 同上 | 取消註解 `real_ip_header CF-Connecting-IP` 與 Cloudflare 的 `set_real_ip_from` |

   設錯的後果：`NINJA_NUM_PROXIES` 太小 → per-IP 節流可用偽造的 `X-Forwarded-For` 繞過；
   太大 → 錯把 client 自帶的值當來源 IP。改完 `make prod-up` 後照 caddy.md「步驟三」
   確認 access log 與 AuditLog 的 `metadata.ip` 是真實 client IP。
5. **保護 `/admin/`**：範例的 `location ^~ /admin/` 用 `allow`/`deny` 做 IP allowlist（admin 是
   帳密登入、不是 LINE Login，也沒有 rate limit，上線前必做）。前面有 Cloudflare 時，allowlist 依賴上一步的
   `real_ip_*`，否則 `$remote_addr` 永遠是 Cloudflare edge。

## 範例設定的重點

| 項目 | 設定 | 為什麼 |
| --- | --- | --- |
| TLS | `ssl_protocols TLSv1.2 TLSv1.3`、HTTP→HTTPS 301 | |
| HSTS / nosniff / X-Frame-Options / Referrer-Policy | `add_header ... always` + `proxy_hide_header` | `always` 讓 nginx 自己產生的錯誤頁（413、502）也帶；`proxy_hide_header` 拿掉 Django 送的同名 header，避免重複 |
| 請求大小 | `client_max_body_size 4m` | 本專案沒有檔案上傳端點，略大於 Django `DATA_UPLOAD_MAX_MEMORY_SIZE`（2.5MB）即可；之後加上傳功能時一起調高 |
| `/admin/` | 獨立 `location ^~`，IP allowlist | 見上 |
| upstream keepalive | `keepalive 16` + `proxy_set_header Connection ""` | 重用到 uvicorn 的連線；uvicorn 的 `UVICORN_TIMEOUT_KEEP_ALIVE`（130s，`uvicorn_run.py`）比 nginx 端長，不會偶發 502 |

> 本專案後端沒有 WebSocket / SSE（上游模板的 `apps/realtime` 沒有同步過來），所以範例沒有
> `/ws/`（`Upgrade` header）與 SSE（`proxy_buffering off`）的 location。之後加串流端點時要補上，
> 否則握手失敗或事件被緩衝卡住。
| 名稱前綴 | `api_` | 同一台 nginx 的所有站台共用 http context，`map` / `upstream` 名稱會撞 |

## 和 Caddy 版的差異（要自己補的）

- **重啟期間的請求**：api 容器重建的那幾秒會回 502（目前的 Caddyfile 也一樣）。需要的話加
  `proxy_next_upstream error timeout` + 第二個 api replica。
- **設定不跟 repo 一起部署**：改了 `docker/nginx/api.conf` 要到主機上手動複製 + reload；CD 不碰
  `/etc/nginx`（需要 sudo）。
- **憑證續約**：certbot 的 systemd timer 會自動續約，但記得續約後 reload nginx（`--deploy-hook`）。
