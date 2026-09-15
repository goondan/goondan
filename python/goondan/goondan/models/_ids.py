"""Identifiers the adapters create for result messages and unnamed tool calls."""

from __future__ import annotations

import secrets
import uuid


def random_hex(digits: int) -> str:
    """Lowercase hexadecimal text with the given number of digits."""
    return secrets.token_hex((digits + 1) // 2)[:digits]


def new_message_id() -> str:
    """A new random message identifier."""
    return uuid.uuid4().hex
