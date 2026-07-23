# 告警設定

目標：**出錯時有人會知道**。這件事拆成兩個獨立的問題，兩個都要解決：

| 問題 | 表現 | 靠什麼偵測 |
| --- | --- | --- |
| 程式壞了 | 拋出例外、回 500 | Sentry（本文第一節） |
| 服務不見了 | 什麼都沒發生，一片安靜 | 外部監控（第二、三節） |

第二類是最常被漏掉的。Sentry 只聽得到「跑起來而且丟出例外」的程式碼——
一個沒啟動的容器、一個死掉的 beat process、一個塞住的佇列，都不會產生任何
Sentry 事件。**沉默和健康長得一模一樣**，只能靠「預期收到訊號卻沒收到」來偵測。

---

## 1. Sentry → Slack

填了 `SENTRY_DSN` 只做到「錯誤被記錄下來」。Sentry 預設只寄 email 給 issue
owner，實務上很快就會被忽略。要真的通知到人，得建 alert rule。

### 一次性設定

1. **接上 Slack**
   Sentry → *Settings* → *Integrations* → **Slack** → *Add Workspace*，
   授權後選擇要通知的 channel（建議獨立開一個 `#alerts-backend`，
   不要丟進大家已經靜音的 `#general`）。

2. **建 Issue Alert**
   Sentry → *Alerts* → *Create Alert* → **Issues**：

   | 欄位 | 建議值 | 理由 |
   | --- | --- | --- |
   | Environment | `prod` | dev/staging 的錯誤不該吵到值班的人 |
   | When | `A new issue is created` | 新型錯誤最值得立刻看 |
   | If | `The issue is seen more than 10 times in 1h` | 另建一條，抓「舊錯誤突然放量」 |
   | Then | Send a Slack notification to `#alerts-backend` | |
   | Action interval | 30 minutes | 避免同一個 issue 洗版 |

3. **建 Metric Alert（選配但建議）**
   *Alerts* → *Create Alert* → **Number of Errors**，
   閾值設在「明顯高於平常」的量（先觀察一週再決定），
   用來抓「大量既有錯誤同時爆發」——這類狀況 Issue Alert 可能不會觸發。

### 驗證

別假設它會動。部署後實際觸發一次：

```bash
# 在 prod 容器內丟一個測試事件
docker compose -f docker/docker-compose.prod.yml exec api \
  python -c "import sentry_sdk; sentry_sdk.capture_message('alert routing test', level='error')"
```

Slack 沒收到就是沒設好。這步做完再往下。

> 用 Teams / Discord 的話：Sentry 同樣有官方 integration，
> 上面的 alert rule 設定完全一樣，只有第 1 步換成對應的 integration。

---

## 2. 服務存活監控（`/health/ready`）

`apps/health/views.py` 提供了完整的 readiness 檢查（DB、cache、Celery），
但**它不會自己通知任何人**——得有東西定期去打它。

### 設定

用任一外部監控服務（healthchecks.io、Better Stack、UptimeRobot、Pingdom）
建一個 HTTP 監控：

| 項目 | 值 |
| --- | --- |
| URL | `https://api.your-domain.com/health/ready` |
| 間隔 | 1–5 分鐘 |
| 判定成功 | HTTP 200 |
| 通知管道 | 與 Sentry 同一個 Slack channel |

`/health/ready` 的語意：

- **200 + `"status": "ok"`** — 全部正常
- **200 + `"status": "degraded"`** — Celery 不通，但 HTTP API 仍可服務
- **503** — DB 或 cache 不通，服務無法正常運作

> 監控要打 `/health/ready` 而不是 `/health/live`。`live` 永遠回 200
> （它只證明 process 活著），拿來做外部監控等於什麼都沒監控。

從外部打得通也順便驗證了反向代理與 DNS——這是 `live` 探針測不到的。

---

## 3. celery-beat 心跳

beat 掛掉是最安靜的故障：排程不再觸發，沒有例外、沒有錯誤日誌，
只有「本來每天會發生的事情不再發生」，通常幾週後才被發現。

### 設定

1. 到 healthchecks.io（免費額度足夠）建一個 Check：
   - Period: **5 分鐘**（對應 `CELERY_BEAT_SCHEDULE` 的 `beat-heartbeat`）
   - Grace time: **15 分鐘**（容忍偶發延遲，避免誤報）
   - 通知管道接同一個 Slack channel
2. 把它給的 ping URL 填進 `.env.prod`：
   ```bash
   BEAT_HEARTBEAT_URL=https://hc-ping.com/<your-uuid>
   ```
3. `make prod-up` 後確認 healthchecks.io 上該 check 在 5 分鐘內變成綠色。

實作在 `apps/core/tasks.py::beat_heartbeat`。ping 失敗只會留下 warning，
不會讓 beat 掛掉——真正的告警來自監控端「沒收到 ping」。

---

## 4. Celery 佇列積壓

worker 全掛或處理不及時，任務會在佇列裡越積越多。
**沒有任何一個任務會失敗**（它們只是排隊排不到），所以 Sentry 完全不會有動靜。

`apps/core/tasks.py::check_queue_depth` 每 5 分鐘直接問 broker 佇列長度，
超過 `CELERY_QUEUE_DEPTH_ALERT_THRESHOLD`（預設 1000）就送一則 Sentry
error——於是它會走上面第 1 節設好的同一條 Slack 通道。

門檻要依實際流量調整：平常尖峰若就有 800，設 1000 會一直誤報。
先觀察一段時間再決定，寧可設高一點也不要讓大家學會忽略它。

> 這裡刻意問 broker 而不是用 `celery inspect`——`inspect` 是問 worker，
> 但 worker 全掛的時候正是最需要這個數字的時刻。

---

## 5. CI 失敗通知

`.github/workflows/ci.yml` 的 `notify` job 會在任一 job 失敗時發 Slack。

設定：到 Slack 建一個 [Incoming Webhook](https://api.slack.com/messaging/webhooks)，
把 URL 存成 repo 的 secret `SLACK_WEBHOOK_URL`
（*Settings* → *Secrets and variables* → *Actions*）。

沒設這個 secret 時，該 job 會印一則 warning 說明通知未啟用，但不會讓 CI 變紅。

---

## 檢查清單

上線前逐項確認——每一項都是「漏掉也不會有任何錯誤訊息」的類型：

- [ ] `SENTRY_DSN` 已填（prod 留空會拒絕開機，所以這項其實被強制了）
- [ ] Sentry 的 Slack integration 已接、alert rule 已建
- [ ] 已實際觸發一次測試事件，**確認 Slack 真的收到**
- [ ] 外部監控在打 `/health/ready`（不是 `/health/live`）
- [ ] `BEAT_HEARTBEAT_URL` 已填，且監控端已看到第一次 ping
- [ ] `CELERY_QUEUE_DEPTH_ALERT_THRESHOLD` 已依實際流量調整
- [ ] `SLACK_WEBHOOK_URL` secret 已設（CI 失敗通知）
- [ ] 以上通知都進到**同一個** channel，且該 channel 沒有被值班的人靜音
