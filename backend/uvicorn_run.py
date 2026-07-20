"""Uvicorn entry point with custom log config and health check filter."""

import os

import uvicorn

from config.logging import UVICORN_LOG_CONFIG

if __name__ == "__main__":
    is_local = os.getenv("ENV", "local") == "local"

    host = os.getenv("UVICORN_HOST", "127.0.0.1")

    # Worker count: WEB_CONCURRENCY wins if set (tune per deployment);
    # otherwise 1 locally and CPU-based in prod. process_cpu_count() respects
    # container cgroup limits — cpu_count() would read the host's cores and
    # massively over-fork on a CPU-limited container.
    #
    # N+1 (not the WSGI-era 2N+1): these are async ASGI workers, so a single
    # worker already keeps a core busy across concurrent I/O-bound requests.
    # Over-forking just multiplies memory (each worker is a full interpreter).
    # Bump via WEB_CONCURRENCY if a CPU-bound workload actually needs more.
    default_workers = 1 if is_local else (os.process_cpu_count() or 1) + 1
    workers = int(os.getenv("WEB_CONCURRENCY", "0")) or default_workers

    # TLS terminates at the reverse proxy; trust its X-Forwarded-* headers so
    # request.scheme and the client IP (throttling key!) are correct. Set
    # FORWARDED_ALLOW_IPS to the proxy's address/CIDR — "*" only if the proxy
    # is the sole way to reach this port.
    forwarded_allow_ips = os.getenv("FORWARDED_ALLOW_IPS", "127.0.0.1")

    # Scope the dev auto-reloader to source dirs only. The dev container bind-mounts
    # the whole repo at /app, and Postgres writes its data under ../data/postgres
    # (i.e. /app/data), so an unscoped watcher rescans thousands of DB files on
    # every WAL write — pure noise + wasted I/O, and it never triggers a reload
    # (only *.py does). Watching config/ + apps/ covers all hot-reloadable code.
    reload_dirs = ["config", "apps"] if is_local else None

    uvicorn.run(
        "config.asgi:application",
        host=host,
        port=8000,
        workers=workers,
        reload=is_local,
        reload_dirs=reload_dirs,
        log_config=UVICORN_LOG_CONFIG,
        proxy_headers=True,
        forwarded_allow_ips=forwarded_allow_ips,
        # Let in-flight requests finish (up to 30s) on SIGTERM instead of being cut
        # off — important for zero-downtime rolling deploys.
        timeout_graceful_shutdown=30,
    )
