from pydantic import BaseModel, ConfigDict, Field
from typing import Dict, List


class DIDDoc(BaseModel):
    did: str
    public_sign: str
    public_agree: str
    service_endpoint: str


class BootstrapIssuerResp(BaseModel):
    issuer_did: str
    did_doc: DIDDoc


class BootstrapHolderResp(BaseModel):
    holder_did: str
    did_doc: DIDDoc


class BootstrapVerifierResp(BaseModel):
    verifier_did: str
    did_doc: DIDDoc


class IssueRequest(BaseModel):
    subject_did: str
    attributes: Dict[str, object]


class IssueResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, protected_namespaces=())
    id: str
    issuer: str
    subject: str
    schema_id: str = Field(alias="schema")
    attrs: Dict[str, object]
    merkle: Dict[str, object]
    status: Dict[str, object]
    issued_at: int
    issuer_signature: str

    @property
    def schema(self) -> str:
        return self.schema_id


class RevokeRequest(BaseModel):
    cred_id: str


class PresentRequest(BaseModel):
    holder_did: str
    cred_id: str
    reveal_fields: List[str]
    verifier_did: str


class VerifyRequest(BaseModel):
    protected: str
    eph: str
    nonce: str
    ct: str
    tag: str


class ChallengeResponse(BaseModel):
    nonce: str
    aud: str
    exp: int


class VerifyResponse(BaseModel):
    ok: bool
    message: str
    disclosed: Dict[str, object]


class IssuanceOfferRequest(BaseModel):
    challenge: str
    issuer_did: str
    claims: Dict[str, bool]
    ttl_seconds: int | None = 600


class IssuanceOfferResponse(BaseModel):
    ok: bool
    challenge: str
    ttl_seconds: int


class WalletClaimRequest(BaseModel):
    challenge: str
    holder_did: str
    attributes: Dict[str, object]
