from django.apps import AppConfig


class AccountsConfig(AppConfig):
    name = "apps.accounts"
    verbose_name = "Accounts"

    def ready(self) -> None:
        from apps.accounts import signals  # noqa: F401
