from django.conf import settings
from django.db import models


class AuthToken(models.Model):
    """Opaque bearer token. Only the SHA-256 ``digest`` is stored; the raw token is
    returned to the client once at issue time and never persisted."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="auth_tokens",
    )
    digest = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expiry = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["user", "created_at"])]

    def __str__(self) -> str:
        return f"AuthToken(user_id={self.user_id})"


class LineProfile(models.Model):
    """Profile data captured from LINE Login (display name + avatar).

    Refreshed on every login by ``apps.accounts.adapters`` — the fields always
    reflect what LINE returned most recently, never a user-edited value.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="line_profile",
    )
    line_user_id = models.CharField(max_length=64, unique=True)
    display_name = models.CharField(max_length=255, blank=True)
    picture_url = models.URLField(blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"LineProfile(user_id={self.user_id})"
