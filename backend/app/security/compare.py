import hmac


def constant_time_equals(a: str, b: str) -> bool:
    """Compare two secrets (tokens, hashes) without leaking timing
    information about where they first differ. Plain `==` short-circuits
    on the first mismatched byte, which an attacker can exploit to guess
    a secret one byte at a time by measuring response time. Not yet
    called anywhere this session — establishing the pattern ahead of the
    extension-token hash comparison in a later session.
    """
    return hmac.compare_digest(a.encode(), b.encode())
