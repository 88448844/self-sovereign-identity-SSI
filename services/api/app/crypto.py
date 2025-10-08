import base64
import json
import os

from jwcrypto import jwk, jwe, jws
from app.settings import Settings
from app.models import DIDDoc
class KeyProvider:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.store_dir = "/app/keys" if settings.env != "dev" else "/app/keys"
        os.makedirs(self.store_dir, exist_ok=True)

    def gen_keypair(self):
        return jwk.JWK.generate(kty="EC", crv=self.settings.jwk_curve)

    def save_key(self, kid: str, key: jwk.JWK):
        with open(os.path.join(self.store_dir, f"{kid}.json"), "w", encoding="utf-8") as handle:
            handle.write(key.export(private_key=True))

    def load_key(self, kid: str) -> jwk.JWK:
        with open(os.path.join(self.store_dir, f"{kid}.json"), encoding="utf-8") as handle:
            return jwk.JWK.from_json(handle.read())


def did_from_jwk_public(key: jwk.JWK) -> str:
    pub = key.export(as_dict=True)
    x = base64.urlsafe_b64decode(pub["x"] + "==")
    y = base64.urlsafe_b64decode(pub["y"] + "==")
    fingerprint = base64.urlsafe_b64encode(x + y).decode().rstrip("=")
    return f"did:key:z{fingerprint[:46]}"


def sign_vc_jws(issuer_did: str, credential: dict, settings: Settings) -> str:
    kid = f"{issuer_did}#sign"
    provider = KeyProvider(settings)
    try:
        key = provider.load_key(kid)
    except FileNotFoundError:
        key = provider.gen_keypair()
        key.key_ops = ["sign", "verify"]
        provider.save_key(kid, key)
    token = jws.JWS(json.dumps(credential).encode())
    token.add_signature(
        key,
        None,
        json.dumps({"alg": "ES256", "kid": kid}),
        json.dumps({"typ": "JWT"}),
    )
    return token.serialize(compact=True)


def jwe_encrypt_for_did(plaintext: bytes, verifier_doc: DIDDoc, settings: Settings) -> dict:
    kid = f"{verifier_doc.did}#agree"
    provider = KeyProvider(settings)
    try:
        agree_key = provider.load_key(kid)
    except FileNotFoundError as exc:
        raise RuntimeError(f"no agreement key available for {verifier_doc.did}") from exc
    pub = jwk.JWK.from_json(agree_key.export(private_key=False))
    protected = {"alg": settings.jwe_alg, "enc": settings.jwe_enc}
    envelope = jwe.JWE(plaintext=plaintext, protected=protected)
    envelope.add_recipient(pub)
    compact = envelope.serialize(compact=True)
    parts = compact.split(".")
    return {
        "protected": parts[0],
        "eph": parts[1],
        "nonce": parts[2],
        "ct": parts[3],
        "tag": parts[4],
    }


def jwe_decrypt_for_did(
    protected: str,
    eph: str,
    nonce: str,
    ct: str,
    tag: str,
    verifier_did: str,
    settings: Settings,
) -> bytes:
    kid = f"{verifier_did}#agree"
    provider = KeyProvider(settings)
    try:
        key = provider.load_key(kid)
    except FileNotFoundError:
        key = provider.gen_keypair()
        key.key_ops = [
            "deriveKey",
            "deriveBits",
            "wrapKey",
            "unwrapKey",
            "decrypt",
            "encrypt",
        ]
        provider.save_key(kid, key)
    compact = ".".join([protected, eph, nonce, ct, tag])
    envelope = jwe.JWE()
    envelope.deserialize(compact)
    envelope.decrypt(key)
    return envelope.payload
