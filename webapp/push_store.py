import json
import os
import tempfile
from pathlib import Path
from threading import Lock
from typing import Any

_PATH = Path(os.getenv("PUSH_STORE_PATH", tempfile.gettempdir())) / "flighttrackr-push-subscriptions.json"
_LOCK = Lock()


def _load() -> list[dict[str, Any]]:
    try:
        data = json.loads(_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def _save(items: list[dict[str, Any]]) -> None:
    _PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = _PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(items, separators=(",", ":")), encoding="utf-8")
    os.replace(tmp, _PATH)


def upsert(subscription: dict[str, Any]) -> None:
    endpoint = subscription.get("endpoint")
    keys = subscription.get("keys")
    if not isinstance(endpoint, str) or not endpoint.startswith("https://") or not isinstance(keys, dict):
        raise ValueError("Invalid push subscription")
    if not all(isinstance(keys.get(k), str) and keys.get(k) for k in ("auth", "p256dh")):
        raise ValueError("Invalid push subscription keys")
    with _LOCK:
        items = [x for x in _load() if x.get("endpoint") != endpoint]
        items.append({"endpoint": endpoint, "keys": {"auth": keys["auth"], "p256dh": keys["p256dh"]}})
        _save(items)


def remove(endpoint: str) -> None:
    with _LOCK:
        _save([x for x in _load() if x.get("endpoint") != endpoint])


def all_subscriptions() -> list[dict[str, Any]]:
    with _LOCK:
        return _load()
