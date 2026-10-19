"""Pedidos que chegam pelo CloudFront, e o IP de quem os fez (ADR 0009).

Na AWS, a API (Function URL do Lambda) só deve ser chamada pelo CloudFront:
- o CloudFront junta a cada pedido o cabeçalho `X-Origin-Verify` com um segredo
  (`ORIGIN_VERIFY_SECRET`, no SSM), que quem faz o pedido não conhece;
- uma CloudFront Function escreve em `X-Viewer-IP` o IP que o CloudFront viu, por cima do que o
  cliente tiver enviado (infra/app/api-viewer-ip.js).

O `X-Forwarded-For`, pelo contrário, pode ser inventado por quem faz o pedido, por isso deixa de
contar para os limites de tentativas. Sem o segredo configurado (desenvolvimento, Docker local),
nada muda: o IP é o da ligação.
"""

import hmac

from starlette.datastructures import Headers
from starlette.requests import Request

from app.config import settings

ORIGIN_HEADER = "x-origin-verify"
VIEWER_IP_HEADER = "x-viewer-ip"


def from_cloudfront(headers: Headers) -> bool:
    """O pedido traz o segredo do CloudFront (sempre falso sem segredo configurado)."""
    secret = settings.origin_verify_secret
    if not secret:
        return False
    sent = headers.get(ORIGIN_HEADER, "")
    return hmac.compare_digest(sent.encode(), secret.encode())


def client_ip(request: Request) -> str:
    """O IP para os limites de tentativas: o que o CloudFront viu, ou o da ligação."""
    if from_cloudfront(request.headers) and (viewer_ip := request.headers.get(VIEWER_IP_HEADER)):
        return viewer_ip
    return request.client.host if request.client else "desconhecido"
