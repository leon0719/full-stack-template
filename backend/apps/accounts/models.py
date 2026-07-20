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
