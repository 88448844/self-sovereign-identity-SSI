# Repository Guidelines

## Project Structure & Module Organization
This reference repo is driven from `docker-compose.yml`, which wires FastAPI, Postgres, and Redis. Application code lives in `services/api/app/` with submodules for persistence (`storage.py`), crypto/KMS (`crypto.py`, `did.py`), HTTP surfaces (`main.py`), and shared utilities (`utils.py`, `telemetry.py`). Pydantic models sit in `app/models.py`. Poetry config is under `services/api/pyproject.toml`. Runtime settings are read from `env/.env`; keep `env/.env.example` authoritative for required keys. Place API or unit tests beside the app in `services/api/tests/`.

## Build, Test, and Development Commands
Use Poetry inside the API container to guarantee dependency parity.
- `docker-compose up --build` – build images and start the full stack locally.
- `docker-compose run --rm api poetry install` – sync dependencies after editing `pyproject.toml`.
- `docker-compose run --rm api poetry run pytest` – execute the Python test suite.
- `docker-compose run --rm api poetry run ruff check app tests` – lint and style check (CI mirrors this).

## Coding Style & Naming Conventions
Follow PEP 8, 4-space indentation, and prefer explicit type hints for service boundaries. Keep module names snake_case and class names PascalCase; HTTP route handlers should read as verbs (`bootstrap_issuer`, `verifier_verify`). Centralize crypto helpers inside `app/crypto.py` and avoid duplicating key-derivation logic elsewhere. Run `poetry run ruff format` (or editor integration) before committing.

## Testing Guidelines
Author tests with `pytest`, using async fixtures for FastAPI routes when needed (`pytest-asyncio` is available). Name files `test_<component>.py` and focus coverage on credential issuance, challenge lifecycles, revocation paths, and encryption/decryption happy-path plus failure cases. Target ≥80% statement coverage; verify locally with `poetry run pytest --cov=app --cov-report=term-missing`.

## Commit & Pull Request Guidelines
Adopt Conventional Commit prefixes (`feat`, `fix`, `refactor`, `docs`, `chore`, `test`). Summaries should highlight the subdomain, e.g., `feat(issuer): enforce idempotency key`. Pull requests must outline context, implementation notes (migrations, new env vars), and validation steps with the commands executed. Keep PRs scoped for focused review and ensure Docker images build successfully before requesting review.

## Security & Configuration Tips
Never commit populated `.env` files; update `env/.env.example` when configuration changes. Choose `KMS=aws` only after supplying AWS credentials via environment variables or a secrets manager. Rotate keys in `services/api/app/keys/` when running demos and mount a persistent volume in production. Enable `OTLP_ENDPOINT` when shipping telemetry and verify TLS per environment.
