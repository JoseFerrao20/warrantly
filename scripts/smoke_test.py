"""Verificações rápidas de uma Warrantly publicada (só com a biblioteca padrão do Python).

Corre no fim do deploy, contra o CloudFront, e no CI do Docker, contra o contentor:

    python3 scripts/smoke_test.py https://<id>.cloudfront.net
    python3 scripts/smoke_test.py http://localhost:8080 --no-rate-limit

Confirma o que antes se via à mão (docs/cloud.md, "Verificações"): a API e a base de dados
respondem, os cabeçalhos de segurança, o /api/docs fechado, a rota dos eventos agendados
fechada a pedidos de fora, o cookie da sessão (Secure, HttpOnly, SameSite=Strict) e o limite
de tentativas de login. Cria uma conta `smoke-…@example.com` e apaga-a no fim.
"""

import argparse
import json
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from http.cookies import SimpleCookie

REFRESH_COOKIE = "warrantly_refresh"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


opener = urllib.request.build_opener(NoRedirect)


class Response:
    def __init__(self, status: int, headers, body: bytes) -> None:
        self.status = status
        self.headers = headers
        self.body = body

    def json(self):
        return json.loads(self.body)

    def text(self) -> str:
        return self.body.decode("utf-8", errors="replace")


class Smoke:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.failures: list[str] = []

    def request(
        self,
        method: str,
        path: str,
        *,
        json_body=None,
        form=None,
        headers: dict[str, str] | None = None,
    ) -> Response:
        headers = dict(headers or {})
        data = None
        if json_body is not None:
            data = json.dumps(json_body).encode()
            headers["Content-Type"] = "application/json"
        elif form is not None:
            data = urllib.parse.urlencode(form).encode()
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        url = self.base_url + path
        req = urllib.request.Request(url, data=data, headers=headers, method=method)  # noqa: S310 (main: só http/https)
        try:
            with opener.open(req, timeout=30) as resp:
                return Response(resp.status, resp.headers, resp.read())
        except urllib.error.HTTPError as exc:
            return Response(exc.code, exc.headers, exc.read())

    def check(self, ok: bool, name: str, detail: str = "") -> bool:
        if ok:
            print(f"ok    {name}")
        else:
            print(f"FALHA {name}" + (f": {detail}" if detail else ""))
            self.failures.append(name)
        return ok

    # --- verificações ---

    def wait_until_up(self, attempts: int = 6, delay: float = 10) -> bool:
        """O primeiro pedido acorda o Lambda e o Neon: pode demorar alguns segundos."""
        last = ""
        for attempt in range(attempts):
            try:
                resp = self.request("GET", "/api/health")
                if resp.status == 200 and resp.json().get("db") == "ok":
                    return self.check(True, "API e base de dados (/api/health)")
                last = f"{resp.status} {resp.text()[:200]}"
            except OSError as exc:
                last = str(exc)
            if attempt < attempts - 1:
                time.sleep(delay)
        return self.check(False, "API e base de dados (/api/health)", last)

    def frontend_and_headers(self) -> None:
        resp = self.request("GET", "/")
        self.check(
            resp.status == 200 and "<title>Warrantly</title>" in resp.text(),
            "frontend na raiz",
            f"{resp.status}",
        )
        csp = resp.headers.get("Content-Security-Policy", "")
        directives = {part.split()[0]: part.split()[1:] for part in csp.split(";") if part.strip()}
        self.check(
            directives.get("script-src") == ["'self'"],
            "CSP sem scripts inline nem de outros sites",
            csp or "sem Content-Security-Policy",
        )
        self.check(
            directives.get("frame-ancestors") == ["'none'"],
            "CSP não deixa a app abrir dentro de outro site",
            csp or "sem Content-Security-Policy",
        )
        hsts = resp.headers.get("Strict-Transport-Security", "")
        max_age = next(
            (
                int(part.split("=", 1)[1])
                for part in hsts.split(";")
                if part.strip().startswith("max-age=") and part.split("=", 1)[1].isdigit()
            ),
            0,
        )
        self.check(max_age >= 31536000, "HSTS de um ano ou mais", hsts or "sem HSTS")
        for header, expected in [
            ("X-Content-Type-Options", "nosniff"),
            ("X-Frame-Options", "DENY"),
            ("Referrer-Policy", "no-referrer"),
        ]:
            value = resp.headers.get(header, "")
            self.check(value.lower() == expected.lower(), f"{header}: {expected}", value)

        page = self.request("GET", "/compras/1")
        self.check(
            page.status == 200 and "<title>Warrantly</title>" in page.text(),
            "rotas do frontend (/compras/1) devolvem a app",
            f"{page.status}",
        )

    def closed_routes(self) -> None:
        for path in ["/api/docs", "/api/openapi.json"]:
            resp = self.request("GET", path)
            self.check(resp.status == 404, f"{path} fechado (404)", f"{resp.status}")
        resp = self.request("POST", "/api/internal/events", json_body={"task": "alerts"})
        self.check(
            resp.status == 403,
            "eventos agendados recusados a pedidos de fora (403)",
            f"{resp.status} {resp.text()[:200]}",
        )

    def session_cycle(self) -> None:
        email = f"smoke-{secrets.token_hex(6)}@example.com"
        password = secrets.token_urlsafe(18)
        resp = self.request(
            "POST", "/api/auth/register", json_body={"email": email, "password": password}
        )
        if not self.check(resp.status == 201, "criar conta", f"{resp.status} {resp.text()}"):
            return
        token = None
        try:
            resp = self.request(
                "POST", "/api/auth/login", form={"username": email, "password": password}
            )
            if not self.check(resp.status == 200, "entrar", f"{resp.status} {resp.text()}"):
                return
            token = resp.json()["access_token"]
            self.check(
                "refresh_token" not in resp.json(),
                "no browser, o refresh token não vem no corpo",
            )
            cookie = self.refresh_cookie(resp)
            if not self.check(cookie is not None, f"cookie {REFRESH_COOKIE}", "não veio"):
                return
            self.check(bool(cookie["secure"]), "cookie com Secure")
            self.check(bool(cookie["httponly"]), "cookie com HttpOnly")
            self.check(cookie["samesite"].lower() == "strict", "cookie com SameSite=Strict")
            self.check(cookie["path"] == "/api/auth", "cookie só para /api/auth", cookie["path"])

            me = self.request("GET", "/api/auth/me", headers=self.bearer(token))
            self.check(
                me.status == 200 and me.json().get("email") == email,
                "a API reconhece o token de acesso",
                f"{me.status}",
            )
            anon = self.request("GET", "/api/purchases")
            self.check(anon.status == 401, "sem token, as compras dão 401", f"{anon.status}")

            renewed = self.request(
                "POST",
                "/api/auth/refresh",
                headers={"Cookie": f"{REFRESH_COOKIE}={cookie.value}"},
            )
            if self.check(
                renewed.status == 200, "renovar a sessão com o cookie", f"{renewed.status}"
            ):
                token = renewed.json()["access_token"]
                new_cookie = self.refresh_cookie(renewed)
                self.check(
                    new_cookie is not None and new_cookie.value != cookie.value,
                    "a renovação troca o refresh token (rotação)",
                )
        finally:
            if token:
                gone = self.request(
                    "DELETE",
                    "/api/auth/me",
                    json_body={"password": password},
                    headers=self.bearer(token),
                )
                self.check(gone.status == 204, "apagar a conta de teste", f"{gone.status}")
            else:
                print(f"AVISO a conta {email} não foi apagada (sem token)")

    def rate_limit(self, attempts: int = 10) -> None:
        """Logins errados seguidos acabam em 429.

        O limite está em memória em cada instância do Lambda (ver app/rate_limit.py): com
        pedidos seguidos responde quase sempre a mesma, mas não é garantido, por isso
        aceita-se o 429 em qualquer das `attempts` tentativas (5 falhas chegam numa).
        """
        email = f"smoke-{secrets.token_hex(6)}@example.com"
        statuses = []
        for _ in range(attempts):
            resp = self.request(
                "POST", "/api/auth/login", form={"username": email, "password": "errada"}
            )
            statuses.append(resp.status)
            if resp.status == 429:
                break
        self.check(
            statuses[-1] == 429 and "Demasiadas tentativas" in resp.text(),
            "logins errados seguidos dão 429 (Demasiadas tentativas)",
            f"respostas: {statuses}",
        )

    # --- ajudas ---

    @staticmethod
    def bearer(token: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {token}"}

    @staticmethod
    def refresh_cookie(resp: Response):
        for header in resp.headers.get_all("Set-Cookie") or []:
            jar = SimpleCookie()
            jar.load(header)
            if REFRESH_COOKIE in jar:
                return jar[REFRESH_COOKIE]
        return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("base_url", help="endereço da app, ex.: https://<id>.cloudfront.net")
    parser.add_argument(
        "--no-rate-limit",
        action="store_true",
        help="não verificar o limite de tentativas (para uma API com RATE_LIMITS=false)",
    )
    args = parser.parse_args(argv)
    if urllib.parse.urlsplit(args.base_url).scheme not in ("http", "https"):
        parser.error("o endereço tem de começar por http:// ou https://")

    smoke = Smoke(args.base_url)
    print(f"Verificações em {smoke.base_url}")
    if smoke.wait_until_up():
        smoke.frontend_and_headers()
        smoke.closed_routes()
        smoke.session_cycle()
        if not args.no_rate_limit:
            smoke.rate_limit()

    if smoke.failures:
        print(f"\n{len(smoke.failures)} verificação(ões) falharam.")
        return 1
    print("\nTudo certo.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
