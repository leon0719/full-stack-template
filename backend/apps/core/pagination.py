"""Project-default pagination."""

from django.conf import settings
from ninja.pagination import PageNumberPagination


class StandardPagination(PageNumberPagination):
    """Page-number pagination whose default page size and hard cap come from
    Settings, so every list endpoint paginates consistently and is tunable in
    one place. ``?page_size=`` is honoured up to ``MAX_PAGE_SIZE``."""

    def __init__(self) -> None:
        super().__init__(page_size=settings.PAGE_SIZE, max_page_size=settings.MAX_PAGE_SIZE)
