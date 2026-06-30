"""
CraftBot Integration Client — call external APIs through CraftBot.

Living UIs are shareable, so they never store credentials. Instead,
requests go through CraftBot which injects auth headers server-side.

Usage:
    from services.integration_client import integration

    # Check what's available
    integrations = await integration.get_integrations()

    # Make an authenticated API call
    result = await integration.request(
        integration="google_workspace",
        method="GET",
        url="https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
    )
    if result["status"] == 200:
        channels = result["data"]
"""

import os
import httpx
from typing import Any, Dict, List, Optional

BRIDGE_URL = os.environ.get("CRAFTBOT_BRIDGE_URL", "")
BRIDGE_TOKEN = os.environ.get("CRAFTBOT_BRIDGE_TOKEN", "")


class IntegrationClient:
    """Proxy client for calling external APIs through CraftBot."""

    def __init__(self):
        self._client: Optional[httpx.AsyncClient] = None

    def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=30)
        return self._client

    @property
    def available(self) -> bool:
        """Whether the CraftBot integration bridge is available."""
        return bool(BRIDGE_URL and BRIDGE_TOKEN)

    def _auth_headers(self) -> Dict[str, str]:
        return {"Authorization": f"Bearer {BRIDGE_TOKEN}"}

    async def get_integrations(self) -> List[Dict[str, Any]]:
        """
        List available integrations and their connection status.

        Returns a list like:
        [
            {"id": "google_workspace", "connected": true, "granted": true},
            {"id": "slack", "connected": true, "granted": false},
            {"id": "discord", "connected": false, "granted": false},
        ]
        """
        if not self.available:
            return []
        try:
            client = self._ensure_client()
            r = await client.get(
                f"{BRIDGE_URL}/api/integrations/available",
                headers=self._auth_headers(),
            )
            if r.status_code == 200:
                return r.json().get("integrations", [])
            return []
        except Exception:
            return []

    async def request(
        self,
        integration: str,
        method: str,
        url: str,
        headers: Optional[Dict[str, str]] = None,
        body: Any = None,
    ) -> Dict[str, Any]:
        """
        Make an authenticated request to an external API via CraftBot proxy.

        Args:
            integration: Platform ID (e.g., "google_workspace", "slack", "discord")
            method: HTTP method (GET, POST, PUT, DELETE)
            url: Full URL to the external API endpoint
            headers: Optional extra headers (e.g., custom Accept header)
            body: Optional request body (dict for JSON)

        Returns:
            {"status": 200, "data": {...}} on success
            {"status": 4xx/5xx, "data": "error message"} on failure
            {"error": "..."} if bridge itself fails
        """
        if not self.available:
            return {"error": "Integration bridge not available"}

        try:
            client = self._ensure_client()
            r = await client.post(
                f"{BRIDGE_URL}/api/integrations/proxy",
                headers=self._auth_headers(),
                json={
                    "integration": integration,
                    "method": method,
                    "url": url,
                    "headers": headers or {},
                    "body": body,
                },
            )
            return r.json()
        except Exception as e:
            return {"error": str(e)}

    async def llm_complete(self, prompt: str, system_message: str = None) -> str:
        """
        Call CraftBot's LLM for text completion.

        Returns the LLM's response text, or empty string on error.
        """
        if not self.available:
            return ""
        try:
            client = self._ensure_client()
            body = {"prompt": prompt}
            if system_message:
                body["system_message"] = system_message
            r = await client.post(
                f"{BRIDGE_URL}/api/bridge/llm",
                headers=self._auth_headers(),
                json=body,
                timeout=120,  # LLM calls can be slow
            )
            if r.status_code == 200:
                return r.json().get("content", "")
            return ""
        except Exception:
            return ""

    async def vlm_describe(self, image_url: str, prompt: str = "Describe this image.") -> str:
        """
        Call CraftBot's VLM to describe/analyze an image.

        Returns the VLM's description text, or empty string on error.
        """
        if not self.available:
            return ""
        try:
            client = self._ensure_client()
            r = await client.post(
                f"{BRIDGE_URL}/api/bridge/vlm",
                headers=self._auth_headers(),
                json={"image_url": image_url, "prompt": prompt},
                timeout=60,
            )
            if r.status_code == 200:
                return r.json().get("description", "")
            return ""
        except Exception:
            return ""

    async def close(self):
        """Close the HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None


# Singleton — import and use directly
integration = IntegrationClient()
