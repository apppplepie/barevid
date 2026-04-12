"""每账号可持有的项目数量上限（删项目后释放额度）。"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.config import settings
from app.db.models import Project


class ProjectQuotaExceededError(RuntimeError):
    """当前账号下项目数已达上限。"""


def _quota_message() -> str:
    n = settings.max_projects_per_user
    return (
        f"每个账号最多保留 {n} 个项目，请先删除不再需要的项目后再创建；"
        "删除后即释放额度。请勿通过重复注册等方式绕过限制。"
    )


async def count_owned_projects(session: AsyncSession, user_id: int) -> int:
    uid = int(user_id)
    n = (
        await session.exec(
            select(func.count(Project.id)).where(Project.owner_user_id == uid)
        )
    ).one()
    return int(n)


async def ensure_project_quota(session: AsyncSession, user_id: int) -> None:
    limit = int(settings.max_projects_per_user)
    if limit <= 0:
        return
    if await count_owned_projects(session, user_id) >= limit:
        raise ProjectQuotaExceededError(_quota_message())
