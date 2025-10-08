from app.crypto import KeyProvider, did_from_jwk_public
from app.models import DIDDoc


def generate_did_key(provider: KeyProvider):
    signing = provider.gen_keypair()
    signing.key_ops = ["sign", "verify"]
    agreement = provider.gen_keypair()
    agreement.key_ops = [
        "deriveKey",
        "deriveBits",
        "wrapKey",
        "unwrapKey",
        "decrypt",
        "encrypt",
    ]
    did = did_from_jwk_public(signing)
    provider.save_key(f"{did}#sign", signing)
    provider.save_key(f"{did}#agree", agreement)
    doc = DIDDoc(
        did=did,
        public_sign=signing.export(as_dict=True)["x"],
        public_agree=agreement.export(as_dict=True)["x"],
        service_endpoint=f"inbox://{did.split(':')[-1][:8]}",
    )
    return did, doc
