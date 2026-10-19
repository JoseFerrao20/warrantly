# Imagem de produção: API (FastAPI) + frontend (build do Vite) num só contentor.

# 1) Build do frontend
FROM node:26-slim AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# 2) API em Python com o frontend em /app/static (o CI testa esta fase: --target app)
FROM python:3.12-slim AS app
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
    AWS_LWA_INVOKE_MODE=response_stream \
    AWS_LWA_PASS_THROUGH_PATH=/api/internal/events
EXPOSE 8080

# Fora do Lambda (docker run, Docker Compose), o Docker sabe se a app está viva.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"PORT\"]}/api/health/live', timeout=4)"

ENTRYPOINT ["docker-entrypoint.sh"]
# Sem o log de acessos do uvicorn: a app escreve uma linha por pedido, em JSON e com o id do
# pedido (app/observability.py).
CMD ["sh", "-c", "exec uvicorn app.server:server --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*' --no-access-log"]

# 3) A mesma imagem com o Lambda Web Adapter: no AWS Lambda, traduz os eventos do Lambda em
# pedidos HTTP para o uvicorn (fora do Lambda, a extensão é ignorada). Fica numa fase à parte
# porque os pulls anónimos do public.ecr.aws têm limites que os runners partilhados do GitHub
# atingem; o deploy constrói esta fase depois de entrar na AWS.
# https://github.com/awslabs/aws-lambda-web-adapter
FROM app AS lambda
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:1.1.0 /lambda-adapter /opt/extensions/lambda-adapter
