from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Sets response headers defending against the common browser-side
    attacks even though this is a JSON API (defense in depth for any
    client that renders responses, and for the frontend once it's added):

    - CSP `default-src 'none'`: this API never serves HTML/JS, so nothing
      needs a source allowance. Loosen deliberately if that changes.
    - HSTS: tells browsers to only ever use HTTPS for this host, blocking
      downgrade attacks after the first visit.
    - X-Content-Type-Options: nosniff: stops browsers guessing a
      different (executable) content type than the one we declared.
    - X-Frame-Options: DENY: blocks embedding in an iframe (clickjacking).
    - Referrer-Policy: no-referrer: don't leak this API's URLs (which may
      contain sensitive paths) to third parties via the Referer header.
    """

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response
