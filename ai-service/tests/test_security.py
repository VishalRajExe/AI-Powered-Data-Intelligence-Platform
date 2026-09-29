from __future__ import annotations

from fastapi.testclient import TestClient

VALID_KEY = "test-only-shared-key-value-0123456789abcdef"


def test_internal_endpoint_requires_the_shared_key(client: TestClient):
    response = client.get("/ai/v1/ready")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"


def test_a_wrong_key_is_rejected(client: TestClient):
    response = client.get("/ai/v1/ready", headers={"X-API-Key": "almost-right-but-not-the-key"})
    assert response.status_code == 401


def test_a_key_longer_than_the_real_one_is_rejected(client: TestClient):
    # A naive `==` on differing lengths still has to fail; this catches a prefix-comparison bug.
    response = client.get("/ai/v1/ready", headers={"X-API-Key": VALID_KEY + "extra"})
    assert response.status_code == 401


def test_the_correct_key_is_accepted(client: TestClient):
    response = client.get("/ai/v1/ready", headers={"X-API-Key": VALID_KEY})
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "UP"
    assert body["checks"]["providers"]["status"] == "NOT_ATTEMPTED"
    assert body["checks"]["persistence"]["status"] == "NOT_APPLICABLE"


def test_readiness_reports_no_credential_values(client: TestClient):
    response = client.get("/ai/v1/ready", headers={"X-API-Key": VALID_KEY})
    assert VALID_KEY not in response.text
