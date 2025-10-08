from pathlib import Path
import sys

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))

from app.main import app, engine, redis


KEYS_DIR = Path("/app/keys")


@pytest.fixture(autouse=True)
def reset_state():
    with engine.begin() as conn:
        conn.execute(
            text(
                "TRUNCATE TABLE credentials, revocations, statuslists, issuers, holders, verifiers "
                "RESTART IDENTITY CASCADE"
            )
        )
    redis.flushdb()
    if KEYS_DIR.exists():
        for key_file in KEYS_DIR.glob("*.json"):
            try:
                key_file.unlink()
            except FileNotFoundError:
                pass
    yield


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_credential_lifecycle(client):
    issuer = client.post("/v1/bootstrap/issuer", params={"name": "Test University"})
    assert issuer.status_code == 200
    issuer_doc = issuer.json()
    issuer_did = issuer_doc["issuer_did"]

    holder = client.post("/v1/bootstrap/holder", params={"label": "Alice"})
    assert holder.status_code == 200
    holder_doc = holder.json()
    holder_did = holder_doc["holder_did"]

    verifier = client.post("/v1/bootstrap/verifier", params={"label": "Verifier"})
    assert verifier.status_code == 200
    verifier_doc = verifier.json()
    verifier_did = verifier_doc["verifier_did"]

    issue_resp = client.post(
        "/v1/issuer/issue",
        headers={"Idempotency-Key": "issue-1"},
        json={
            "subject_did": holder_did,
            "attributes": {"name": "Alice", "status": "student"},
        },
    )
    assert issue_resp.status_code == 200
    credential = issue_resp.json()
    assert credential["issuer"] == issuer_did
    assert credential["subject"] == holder_did

    status_list_id = credential["status"]["list_id"]
    status_before = client.get(f"/v1/issuer/statuslist/{status_list_id}")
    assert status_before.status_code == 200
    status_before_hex = status_before.json()["data"]

    presentation = client.post(
        "/v1/holder/present",
        json={
            "holder_did": holder_did,
            "cred_id": credential["id"],
            "reveal_fields": ["name"],
            "verifier_did": verifier_did,
        },
    )
    assert presentation.status_code == 200
    box = presentation.json()["box"]
    assert set(box.keys()) == {"protected", "eph", "nonce", "ct", "tag"}

    verify = client.post("/v1/verifier/verify", json=box)
    assert verify.status_code == 200
    verified_payload = verify.json()
    assert verified_payload["ok"] is True
    assert verified_payload["disclosed"] == {"name": "Alice"}

    reuse_attempt = client.post("/v1/verifier/verify", json=box)
    assert reuse_attempt.status_code == 400
    assert reuse_attempt.json()["detail"].startswith("challenge invalid")

    revoke = client.post("/v1/issuer/revoke", json={"cred_id": credential["id"]})
    assert revoke.status_code == 200
    assert revoke.json()["ok"] is True

    status_after = client.get(f"/v1/issuer/statuslist/{status_list_id}")
    assert status_after.status_code == 200
    assert status_after.json()["data"] != status_before_hex

    revoked_presentation = client.post(
        "/v1/holder/present",
        json={
            "holder_did": holder_did,
            "cred_id": credential["id"],
            "reveal_fields": ["name"],
            "verifier_did": verifier_did,
        },
    )
    assert revoked_presentation.status_code == 200
    revoked_box = revoked_presentation.json()["box"]

    revoked_attempt = client.post("/v1/verifier/verify", json=revoked_box)
    assert revoked_attempt.status_code == 400
    assert revoked_attempt.json()["detail"] == "credential revoked"


def test_issue_requires_idempotency_header(client):
    issuer = client.post("/v1/bootstrap/issuer", params={"name": "Header Check"})
    assert issuer.status_code == 200
    holder = client.post("/v1/bootstrap/holder", params={"label": "Bob"})
    assert holder.status_code == 200

    response = client.post(
        "/v1/issuer/issue",
        json={
            "subject_did": holder.json()["holder_did"],
            "attributes": {"name": "Bob"},
        },
    )
    assert response.status_code == 428
    assert response.json()["detail"] == "Idempotency-Key header required"
