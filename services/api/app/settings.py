import os
from pydantic import BaseModel


class Settings(BaseModel):
    db_dsn: str = os.getenv("DB_DSN", "postgresql+psycopg2://ssi:ssi@db:5432/ssi")
    redis_url: str = os.getenv("REDIS_URL", "redis://redis:6379/0")
    env: str = os.getenv("ENV", "dev")
    issuer_default_name: str = os.getenv("ISSUER_DEFAULT_NAME", "Example University")
    kms: str = os.getenv("KMS", "local")
    jwk_curve: str = os.getenv("JWK_CURVE", "P-256")
    jwe_alg: str = os.getenv("JWE_ALG", "ECDH-ES")
    jwe_enc: str = os.getenv("JWE_ENC", "A256GCM")
    otlp_endpoint: str = os.getenv("OTLP_ENDPOINT", "")
    statuslist_chunk: int = int(os.getenv("STATUSLIST_CHUNK", "16384"))
    service_endpoint_prefix: str = os.getenv("SERVICE_PREFIX", "inbox://")
