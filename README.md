# SSI HTTP Production Reference (FastAPI)

A compact, production-minded FastAPI reference implementation demonstrating core SSI flows: issuer/holder/verifier bootstrapping, credential issuance, presentation, and verification. This repository is intended as a deployable reference (demo-grade) — do not expose secrets or the local key storage to the public internet.

Status: Prototype / reference — audit and adapt before production use.

## Quickstart

Clone, populate environment, and run with Docker Compose:

```powershell
# clone the repository and run from the project root
git clone https://github.com/88448844/self-sovereign-identity-SSI.git
cd self-sovereign-identity-SSI
cp env/.env.example env/.env
docker-compose up --build
```

Open http://localhost:8000/docs for the OpenAPI explorer, http://localhost:5173 for the combined demo UI, and the role-based portals:

- Issuer portal: http://localhost:5174
- Wallet app: http://localhost:5175
- Verifier kiosk: http://localhost:5176

## Core flow
1. Bootstrap issuer, holder, and verifier services.
2. Issue a credential via `POST /v1/issuer/issue` with a subject DID and attributes.
3. Create a verification challenge with `POST /v1/verifier/challenge` (optionally include `{"aud":"<verifier-did>"}`).
4. Holder presents with `POST /v1/holder/present` including `reveal_fields`.
5. Verifier verifies with `POST /v1/verifier/verify` using the returned `{protected, eph, nonce, ct, tag}` payload.
6. Demo reset helper: `POST /v1/admin/reset` truncates the database, flushes Redis, and clears generated keys (requires the issuer admin token; the UIs surface this as a “Reset state” button).
7. Issuance offers: `POST /v1/issuer/offers` registers a short-lived issuance challenge in Redis for wallets to redeem via `POST /v1/wallet/claim`.

## Important notes
- Keys in this demo are stored locally at `services/api/app/keys/`. Replace with a secure KMS (AWS KMS, GCP KMS, or similar) for production.
- Merkle-proof code here is illustrative. Replace with a production-grade inclusion proof (e.g., Poseidon/Keccak tree) or adopt an appropriate standard like SD-JWT VC.
- The JWE shape uses JOSE (ECDH-ES + A256GCM) to deliver encrypted payloads compatible with the verifier's `#agree` key.
- This reference does not provide TLS/mTLS, WAF, or authentication. Put a hardened API gateway and strong access controls in front of any production deployment.

## Development
- Python managed with Poetry (see `services/api/pyproject.toml`).
- Run tests and linters inside the API container or locally via Poetry.

Common commands (inside the repo root):

```powershell
# run the full stack (Docker)
docker-compose up --build

# run tests locally (inside container recommended)
docker-compose run --rm api poetry run pytest

docker-compose run --rm api poetry run ruff check app tests
```

## Project layout
- `services/api/app/` — FastAPI application code (routes, crypto helpers, storage, models).
- `env/` — runtime config and env var examples (`env/.env.example`).
- `services/api/tests/` — pytest-based integration tests.
- `services/demo-ui/` — optional React demo that exercises the flows (Vite + Tailwind).
- `services/issuer-ui/`, `se

## Contributing
See `CONTRIBUTING.md` for development guidelines, tests, and commit conventions.

## License
This project is licensed under the MIT License — see `LICENSE`.
