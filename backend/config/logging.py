"""Loguru integration with Django's logging system."""

import logging
import sys

from loguru import logger

_loguru_configured = False

HEALTH_CHECK_PATHS = ("/health/live", "/health/ready")


class LoguruHandler(logging.Handler):
    """Logging handler that forwards Django log records to loguru."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            level: str | int = logger.level(record.levelname).name
        except ValueError:
            level = record.levelno

        frame = logging.currentframe()
        depth = 2
        while frame is not None and frame.f_code.co_filename == logging.__file__:
            frame = frame.f_back  # type: ignore[assignment]
            depth += 1

        logger.opt(depth=depth, exception=record.exc_info).log(level, record.getMessage())


class HealthCheckFilter(logging.Filter):
    """Drop uvicorn access-log records for health check endpoints.

    Matches the exact request path parsed from ``record.args`` — uvicorn's
    AccessFormatter passes ``(client_addr, method, full_path, http_version,
    status_code)`` — instead of substring-matching the rendered line, so a
    crafted URL like ``/admin/login/?x=/health/live`` cannot suppress its own
    access log. Fails open (keeps the record) if args don't match that shape.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if not isinstance(args, tuple) or len(args) != 5:
            return True  # not a uvicorn access record — never filter
        full_path = args[2]
        if not isinstance(full_path, str):
            return True
        path = full_path.partition("?")[0]
        return path not in HEALTH_CHECK_PATHS


def setup_loguru(*, debug: bool = False, json_logs: bool = False) -> None:
    """Configure loguru. Safe to call multiple times — only configures once."""
    global _loguru_configured
    if _loguru_configured:
        return
    _loguru_configured = True

    logger.remove()
    # Default request_id so the format never KeyErrors for logs emitted outside
    # a request (startup, Celery). RequestIDMiddleware overrides it per request
    # via logger.contextualize(); JSON logs include it under "extra".
    logger.configure(extra={"request_id": "-"})

    if json_logs:
        # diagnose=True (the default) dumps local variable values into
        # tracebacks — a credential/PII leak in prod logs. backtrace off too:
        # plain tracebacks are enough for structured logs.
        logger.add(sys.stderr, serialize=True, level="INFO", diagnose=False, backtrace=False)
    else:
        log_format = (
            "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | "
            "<level>{level: <8}</level> | "
            "<magenta>{extra[request_id]}</magenta> | "
            "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - "
            "<level>{message}</level>"
        )
        logger.add(sys.stderr, format=log_format, level="DEBUG" if debug else "INFO", colorize=True)


UVICORN_LOG_CONFIG: dict = {
    "version": 1,
    "disable_existing_loggers": False,
    "filters": {
        "health_check_filter": {
            "()": HealthCheckFilter,
        },
    },
    "formatters": {
        "default": {
            "()": "uvicorn.logging.DefaultFormatter",
            "fmt": "%(asctime)s - %(levelprefix)s %(message)s",
            "datefmt": "%Y-%m-%dT%H:%M:%S",
        },
        "access": {
            "()": "uvicorn.logging.AccessFormatter",
            "fmt": '%(asctime)s - %(levelprefix)s %(client_addr)s - "%(request_line)s" %(status_code)s',
            "datefmt": "%Y-%m-%dT%H:%M:%S",
        },
    },
    "handlers": {
        "default": {
            "formatter": "default",
            "class": "logging.StreamHandler",
            "stream": "ext://sys.stderr",
        },
        "access": {
            "formatter": "access",
            "class": "logging.StreamHandler",
            "stream": "ext://sys.stdout",
            "filters": ["health_check_filter"],
        },
    },
    "loggers": {
        "uvicorn": {"handlers": ["default"], "level": "INFO", "propagate": False},
        "uvicorn.error": {"level": "INFO"},
        "uvicorn.access": {"handlers": ["access"], "level": "INFO", "propagate": False},
    },
}
