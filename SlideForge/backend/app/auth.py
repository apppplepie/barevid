import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Depends, Header, HTTPException

from app.config import settings
from sqlalchemy import func
from sqlmodel import delete, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.db.engine import get_session
from app.db.models import AuthSession, User, utc_now


def _as_utc_aware(dt: datetime) -> datetime:
    """SQLite 等读出的 datetime 常为 naive，与 utc_now() 比较前统一为 UTC aware。"""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)

_PBKDF2_ROUNDS = 120_000
# 仅在显式开启 legacy_dev_auth_enabled 时才允许该遗留开发令牌。
_LEGACY_DEV_TOKEN = "legacy"
_DEV_LOCAL_USERNAMES = ("dev", "legacy")


def _pbkdf2_hex(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        _PBKDF2_ROUNDS,
    ).hex()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = _pbkdf2_hex(password, salt)
    return f"pbkdf2_sha256${_PBKDF2_ROUNDS}${base64.b64encode(salt).decode()}${digest}"


def verify_password(password: str, password_hash: str) -> bool:
    try:
        algo, rounds_str, salt_b64, digest = password_hash.split("$", 3)
        if algo != "pbkdf2_sha256":
            return False
        rounds = int(rounds_str)
        salt = base64.b64decode(salt_b64.encode())
    except Exception:
        return False
    check = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        rounds,
    ).hex()
    return hmac.compare_digest(check, digest)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def create_session_token(session: AsyncSession, user_id: int) -> str:
    raw = secrets.token_urlsafe(32)
    now = utc_now()
    row = AuthSession(
        user_id=user_id,
        token_hash=_hash_token(raw),
        expires_at=now + timedelta(days=max(1, settings.auth_session_ttl_days)),
        created_at=now,
    )
    session.add(row)
    await session.commit()
    return raw


async def delete_session_token(session: AsyncSession, token: str) -> None:
    await session.exec(delete(AuthSession).where(AuthSession.token_hash == _hash_token(token)))
    await session.commit()


async def _dev_bearer_user(session: AsyncSession) -> User:
    """解析开发用 Bearer（与 JWT 无关）：只认系统占位账号，避免 id=1 或同名正式用户被误当成开发身份。"""
    marker_hashes = ("disabled", "legacy-dev-bypass")
    for uname in _DEV_LOCAL_USERNAMES:
        res = await session.exec(
            select(User).where(
                func.lower(User.username) == uname,
                User.password_hash.in_(marker_hashes),
            )
        )
        row = res.first()
        if row is not None:
            return row
    now = utc_now()
    row = User(
        username=_DEV_LOCAL_USERNAMES[0],
        password_hash="legacy-dev-bypass",
        created_at=now,
        updated_at=now,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def get_current_user(
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="未登录")
    token = authorization[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="未登录")
    if settings.legacy_dev_auth_enabled and token == _LEGACY_DEV_TOKEN:
        return await _dev_bearer_user(session)
    now = utc_now()
    res = await session.exec(
        select(AuthSession).where(AuthSession.token_hash == _hash_token(token))
    )
    ss = res.first()
    if ss is None or _as_utc_aware(ss.expires_at) <= now:
        raise HTTPException(status_code=401, detail="登录已失效，请重新登录")
    user = await session.get(User, ss.user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="用户不存在")
    return user


def verify_export_worker_key(
    x_slideforge_worker_key: str | None = Header(default=None),
) -> None:
    """远程视频导出 worker：请求头 X-SlideForge-Worker-Key 须与 EXPORT_WORKER_TOKEN 一致。"""
    secret = (settings.export_worker_token or "").strip()
    if not secret:
        raise HTTPException(status_code=503, detail="未配置 EXPORT_WORKER_TOKEN")
    key = (x_slideforge_worker_key or "").strip()
    if not key:
        raise HTTPException(status_code=401, detail="缺少 X-SlideForge-Worker-Key")
    kh = hashlib.sha256(key.encode("utf-8")).digest()
    sh = hashlib.sha256(secret.encode("utf-8")).digest()
    if not hmac.compare_digest(kh, sh):
        raise HTTPException(status_code=401, detail="Worker 密钥无效")
