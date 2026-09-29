FROM python:3.12-slim

# 3.12 is the pinned deployment interpreter (docs/audit/K-environment-variables.md).
RUN useradd --system --create-home --uid 10001 finalagent

WORKDIR /app

# Base install only. The `collection` extra (google-genai, firecrawl) belongs to the
# Phase 2 provider spike; installing it here would pull provider SDKs into a skeleton
# that makes no provider calls.
COPY pyproject.toml ./
COPY app ./app
RUN pip install --no-cache-dir .

USER finalagent
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

# A raised exception exits non-zero, which is what marks the container unhealthy.
HEALTHCHECK --interval=15s --timeout=4s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import urllib.request,sys;sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/ai/v1/health',timeout=3).status==200 else 1)"]

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
