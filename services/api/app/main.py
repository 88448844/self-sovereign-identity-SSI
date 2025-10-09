import json
from pathlib import Path

from fastapi import FastAPI, Depends, HTTPException, Body, Query, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app import storage, crypto, telemetry
from app.models import (
    BootstrapIssuerResp, BootstrapHolderResp, BootstrapVerifierResp,
    IssueRequest, IssueResponse, PresentRequest, VerifyRequest,
    VerifyResponse, ChallengeResponse, RevokeRequest, IssuanceOfferRequest,
    IssuanceOfferResponse, WalletClaimRequest,
)
from app.utils import idempotency_required, now_ts
from app.did import generate_did_key
from app.statuslist import StatusListManager
from app.oidc_like import ChallengeManager, PresentationBuilder
from app.settings import Settings

settings = Settings()
telemetry.setup_otel(settings)
app = FastAPI(title="SSI HTTP v1", version="1.0.0")
origins = [origin.strip() for origin in settings.ui_cors_origins.split(",") if origin.strip()]
if not origins:
    origins = ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
engine, Session = storage.init_db(settings)
redis = storage.init_redis(settings)
status_mgr = StatusListManager(Session)
challenge_mgr = ChallengeManager(redis)


def require_admin(x_admin_token: str = Header(None)):
    expected = settings.issuer_admin_token
    if not expected:
        return
    if x_admin_token != expected:
        raise HTTPException(401, "invalid admin token")


@app.post("/v1/bootstrap/issuer", response_model=BootstrapIssuerResp)
def bootstrap_issuer(name: str = Query(...), _=Depends(require_admin)):
    kp = crypto.KeyProvider(settings)
    did, doc = generate_did_key(kp)
    storage.save_issuer(Session, name, did, doc)
    return BootstrapIssuerResp(issuer_did=did, did_doc=doc)


@app.post("/v1/bootstrap/holder", response_model=BootstrapHolderResp)
def bootstrap_holder(label: str = Query(...)):
    kp = crypto.KeyProvider(settings)
    did, doc = generate_did_key(kp)
    storage.save_holder(Session, label, did, doc)
    return BootstrapHolderResp(holder_did=did, did_doc=doc)


@app.post("/v1/bootstrap/verifier", response_model=BootstrapVerifierResp)
def bootstrap_verifier(label: str = Query(...)):
    kp = crypto.KeyProvider(settings)
    did, doc = generate_did_key(kp)
    storage.save_verifier(Session, label, did, doc)
    return BootstrapVerifierResp(verifier_did=did, did_doc=doc)


@app.post("/v1/issuer/issue", response_model=IssueResponse)
@idempotency_required
def issuer_issue(
    req: IssueRequest,
    idem_key: str = Depends(storage.get_idem_key),
    _=Depends(require_admin),
):
    issuer = storage.get_default_issuer(Session)
    if not issuer:
        raise HTTPException(400, "no issuer configured")
    list_id, index = status_mgr.allocate(issuer.did)
    cred = storage.create_credential(Session, issuer.did, req.subject_did, req.attributes, list_id, index)
    jws = crypto.sign_vc_jws(issuer.did, cred, settings)
    return IssueResponse(**cred, issuer_signature=jws)


@app.get("/v1/issuer/statuslist/{list_id}")
def issuer_status_list(list_id: str):
    doc = status_mgr.publish(list_id)
    return JSONResponse(doc)


@app.post("/v1/issuer/revoke")
def issuer_revoke(req: RevokeRequest, _=Depends(require_admin)):
    storage.revoke(Session, req.cred_id)
    return {"ok": True}


@app.post("/v1/verifier/challenge", response_model=ChallengeResponse)
def verifier_challenge(aud: str = Body(..., embed=True)):
    ch = challenge_mgr.issue(aud)
    return ch


@app.post("/v1/verifier/verify", response_model=VerifyResponse)
def verifier_verify(req: VerifyRequest):
    verifier = storage.get_default_verifier(Session)
    if not verifier:
        raise HTTPException(400, "no verifier configured")
    plaintext = crypto.jwe_decrypt_for_did(
        req.protected,
        req.eph,
        req.nonce,
        req.ct,
        req.tag,
        verifier.did,
        settings,
    )
    result = PresentationBuilder.verify_and_extract(plaintext, challenge_mgr, status_mgr, Session, settings)
    return result


@app.post("/v1/holder/present")
def holder_present(req: PresentRequest):
    holder = storage.get_holder_by_did(Session, req.holder_did)
    verifier = storage.get_verifier_by_did(Session, req.verifier_did)
    if not holder or not verifier:
        raise HTTPException(400, "unknown holder or verifier")
    cred = storage.get_credential(Session, req.cred_id)
    if not cred or cred["subject"] != req.holder_did:
        raise HTTPException(400, "credential not found or not owned by holder")
    pres = PresentationBuilder.build(
        holder_doc=holder.did_doc,
        verifier_doc=verifier.did_doc,
        credential=cred,
        reveal_fields=req.reveal_fields,
        challenge_mgr=challenge_mgr,
        settings=settings,
    )
    return {"box": pres}


@app.get("/healthz")
def healthz():
    storage.health_check(engine)
    return {"ok": True, "ts": now_ts()}


@app.get("/readyz")
def readyz():
    return {"ok": True}


@app.post("/v1/admin/reset")
def admin_reset(_=Depends(require_admin)):
    storage.reset_state(Session)
    redis.flushdb()
    kp = crypto.KeyProvider(settings)
    keys_dir = Path(kp.store_dir)
    if keys_dir.exists():
        for key_file in keys_dir.glob("*.json"):
            try:
                key_file.unlink()
            except FileNotFoundError:
                continue
    return {"ok": True}


@app.get("/v1/holder/credentials/{holder_did}")
def holder_credentials(holder_did: str):
    records = storage.list_credentials_for_holder(Session, holder_did)
    return {"credentials": records}


@app.post("/v1/issuer/offers", response_model=IssuanceOfferResponse)
def issuer_register_offer(req: IssuanceOfferRequest, _=Depends(require_admin)):
    payload = req.model_dump()
    ttl = req.ttl_seconds or 600
    redis.setex(f"offer:{req.challenge}", ttl, json.dumps(payload))
    return IssuanceOfferResponse(ok=True, challenge=req.challenge, ttl_seconds=ttl)


@app.post("/v1/wallet/claim", response_model=IssueResponse)
def wallet_claim(req: WalletClaimRequest):
    cached = redis.get(f"offer:{req.challenge}")
    if not cached:
        raise HTTPException(404, "offer not found or expired")
    offer = json.loads(cached)
    issuer = storage.get_issuer_by_did(Session, offer["issuer_did"])
    if not issuer:
        raise HTTPException(400, "issuer referenced in offer not available")
    holder = storage.get_holder_by_did(Session, req.holder_did)
    if not holder:
        raise HTTPException(400, "holder not registered")
    claims = offer.get("claims", {})
    missing = [key for key, required in claims.items() if required and key not in req.attributes]
    if missing:
        raise HTTPException(400, f"missing attributes for claims: {', '.join(missing)}")
    list_id, index = status_mgr.allocate(issuer.did)
    cred = storage.create_credential(
        Session,
        issuer.did,
        req.holder_did,
        req.attributes,
        list_id,
        index,
    )
    jws = crypto.sign_vc_jws(issuer.did, cred, settings)
    redis.delete(f"offer:{req.challenge}")
    return IssueResponse(**cred, issuer_signature=jws)
