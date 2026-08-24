import logging
import math
import time
from collections.abc import Callable

import requests

from models import FlightState

logger = logging.getLogger(__name__)


class OpenSkyClient:
    def __init__(self, client_id: str, client_secret: str, min_request_interval_seconds: int, token_refresh_buffer_seconds: int = 300, auth_timeout_seconds: int = 3, request_timeout_seconds: int = 5, rate_limit_backoff_seconds: int = 60, radius_degrees_per_mile: float = 0.0145, status_callback: Callable[[str, str], None] | None = None) -> None:
        self.client_id = client_id
        self.client_secret = client_secret
        self.min_request_interval_seconds = min_request_interval_seconds
        self.token_refresh_buffer_seconds = token_refresh_buffer_seconds
        self.auth_timeout_seconds = auth_timeout_seconds
        self.request_timeout_seconds = request_timeout_seconds
        self.rate_limit_backoff_seconds = rate_limit_backoff_seconds
        self.radius_degrees_per_mile = radius_degrees_per_mile
        self.access_token: str | None = None
        self.token_expires_at = 0.0
        self.last_request_time = 0.0
        self.auth_backoff_until = 0.0
        self.session = requests.Session()
        self.status_callback = status_callback

    def get_access_token(self) -> str | None:
        now = time.time()
        if self.access_token and now < self.token_expires_at - self.token_refresh_buffer_seconds:
            return self.access_token
        if now < self.auth_backoff_until:
            return None
        if not self.client_id or not self.client_secret:
            return None
        try:
            response = self.session.post(
                "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token",
                data={"client_id": self.client_id, "client_secret": self.client_secret, "grant_type": "client_credentials"},
                timeout=self.auth_timeout_seconds,
            )
            response.raise_for_status()
            token_data = response.json()
            token = token_data.get("access_token")
            if not token:
                raise requests.exceptions.RequestException("OpenSky auth response contained no access token")
            self.access_token = token
            self.token_expires_at = time.time() + float(token_data.get("expires_in", 3600))
            self.auth_backoff_until = 0.0
            return self.access_token
        except requests.exceptions.RequestException as exc:
            self.auth_backoff_until = time.time() + min(300, self.rate_limit_backoff_seconds)
            logger.warning("OpenSky auth unavailable; falling back to other providers: %s", exc)
            return None

    def get_nearby_flights(self, latitude: float, longitude: float, radius_miles: int) -> list[FlightState]:
        token = self.get_access_token()
        if not token:
            return []
        self._respect_rate_limit()
        lat_delta = radius_miles / 69.0
        cos_lat = max(0.01, abs(math.cos(math.radians(latitude))))
        lon_delta = radius_miles / (69.172 * cos_lat)
        url = ("https://opensky-network.org/api/states/all"
               f"?lamin={max(-90, latitude - lat_delta)}&lamax={min(90, latitude + lat_delta)}"
               f"&lomin={max(-180, longitude - lon_delta)}&lomax={min(180, longitude + lon_delta)}")
        try:
            response = self.session.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=self.request_timeout_seconds)
            self.last_request_time = time.time()
            if response.status_code == 429:
                self.auth_backoff_until = time.time() + self.rate_limit_backoff_seconds
                return []
            response.raise_for_status()
            payload = response.json()
        except requests.exceptions.RequestException as exc:
            logger.warning("OpenSky data fetch unavailable; falling back to other providers: %s", exc)
            return []
        return [flight for state in (payload.get("states") or []) if (flight := FlightState.from_api_state(state))]

    def _respect_rate_limit(self) -> None:
        elapsed = time.time() - self.last_request_time
        if elapsed < self.min_request_interval_seconds:
            time.sleep(self.min_request_interval_seconds - elapsed)

    def _notify_status(self, title: str, detail: str) -> None:
        if self.status_callback is not None:
            self.status_callback(title, detail)

    def _notify_request_status(self, exc: requests.exceptions.RequestException, title: str, detail: str) -> None:
        if isinstance(exc, (requests.exceptions.ConnectionError, requests.exceptions.Timeout)):
            self._notify_status("WiFi Error", "Network down")
            return
        self._notify_status(title, detail)
