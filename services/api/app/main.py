from fastapi import FastAPI, Depends, HTTPException, Body, Query
from fastapi.responses import JSONResponse
from app import storage, crypto, telemetry
from app.models import (
    BootstrapIssuerResp, BootstrapHolderResp, BootstrapVerifierResp,
    IssueRequest, IssueResponse, PresentRequest, VerifyRequest,
    VerifyResponse, ChallengeResponse, RevokeRequest,
)
from app.utils import idempotency_required, now_ts
from app.did import generate_did_key
from app.statuslist import StatusListManager
from app.oidc_like import ChallengeManager, PresentationBuilder
from app.settings import Settings

settings = Settings()
telemetry.setup_otel(settings)
app = FastAPI(title="SSI HTTP v1", version="1.0.0")
engine, Session = storage.init_db(settings)
redis = storage.init_redis(settings)
status_mgr = StatusListManager(Session)
challenge_mgr = ChallengeManager(redis)


@app.post("/v1/bootstrap/issuer", response_model=BootstrapIssuerResp)
def bootstrap_issuer(name: str = Query(...)):
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
def issuer_issue(req: IssueRequest, idem_key: str = Depends(storage.get_idem_key)):
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
def issuer_revoke(req: RevokeRequest):
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
