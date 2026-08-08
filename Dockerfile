FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY pyproject.toml ./
COPY cosmy ./cosmy
RUN pip install --no-cache-dir . && \
    groupadd --system router && \
    useradd --system --gid router --no-create-home router

COPY migrations ./migrations
USER router
EXPOSE 8080

CMD ["uvicorn", "cosmy.app:app", "--host", "0.0.0.0", "--port", "8080", "--loop", "uvloop", "--http", "httptools", "--no-access-log"]
