"""django-allauth adapters for LINE Login.

These are minimal placeholders — full implementation is in a later task.
"""

from allauth.account.adapter import DefaultAccountAdapter
from allauth.socialaccount.adapter import DefaultSocialAccountAdapter


class LineAccountAdapter(DefaultAccountAdapter):
    """Adapter for django-allauth account layer."""

    pass


class LineSocialAccountAdapter(DefaultSocialAccountAdapter):
    """Adapter for django-allauth socialaccount layer."""

    pass
