"""Seed a pool of dedicated users for load testing (see perf/locustfile.py).

Goes straight through the ORM and issues bearer tokens directly: this project
only logs in via LINE OAuth, which a load generator can't drive.

Usage:
    uv run python manage.py seed_perf_users --count 20 > perf/.perf_users.json
"""

import json
from argparse import ArgumentParser
from typing import Any

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand

from apps.accounts.services import AuthService

_USERNAME_PREFIX = "perf-test-"


class Command(BaseCommand):
    help = "Seed (or reuse) a pool of users + tokens for locust load testing, printed as JSON."

    def add_arguments(self, parser: ArgumentParser) -> None:
        parser.add_argument("--count", type=int, default=20, help="Number of pool users (default: 20)")

    def handle(self, *args: Any, **options: Any) -> None:
        users = []
        for i in range(options["count"]):
            username = f"{_USERNAME_PREFIX}{i}"
            user, _created = User.objects.get_or_create(
                username=username,
                defaults={"email": f"{username}@example.invalid"},
            )
            users.append({"username": username, "token": AuthService.issue_token(user)})

        self.stdout.write(json.dumps(users))
