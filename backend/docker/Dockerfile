# ---------------------------------------------------------------------------
# Builder — resolve dependencies into a venv using the full build toolchain.
# ---------------------------------------------------------------------------
# Base images pinned by digest for reproducible, tamper-evident builds. The tag
# is kept for readability; the digest is authoritative. Dependabot (docker
# ecosystem) bumps both together.
FROM python:3.14-slim@sha256:b877e50bd90de10af8d82c57a022fc2e0dc731c5320d762a27986facfc3355c1 AS builder

WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Pin uv so builds are reproducible (bump deliberately, not on every build).
COPY --from=ghcr.io/astral-sh/uv:0.9@sha256:538e0b39736e7feae937a65983e49d2ab75e1559d35041f9878b7b7e51de91e4 /uv /usr/local/bin/uv

# Install only third-party deps (not the project itself) for better layer caching.
# The cache mount persists downloaded wheels across builds (BuildKit host cache),
# so a lockfile change re-downloads only what actually changed.
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

# ---------------------------------------------------------------------------
# Runtime — slim image with only runtime libs + the prebuilt venv. No uv,
# no compilers → smaller image and smaller attack surface.
# ---------------------------------------------------------------------------
FROM python:3.14-slim@sha256:b877e50bd90de10af8d82c57a022fc2e0dc731c5320d762a27986facfc3355c1 AS runtime

WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH"

# libpq5 for psycopg at runtime. The HEALTHCHECK uses the image's own Python
# (urllib, stdlib) instead of curl — no extra package, smaller attack surface.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system app && useradd --system --gid app app

# COPY --chown instead of a later `chown -R` — a separate chown layer would
# duplicate the venv + source and roughly double the image size.
COPY --from=builder --chown=app:app /app/.venv /app/.venv

ARG GIT_COMMIT_SHA=unknown
ENV GIT_COMMIT_SHA=${GIT_COMMIT_SHA}

COPY --chown=app:app . .
# collectstatic must run with the prod settings (whitenoise manifest storage)
# or the runtime lookup of hashed filenames fails. Dummy secret/DB values are
# fine — only static files are gathered. Root-owned output is read-only served.
# ENV=build (not prod): base.py's prod-env validation (real SECRET_KEY,
# ALLOWED_HOSTS, broker/cache URLs) only triggers when ENV=prod, and none of
# those exist at image-build time.
RUN ENV=build DJANGO_SETTINGS_MODULE=config.settings.prod \
    SECRET_KEY=build-only DATABASE_URL=sqlite://:memory: \
    python manage.py collectstatic --noinput

USER app

EXPOSE 8000

# Image-level HEALTHCHECK so the check travels with the image (plain `docker run`,
# non-compose platforms). k8s/compose probes override it harmlessly when set.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health/live', timeout=5).status == 200 else 1)"]

CMD ["python", "uvicorn_run.py"]
