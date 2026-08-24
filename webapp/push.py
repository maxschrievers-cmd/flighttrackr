import json
import os
from typing import Any

from pywebpush import WebPushException, webpush

VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
VAPID_SUBJECT = os.getenv("VAPID_SUBJECT", "")


def configured() -> bool:
    return bool(VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY and VAPID_SUBJECT)


def send(subscription: dict[str, Any], payload: dict[str, Any]) -> None:
    if not configured():
        raise RuntimeError("Web Push is not configured")
    webpush(
        subscription_info=subscription,
        data=json.dumps(payload, separators=(",", ":")),
        vapid_private_key=VAPID_PRIVATE_KEY,
        vapid_claims={"sub": VAPID_SUBJECT},
        ttl=300,
    )


def is_gone(exc: WebPushException) -> bool:
    response = getattr(exc, "response", None)
    return bool(response and response.status_code in (404, 410))
