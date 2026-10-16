# Imagem de produção: API (FastAPI) + frontend (build do Vite) num só contentor.

# 1) Build do frontend
FROM node:22-slim AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# 2) API em Python com o frontend em /app/static
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

COPY backend/pyproject.toml ./
COPY backend/app ./app
RUN pip install .
COPY backend/alembic.ini ./
COPY backend/alembic ./alembic
COPY --from=frontend /frontend/dist ./static
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Lambda Web Adapter: no AWS Lambda, traduz os eventos do Lambda em pedidos HTTP para o uvicorn,
# por isso a mesma imagem corre no Lambda e em qualquer sítio com Docker (fora do Lambda, a
# extensão é ignorada). https://github.com/awslabs/aws-lambda-web-adapter
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:1.1.0 /lambda-adapter /opt/extensions/lambda-adapter

# Tesseract (OCR das fotografias das faturas), com o português.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-por \
    && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --uid 1000 warrantly

ENV ENVIRONMENT=production \
    STATIC_DIR=/app/static \
    UPLOAD_DIR=/data/uploads \
    PORT=8080 \
    AWS_LWA_READINESS_CHECK_PATH=/api/health/live \
    AWS_LWA_INVOKE_MODE=response_stream
EXPOSE 8080

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["sh", "-c", "exec uvicorn app.server:server --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
