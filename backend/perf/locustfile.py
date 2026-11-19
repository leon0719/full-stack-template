"""Locust load test for articles CRUD. Manual/periodic tool — deliberately not
wired into CI (results are slow and environment-sensitive).

Setup (once per environment; re-run after `make down`+`docker-clean` wipes the DB):
    make up
    make perf-seed

Run:
    make perf                                      # web UI at http://localhost:8089
    make perf ARGS="--headless -u 20 -r 5 -t 2m"    # scripted run, no UI

Login is not load-tested: this project only logs in via LINE OAuth, which
needs a real browser round-trip to LINE. Seeded users get bearer tokens directly.
"""

import itertools
import json
import os
import threading
from pathlib import Path

from locust import HttpUser, between, task

_USERS_FILE = Path(os.environ.get("PERF_USERS_FILE", "perf/.perf_users.json"))


def _load_pool() -> list[dict[str, str]]:
    if not _USERS_FILE.exists():
        raise RuntimeError(f"{_USERS_FILE} not found — run `make perf-seed` first")
    with _USERS_FILE.open() as f:
        return json.load(f)


_pool_cycle = itertools.cycle(_load_pool())
_pool_lock = threading.Lock()


def _next_pool_user() -> dict[str, str]:
    # itertools.cycle isn't thread-safe on its own; guard the shared iterator.
    with _pool_lock:
        return next(_pool_cycle)


class ArticleUser(HttpUser):
    """An authenticated user doing typical articles CRUD traffic.

    Writes are throttled per-user (WriteRateThrottle, THROTTLE_WRITE_RATE),
    not per-IP, so spreading load across the seeded pool scales write
    capacity with pool size instead of hitting one shared ceiling.
    """

    wait_time = between(1, 3)
    headers: dict[str, str]

    def on_start(self) -> None:
        self.headers = {"Authorization": f"Bearer {_next_pool_user()['token']}"}

    @task(3)
    def list_articles(self) -> None:
        self.client.get("/articles", headers=self.headers)

    @task(2)
    def create_and_publish(self) -> None:
        resp = self.client.post(
            "/articles",
            json={"title": "Perf test article", "content": "load test payload"},
            headers=self.headers,
        )
        if resp.status_code != 201:
            return
        article_id = resp.json()["data"]["id"]
        self.client.get(f"/articles/{article_id}", headers=self.headers)
        self.client.patch(
            f"/articles/{article_id}",
            json={"status": "published"},
            headers=self.headers,
        )

    @task(1)
    def create_and_delete(self) -> None:
        resp = self.client.post(
            "/articles",
            json={"title": "Perf test article (throwaway)", "content": ""},
            headers=self.headers,
        )
        if resp.status_code != 201:
            return
        article_id = resp.json()["data"]["id"]
        self.client.delete(f"/articles/{article_id}", headers=self.headers)
