Thank you for your interest in contributing to this SSI reference project.

Guidelines
- Follow Conventional Commits: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`.
- Tests: add pytest tests under `services/api/tests/`. Prefer small, focused tests.
- Formatting: run `poetry run ruff format` (or `ruff format`) before committing.
- PRs: keep them small and include acceptance steps (build & tests).

Development flow
1. Fork the repository and create a feature branch.
2. Run unit tests and linters locally.
3. Open a pull request describing the change, tests added, and any migrations or new env vars.

Security
- Never commit secrets or `env/.env` files. Add them to `.gitignore` and use environment variables or secret managers.
