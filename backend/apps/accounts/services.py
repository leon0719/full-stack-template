"""Business logic for authentication / token lifecycle."""

from datetime import timedelta
from typing import cast

from django.conf import settings
from django.contrib.auth import authenticate as dj_authenticate
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone
from loguru import logger
from ninja.errors import HttpError
from ninja.errors import ValidationError as NinjaValidationError

from apps.accounts.models import AuthToken
from apps.accounts.schema import RegisterRequest
from apps.core.security import generate_token


class AuthService:
    @staticmethod
    def register(payload: RegisterRequest) -> User:
        # ``create_user()`` hashes but never validates, so AUTH_PASSWORD_VALIDATORS
        # must be enforced here. The transient (unsaved) User carries username/email
        # so UserAttributeSimilarityValidator can compare the password against them.
        try:
            validate_password(payload.password, user=User(username=payload.username, email=payload.email))
        except DjangoValidationError as e:
            logger.warning("[Service] register rejected - password failed validation")
            # Re-raise as ninja's ValidationError so the unified 422 handler
            # (config/exceptions.py) renders it in the standard error shape.
            raise NinjaValidationError(
                errors=[
                    {"type": "password_validation", "loc": ["body", "payload", "password"], "msg": msg}
                    for msg in e.messages
                ]
            ) from e
        # Rely on the DB unique constraint instead of a check-then-create
        # (which races under concurrency and would surface as a 500).
        try:
            with transaction.atomic():
                user = User.objects.create_user(
                    username=payload.username,
                    email=payload.email,
                    password=payload.password,
                )
        except IntegrityError as e:
            logger.warning("[Service] register rejected - username taken")
            raise HttpError(409, "Username already taken") from e
        logger.info("[Service] user registered - user_id: {uid}", uid=user.id)
        return user

    @staticmethod
    def issue_token(user: User) -> str:
        raw, digest = generate_token()
        ttl_days = settings.AUTH_TOKEN_TTL_DAYS
        AuthToken.objects.create(
            user=user,
            digest=digest,
            expiry=timezone.now() + timedelta(days=ttl_days),
        )
        logger.info("[Service] token issued - user_id: {uid}", uid=user.pk)
        return raw

    @staticmethod
    def login(username: str, password: str) -> str:
        user = dj_authenticate(username=username, password=password)
        if user is None:
            # Never log the submitted username: users routinely type their
            # password into the username field, so it may be a credential.
            logger.warning("[Service] login failed - invalid credentials")
            raise HttpError(401, "Invalid credentials")
        return AuthService.issue_token(cast("User", user))

    @staticmethod
    def logout(user: User) -> int:
        deleted, _ = AuthToken.objects.filter(user=user).delete()
        logger.info("[Service] logout - user_id: {uid}, tokens_revoked: {n}", uid=user.pk, n=deleted)
        return deleted
