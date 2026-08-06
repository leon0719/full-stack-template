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

    def list_apps(self, request, provider=None, client_id=None):
        """Override to only use database-stored SocialApps, not settings-based ones.

        This prevents conflicts when both SOCIALACCOUNT_PROVIDERS settings and
        database SocialApps are defined for the same provider.
        """
        from allauth.socialaccount.models import SocialApp

        ret = []
        if provider:
            # Only query database, not settings
            apps = SocialApp.objects.on_site(request).filter(provider=provider)
            if client_id:
                apps = apps.filter(client_id=client_id)
            ret.extend(apps)
        return ret
