"""Opaque-token crypto helpers (no model dependency — safe to share).

A raw token is handed to the client once; only its SHA-256 digest is stored.
Concrete bearer auth (which queries the token table) lives in the owning feature
app — see ``apps.accounts.authentication.BearerAuth``.
"""

import hashlib
import secrets

_TOKEN_BYTES = 32


def hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def generate_token() -> tuple[str, str]:
    """Return ``(raw_token, digest)``. Persist the digest, hand the raw token out once."""
    raw = secrets.token_urlsafe(_TOKEN_BYTES)
    return raw, hash_token(raw)
