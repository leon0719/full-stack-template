"""Guard the CI prod env file (.env.ci) against drift.

CI's `check --deploy` and docker smoke test both boot prod settings from `.env.ci`.
When someone adds a new required prod setting to `Settings._validate_prod`, these
tests fail locally (`make test-local`) instead of the docker job failing in CI.
"""

import re
from pathlib import Path

import pytest
from dotenv import dotenv_values

from config.settings.base import Settings

pytestmark = pytest.mark.unit

BACKEND_DIR = Path(__file__).resolve().parent.parent
CI_ENV = BACKEND_DIR / ".env.ci"
PROD_EXAMPLE = BACKEND_DIR / ".env.prod.example"

# Keys in .env.ci that only the smoke-test container needs; not part of the prod checklist.
CI_ONLY_KEYS = {"UVICORN_HOST", "WEB_CONCURRENCY"}


def _read(path: Path) -> dict[str, str]:
    return {k: v for k, v in dotenv_values(path).items() if v is not None}


def test_ci_env_passes_prod_validation(monkeypatch):
    # Validate exactly what .env.ci holds: drop same-named process env vars and disable the
    # .env.local fallback, either of which could silently fill in a key .env.ci lacks.
    for name in Settings.model_fields:
        monkeypatch.delenv(name, raising=False)
    values = {k: v for k, v in _read(CI_ENV).items() if k in Settings.model_fields}
    # Raw env strings by design (pydantic coerces them like real env vars); `_env_file` is a
    # pydantic-settings init kwarg the mypy plugin-less signature does not know about.
    cfg = Settings(_env_file=None, **values)  # type: ignore[arg-type,call-arg]
    assert cfg.ENV == "prod"


def test_ci_env_keys_are_documented_in_prod_example():
    ci_keys = set(_read(CI_ENV)) - CI_ONLY_KEYS
    # .env.prod.example legitimately leaves some values empty (e.g. LINE_LOGIN_*=),
    # so compare raw keys, not just the non-empty ones.
    example_keys = set(dotenv_values(PROD_EXAMPLE))
    missing = sorted(ci_keys - example_keys)
    assert not missing, f"Document these in .env.prod.example too: {missing}"


def test_ci_env_format_is_portable():
    # .env.ci is read both by `docker run --env-file` (takes values verbatim) and by shell
    # `set -a; . ./.env.ci` (strips quotes, expands $). Only plain KEY=VALUE reads the same in both.
    pattern = re.compile(r"^[A-Z][A-Z0-9_]*=[^\s\"'#$`]*$")
    bad = [
        line
        for line in CI_ENV.read_text().splitlines()
        if line.strip() and not line.startswith("#") and not pattern.match(line)
    ]
    assert not bad, f"Use plain unquoted KEY=VALUE (no spaces/quotes/$/inline comments): {bad}"
