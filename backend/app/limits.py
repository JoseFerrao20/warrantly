"""Limite ao tamanho do corpo dos pedidos.

O Starlette guarda os ficheiros enviados (multipart) antes de a rota os ver, sem limite de
tamanho, por isso a verificação dos 10 MB na rota da fatura chegava tarde: um pedido enorme
enchia o disco. Este middleware corta o pedido mal passa o limite, mesmo sem Content-Length.
"""

from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

TOO_LARGE = "O pedido é demasiado grande"


class MaxBodySizeMiddleware:
    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = dict(scope["headers"])
        content_length = headers.get(b"content-length")
        if content_length is not None and content_length.isdigit():
            if int(content_length) > self.max_bytes:
                # Ainda fora da app: responde já, sem ler o corpo.
                response = JSONResponse({"detail": TOO_LARGE}, status_code=413)
                await response(scope, receive, send)
                return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    # Dentro da rota (a ler o corpo): vira uma resposta 413 normal.
                    raise HTTPException(413, detail=TOO_LARGE)
            return message

        await self.app(scope, limited_receive, send)
