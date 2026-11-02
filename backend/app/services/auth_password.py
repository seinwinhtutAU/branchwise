"""Setting someone's password directly in Neon Auth's own tables.

Neon Auth (Better Auth) only lets a signed-in person change their *own* password, and only
with the old one, so an admin resetting someone else's has to write the credential row
itself — the same way `delete_user` already removes the auth row directly. The stored form
is Better Auth's own: scrypt (N=16384, r=16, p=1, 64-byte key) over the NFKC-normalised
password, kept as `<salt hex>:<key hex>`, with the salt's hex text used as the salt bytes.
"""

import hashlib
import secrets
import unicodedata

from sqlalchemy import text
from sqlalchemy.orm import Session

_N, _R, _P, _KEY_LEN = 16384, 16, 1, 64


def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    key = hashlib.scrypt(
        unicodedata.normalize("NFKC", password).encode(),
        salt=salt.encode(),
        n=_N,
        r=_R,
        p=_P,
        maxmem=128 * _N * _R * 2,
        dklen=_KEY_LEN,
    )
    return f"{salt}:{key.hex()}"


def verify_password(password: str, stored: str) -> bool:
    salt, _, _ = stored.partition(":")
    return secrets.compare_digest(hash_password(password, salt), stored)


def set_auth_password(db: Session, auth_user_id: str, password: str) -> bool:
    """Replaces the sign-in password and signs the person out everywhere. Returns False when
    the account has no password login to replace."""
    result = db.execute(
        text(
            'UPDATE neon_auth.account SET password = :password, "updatedAt" = now() '
            "WHERE \"userId\" = CAST(:auth_user_id AS uuid) AND \"providerId\" = 'credential'"
        ),
        {"password": hash_password(password), "auth_user_id": auth_user_id},
    )
    if result.rowcount == 0:
        return False
    db.execute(
        text('DELETE FROM neon_auth.session WHERE "userId" = CAST(:auth_user_id AS uuid)'),
        {"auth_user_id": auth_user_id},
    )
    return True
