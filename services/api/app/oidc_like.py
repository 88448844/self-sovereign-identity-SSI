import json
import os

from app.utils import b64url, now_ts
from app.crypto import jwe_encrypt_for_did


class ChallengeManager:
    def __init__(self, redis):
        self.redis = redis

    def issue(self, aud: str):
        nonce = b64url(os.urandom(12))
        exp = now_ts() + 300
        self.redis.setex(f"ch:{nonce}", 300, json.dumps({"aud": aud, "exp": exp}))
        return {"nonce": nonce, "aud": aud, "exp": exp}

    def validate(self, nonce: str, aud: str):
        value = self.redis.get(f"ch:{nonce}")
        if not value:
            return False, "nonce not found"
        doc = json.loads(value)
        if doc["aud"] != aud:
            return False, "aud mismatch"
        if doc["exp"] < now_ts():
            return False, "expired"
        self.redis.delete(f"ch:{nonce}")
        return True, "ok"


class PresentationBuilder:
    @staticmethod
    def build(holder_doc, verifier_doc, credential, reveal_fields, challenge_mgr, settings):
        order = credential["merkle"]["order"]
        proofs = credential["merkle"]["paths"]
        revealed = {
            key: credential["attrs"][key]
            for key in reveal_fields
            if key in credential["attrs"]
        }
        payload = {
            "aud": verifier_doc.did,
            "iat": now_ts(),
            "exp": now_ts() + 300,
            "nonce": PresentationBuilder._ensure_nonce(challenge_mgr, verifier_doc.did),
            "cred": {
                "id": credential["id"],
                "issuer": credential["issuer"],
                "subject": credential["subject"],
                "schema": credential["schema"],
                "status": credential["status"],
                "root": credential["merkle"]["root"],
                "order": order,
                "proofs": proofs,
                "revealed": revealed,
            },
        }
        plaintext = json.dumps(payload).encode()
        return jwe_encrypt_for_did(plaintext, verifier_doc, settings)

    @staticmethod
    def _ensure_nonce(challenge_mgr, aud):
        challenge = challenge_mgr.issue(aud)
        return challenge["nonce"]

    @staticmethod
    def verify_and_extract(plaintext, challenge_mgr, status_mgr, Session, settings):
        doc = json.loads(plaintext)
        ok, why = challenge_mgr.validate(doc["nonce"], doc["aud"])
        if not ok:
            from fastapi import HTTPException

            raise HTTPException(400, f"challenge invalid: {why}")

        cred = doc["cred"]
        list_id = cred["status"]["list_id"]
        idx = int(cred["status"]["index"])
        if status_mgr.is_revoked(list_id, idx):
            from fastapi import HTTPException

            raise HTTPException(400, "credential revoked")

        from app.utils import verify_merkle_proofs

        if not verify_merkle_proofs(
            cred["root"], cred["order"], cred["proofs"], cred["revealed"]
        ):
            from fastapi import HTTPException

            raise HTTPException(400, "merkle proof failed")
        return {"ok": True, "message": "verified OK", "disclosed": cred["revealed"]}
