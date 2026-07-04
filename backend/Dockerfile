FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

# Dependency files first: this layer is cached and only rebuilds when
# pyproject.toml or uv.lock change, not on every application code edit.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

COPY app ./app

RUN uv sync --frozen --no-dev

ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 8000

# Invoke the pre-built venv directly rather than `uv run`, which re-syncs
# against pyproject.toml (including dev dependencies) on every container
# start and would silently undo the --no-dev install above.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
