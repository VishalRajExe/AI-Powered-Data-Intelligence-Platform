from __future__ import annotations

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def test_root_announces_the_service(client: TestClient):
    response = client.get("/")
    assert response.status_code == 200
    assert response.json()["service"] == "finalagent-ai-service"


def test_health_is_public_and_reports_credential_presence_not_values(client: TestClient):
    response = client.get("/ai/v1/health")
    assert response.status_code == 200
    body = response.json()

    assert body["status"] == "UP"
    assert body["credentials"] == {
        "geminiApiConfigured": True,
        "firecrawlApiConfigured": True,
        "inboundAuthRequired": True,
    }
    # A health payload that echoed a key would leak it to anything able to reach the port.
    assert "test-only" not in response.text


def test_health_shape_matches_the_java_readiness_dto(client: TestClient):
    credentials = client.get("/ai/v1/health").json()["credentials"]
    assert set(credentials) == {
        "geminiApiConfigured",
        "firecrawlApiConfigured",
        "inboundAuthRequired",
    }
    assert all(isinstance(value, bool) for value in credentials.values())


def test_every_response_carries_a_request_id(client: TestClient):
    assert client.get("/ai/v1/health").headers["X-Request-Id"]


def test_unknown_routes_use_the_shared_error_envelope(client: TestClient):
    response = client.get("/ai/v1/does-not-exist")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_a_foreign_host_is_refused(settings: Settings):
    # The service is internal. Trusting any Host header would let a browser page on another
    # origin probe it through DNS rebinding.
    rebinding = settings.model_copy(update={"allowed_hosts": ["localhost", "127.0.0.1"]})
    with TestClient(create_app(rebinding)) as strict_client:
        response = strict_client.get("/ai/v1/health", headers={"Host": "attacker.example"})
    assert response.status_code == 400
