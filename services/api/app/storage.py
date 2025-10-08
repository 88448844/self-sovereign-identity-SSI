import json
from typing import Optional

from fastapi import Header, HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.models import DIDDoc
from app.utils import now_ts, merkle_commit

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS issuers (
  did TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  did_doc JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS holders (
  did TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  did_doc JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS verifiers (
  did TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  did_doc JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  schema TEXT NOT NULL,
  attrs JSONB NOT NULL,
  merkle JSONB NOT NULL,
  status JSONB NOT NULL,
  issued_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS revocations (
  list_id TEXT NOT NULL,
  idx INT NOT NULL,
  PRIMARY KEY (list_id, idx)
);
CREATE TABLE IF NOT EXISTS statuslists (
  list_id TEXT PRIMARY KEY,
  issuer TEXT NOT NULL,
  bitmap BYTEA NOT NULL
);
"""


def init_db(settings):
    engine = create_engine(settings.db_dsn, pool_pre_ping=True)
    with engine.begin() as conn:
        for stmt in SCHEMA_SQL.split(";"):
            sql = stmt.strip()
            if sql:
                conn.execute(text(sql))
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    return engine, Session


import redis as _redis


def init_redis(settings):
    return _redis.Redis.from_url(settings.redis_url, decode_responses=True)


def get_idem_key(Idempotency_Key: Optional[str] = Header(None)) -> str:  # noqa: N803
    if not Idempotency_Key:
        raise HTTPException(428, "Idempotency-Key header required")
    return Idempotency_Key


def save_issuer(Session, name, did, did_doc):
    with Session.begin() as session:
        session.execute(
            text(
                "INSERT INTO issuers (did,name,did_doc) VALUES (:d,:n,:doc) "
                "ON CONFLICT (did) DO UPDATE SET name=EXCLUDED.name, did_doc=EXCLUDED.did_doc"
            ),
            {"d": did, "n": name, "doc": json.dumps(did_doc.model_dump())},
        )


def save_holder(Session, label, did, did_doc):
    with Session.begin() as session:
        session.execute(
            text(
                "INSERT INTO holders (did,label,did_doc) VALUES (:d,:l,:doc) "
                "ON CONFLICT (did) DO UPDATE SET label=EXCLUDED.label, did_doc=EXCLUDED.did_doc"
            ),
            {"d": did, "l": label, "doc": json.dumps(did_doc.model_dump())},
        )


def save_verifier(Session, label, did, did_doc):
    with Session.begin() as session:
        session.execute(
            text(
                "INSERT INTO verifiers (did,label,did_doc) VALUES (:d,:l,:doc) "
                "ON CONFLICT (did) DO UPDATE SET label=EXCLUDED.label, did_doc=EXCLUDED.did_doc"
            ),
            {"d": did, "l": label, "doc": json.dumps(did_doc.model_dump())},
        )


def _map_did_doc(row):
    doc = row[2]
    return DIDDoc(**doc) if isinstance(doc, dict) else DIDDoc.model_validate_json(doc)


def get_default_issuer(Session):
    with Session() as session:
        row = session.execute(text("SELECT did, name, did_doc FROM issuers LIMIT 1")).first()
        if not row:
            return None

        class Issuer:
            pass

        obj = Issuer()
        obj.did = row[0]
        obj.did_doc = _map_did_doc(row)
        obj.name = row[1]
        return obj


def get_default_verifier(Session):
    with Session() as session:
        row = session.execute(text("SELECT did, label, did_doc FROM verifiers LIMIT 1")).first()
        if not row:
            return None

        class Verifier:
            pass

        obj = Verifier()
        obj.did = row[0]
        obj.label = row[1]
        obj.did_doc = _map_did_doc(row)
        return obj


def get_holder_by_did(Session, did: str):
    with Session() as session:
        row = session.execute(
            text("SELECT did,label,did_doc FROM holders WHERE did=:d"), {"d": did}
        ).first()
        if not row:
            return None

        class Holder:
            pass

        obj = Holder()
        obj.did = row[0]
        obj.label = row[1]
        obj.did_doc = _map_did_doc(row)
        return obj


def get_verifier_by_did(Session, did: str):
    with Session() as session:
        row = session.execute(
            text("SELECT did,label,did_doc FROM verifiers WHERE did=:d"), {"d": did}
        ).first()
        if not row:
            return None

        class Verifier:
            pass

        obj = Verifier()
        obj.did = row[0]
        obj.label = row[1]
        obj.did_doc = _map_did_doc(row)
        return obj


def create_credential(Session, issuer_did, subject_did, attrs, list_id, index):
    issued_at = now_ts()
    order = sorted(attrs.keys())
    merkle = merkle_commit(attrs, order)
    cred_id = f"cred:{issuer_did}:{index}"
    schema = "example:student-id-v1"
    data = {
        "id": cred_id,
        "issuer": issuer_did,
        "subject": subject_did,
        "schema": schema,
        "attrs": attrs,
        "merkle": merkle,
        "status": {"list_id": list_id, "index": index},
        "issued_at": issued_at,
    }
    with Session.begin() as session:
        session.execute(
            text(
                "INSERT INTO credentials (id,issuer,subject,schema,attrs,merkle,status,issued_at) "
                "VALUES (:id,:iss,:sub,:sch,:a,:m,:st,:ts)"
            ),
            {
                "id": data["id"],
                "iss": issuer_did,
                "sub": subject_did,
                "sch": schema,
                "a": json.dumps(attrs),
                "m": json.dumps(merkle),
                "st": json.dumps(data["status"]),
                "ts": issued_at,
            },
        )
    return data


def get_credential(Session, cred_id: str):
    with Session() as session:
        row = session.execute(
            text(
                "SELECT id,issuer,subject,schema,attrs,merkle,status,issued_at "
                "FROM credentials WHERE id=:id"
            ),
            {"id": cred_id},
        ).first()
        if not row:
            return None
        return {
            "id": row[0],
            "issuer": row[1],
            "subject": row[2],
            "schema": row[3],
            "attrs": row[4],
            "merkle": row[5],
            "status": row[6],
            "issued_at": row[7],
        }


def revoke(Session, cred_id: str):
    with Session.begin() as session:
        row = session.execute(
            text(
                "SELECT status->>'list_id', (status->>'index')::int "
                "FROM credentials WHERE id=:id"
            ),
            {"id": cred_id},
        ).first()
        if not row:
            raise HTTPException(404, "credential not found")
        list_id, idx = row[0], row[1]
        session.execute(
            text(
                "INSERT INTO revocations (list_id, idx) VALUES (:l,:i) "
                "ON CONFLICT DO NOTHING"
            ),
            {"l": list_id, "i": idx},
        )


def health_check(engine):
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
