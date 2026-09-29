"""Logging with the same masking contract as the Java side: no credential reaches any sink."""
from __future__ import annotations

import json
import logging
import re
from datetime import UTC, datetime

KEY_VALUE = re.compile(
    r"(?i)(\"?[a-z0-9_]*(?:api[_-]?key|password|passwd|secret|token|authorization|cookie)"
    r"[a-z0-9_]*\"?\s*[:=]\s*)(\"?)([^\"'\s,;}&]+)(\"?)"
)
KEY_SHAPE = re.compile(
    r"\b(fc-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9_-]{16,}|"
    r"gh[pousr]_[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|"
    r"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,})\b"
)
URL_CREDENTIALS = re.compile(r"(?i)://([^:/\s]+):([^@\s]+)@")

MASKED = "***"


def mask(text: str) -> str:
    if not text:
        return text
    # Groups: 1 = "key + separator", 2 = opening quote, 3 = value, 4 = closing quote.
    masked = KEY_VALUE.sub(lambda m: f"{m.group(1)}{m.group(2)}{MASKED}{m.group(4)}", text)
    masked = URL_CREDENTIALS.sub(lambda m: f"://{m.group(1)}:{MASKED}@", masked)
    return KEY_SHAPE.sub(MASKED, masked)


class MaskingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            record.msg = mask(str(record.getMessage()))
            record.args = ()
        except Exception:  # never lose the log line, never leak the unmasked text
            record.msg = "[unmappable log record]"
            record.args = ()
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.now(UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "message": mask(record.getMessage()),
        }
        if record.exc_info:
            payload["exception"] = mask(self.formatException(record.exc_info))
        return json.dumps(payload, default=str)


def configure_logging(level: str = "info") -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    handler.addFilter(MaskingFilter())

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())

    # uvicorn installs its own access logger; route it through the masked handler too.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        logger.handlers = []
        logger.propagate = True
