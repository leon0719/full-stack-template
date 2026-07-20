"""Reusable owner-scoped CRUD service base.

A concrete resource service subclasses ``OwnedResourceService`` and declares its
``model`` (plus optional ``select_related`` / ``owner_field``). The base centralises
IDOR-safe fetches, owner-scoped querysets, and create/update/delete with consistent
logging. Override a method only when a resource needs behaviour beyond the default.
"""

from django.contrib.auth.models import AbstractBaseUser
from django.db import models
from django.db.models import QuerySet
from django.shortcuts import get_object_or_404
from loguru import logger
from ninja import Schema


class OwnedResourceService[M: models.Model]:
    model: type[M]
    owner_field: str = "owner"
    select_related: tuple[str, ...] = ()

    @classmethod
    def get_owned_or_404(cls, user: AbstractBaseUser, pk: int) -> M:
        """Fetch a row the user owns, else raise Http404 (IDOR protection — a
        non-owner gets 404, never another user's row)."""
        qs: QuerySet[M] = cls.model._default_manager.all()
        if cls.select_related:
            qs = qs.select_related(*cls.select_related)
        return get_object_or_404(qs, pk=pk, **{cls.owner_field: user})

    @classmethod
    def owned_qs(cls, user: AbstractBaseUser) -> QuerySet[M]:
        qs: QuerySet[M] = cls.model._default_manager.filter(**{cls.owner_field: user})
        if cls.select_related:
            qs = qs.select_related(*cls.select_related)
        return qs

    @classmethod
    def create(cls, user: AbstractBaseUser, payload: Schema) -> M:
        obj: M = cls.model._default_manager.create(**{cls.owner_field: user}, **payload.model_dump())
        logger.info("[Service] {m} created - id: {id}, owner: {uid}", m=cls.model.__name__, id=obj.pk, uid=user.pk)
        return obj

    @classmethod
    def update(cls, obj: M, payload: Schema) -> M:
        changes = payload.model_dump(exclude_unset=True)
        for field, value in changes.items():
            setattr(obj, field, value)
        # Persist only the fields the caller actually sent (+ updated_at). Writing
        # the whole row would clobber columns changed by a concurrent PATCH
        # between our fetch and save (lost update); a scoped write only touches
        # what we changed. updated_at must be listed explicitly — auto_now still
        # computes it, but Django only writes fields named in update_fields.
        # Concrete models inherit updated_at from TimestampedModel.
        obj.save(update_fields=[*changes.keys(), "updated_at"])
        logger.info("[Service] {m} updated - id: {id}", m=cls.model.__name__, id=obj.pk)
        return obj

    @classmethod
    def delete(cls, obj: M) -> None:
        pk = obj.pk
        obj.delete()
        logger.info("[Service] {m} deleted - id: {id}", m=cls.model.__name__, id=pk)
