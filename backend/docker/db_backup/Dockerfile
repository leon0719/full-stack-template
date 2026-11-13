# DB 備份 sidecar：pg_dump + aws-cli。用 postgres 18 的 client——pg_dump 版本必須 >= 伺服器版本
# （新版 pg_dump 可以傾印舊版伺服器，反過來不行）。digest 與 docker-compose.dev.yml 的 db 相同，
# dependabot（docker）會一起更新。
FROM postgres:18-alpine@sha256:1b1689b20d16a014a3d195653381cf2caa75a41a92d93b255a9d6ea29fd353aa

RUN apk add --no-cache aws-cli

COPY --chmod=0755 backup.sh /usr/local/bin/backup.sh

# 非 root 執行（image 內建的 postgres 使用者）；暫存檔寫在 /tmp。
USER postgres
WORKDIR /tmp

# exec form：backup.sh 是 PID 1，docker stop 的 SIGTERM 直接送到它（sleep 中途也會結束）。
ENTRYPOINT ["/bin/sh", "/usr/local/bin/backup.sh"]
