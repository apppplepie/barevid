"""将项目连同数据库行与 storage/projects/{id} 目录一并克隆到新项目。"""

from __future__ import annotations

import shutil
from pathlib import Path

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.db.models import (
    NodeContent,
    OutlineNode,
    Project,
    ProjectStyle,
    WorkflowArtifact,
    WorkflowExportRun,
    WorkflowRun,
    WorkflowStepRun,
    utc_now,
)
from app.services.project_meta import clear_deck_master_source_description_if_marker
from app.services.workflow_engine import (
    EXPORT_NOT_EXPORTED,
    ensure_workflow_for_project,
)


def remap_project_media_refs(text: str | None, old_pid: int, new_pid: int) -> str | None:
    """把 /media/projects/{old}/… 等路径中的项目 id 换成新 id。"""
    if text is None:
        return None
    os_, ns = str(old_pid), str(new_pid)
    return (
        text.replace(f"/media/projects/{os_}/", f"/media/projects/{ns}/")
        .replace(f"projects/{os_}/", f"projects/{ns}/")
    )


def _copy_project_disk(storage_root: Path, old_pid: int, new_pid: int) -> None:
    src = storage_root / "projects" / str(old_pid)
    dst = storage_root / "projects" / str(new_pid)
    if dst.exists():
        shutil.rmtree(dst, ignore_errors=True)
    if src.is_dir():
        shutil.copytree(src, dst)
    else:
        dst.mkdir(parents=True, exist_ok=True)


def _outline_sort_key(
    nodes: list[OutlineNode],
) -> list[OutlineNode]:
    by_id: dict[int, OutlineNode] = {}
    for n in nodes:
        if n.id is not None:
            by_id[int(n.id)] = n
    memo: dict[int, int] = {}

    def depth(nid: int) -> int:
        if nid in memo:
            return memo[nid]
        n = by_id[nid]
        if n.parent_id is None:
            memo[nid] = 0
            return 0
        memo[nid] = 1 + depth(int(n.parent_id))
        return memo[nid]

    return sorted(
        nodes,
        key=lambda x: (
            depth(int(x.id)) if x.id is not None else 0,
            x.sort_order,
            x.id or 0,
        ),
    )


async def clone_project_deep(
    session: AsyncSession,
    *,
    source_project_id: int,
    new_owner_user_id: int,
    new_name: str,
    storage_root: Path,
) -> int:
    """
    克隆项目：projects / project_styles / outline_nodes / node_contents /
    workflow_*，并复制磁盘目录。不触发流水线。
    返回新项目 id。
    """
    src = await session.get(Project, source_project_id)
    if src is None:
        raise ValueError("项目不存在")

    old_pid = int(source_project_id)
    now = utc_now()
    base = src.model_dump(exclude={"id"})
    base["owner_user_id"] = new_owner_user_id
    base["user_id"] = new_owner_user_id
    base["name"] = new_name.strip() or (src.name or "未命名项目") + "复制版"
    base["is_shared"] = False
    base["created_at"] = now
    base["updated_at"] = now

    new_proj = Project(**base)
    new_proj.description = clear_deck_master_source_description_if_marker(
        new_proj.description
    )
    session.add(new_proj)
    await session.flush()
    new_pid = int(new_proj.id)

    session.add(new_proj)

    try:
        _copy_project_disk(storage_root, old_pid, new_pid)
    except OSError:
        await session.rollback()
        shutil.rmtree(storage_root / "projects" / str(new_pid), ignore_errors=True)
        raise

    try:
        style_id = int(src.style_id) if src.style_id is not None else None
        if style_id is None:
            legacy_style = (
                await session.exec(
                    select(ProjectStyle).where(ProjectStyle.origin_project_id == source_project_id)
                )
            ).first()
            if legacy_style is not None and legacy_style.id is not None:
                style_id = int(legacy_style.id)
        new_proj.style_id = style_id
        session.add(new_proj)

        nodes_res = await session.exec(
            select(OutlineNode).where(OutlineNode.project_id == source_project_id)
        )
        old_nodes = list(nodes_res.all())
        node_id_map: dict[int, int] = {}

        for old_node in _outline_sort_key(old_nodes):
            if old_node.id is None:
                continue
            oid = int(old_node.id)
            parent_new: int | None = None
            if old_node.parent_id is not None:
                p = int(old_node.parent_id)
                parent_new = node_id_map.get(p)
            pn = OutlineNode(
                project_id=new_pid,
                parent_id=parent_new,
                sort_order=old_node.sort_order,
                title=old_node.title,
                node_kind=old_node.node_kind,
                subtree_has_content=old_node.subtree_has_content,
                created_at=now,
                updated_at=now,
            )
            session.add(pn)
            await session.flush()
            assert pn.id is not None
            node_id_map[oid] = int(pn.id)

        for oid, nid in node_id_map.items():
            nc_res = await session.exec(select(NodeContent).where(NodeContent.node_id == oid))
            nc = nc_res.first()
            if nc is None:
                continue
            session.add(
                NodeContent(
                    node_id=nid,
                    page_code=remap_project_media_refs(nc.page_code, old_pid, new_pid),
                    page_deck_status=nc.page_deck_status,
                    page_deck_error=nc.page_deck_error,
                    narration_text=nc.narration_text,
                    narration_brief=nc.narration_brief,
                    duration_ms=nc.duration_ms,
                    narration_alignment_json=remap_project_media_refs(
                        nc.narration_alignment_json, old_pid, new_pid
                    ),
                    audio_sequence=nc.audio_sequence,
                    audio_asset_id=nc.audio_asset_id,
                    image_asset_id=nc.image_asset_id,
                    background_asset_id=nc.background_asset_id,
                    scene_style_json=remap_project_media_refs(
                        nc.scene_style_json, old_pid, new_pid
                    ),
                    enter_transition=nc.enter_transition,
                    exit_transition=nc.exit_transition,
                    created_at=now,
                    updated_at=now,
                )
            )

        wr_res = await session.exec(
            select(WorkflowRun).where(WorkflowRun.project_id == source_project_id)
        )
        wr = wr_res.first()
        if wr is not None and wr.id is not None:
            wid_old = int(wr.id)
            new_wr = WorkflowRun(
                project_id=new_pid,
                owner_user_id=new_owner_user_id,
                overall_status=wr.overall_status,
                created_at=now,
                updated_at=now,
                finished_at=wr.finished_at,
            )
            session.add(new_wr)
            await session.flush()
            assert new_wr.id is not None
            wid_new = int(new_wr.id)

            steps_res = await session.exec(
                select(WorkflowStepRun).where(WorkflowStepRun.workflow_run_id == wid_old)
            )
            for s in steps_res.all():
                session.add(
                    WorkflowStepRun(
                        workflow_run_id=wid_new,
                        step_key=s.step_key,
                        status=s.status,
                        attempt_no=s.attempt_no,
                        input_snapshot=remap_project_media_refs(s.input_snapshot, old_pid, new_pid),
                        output_snapshot=remap_project_media_refs(s.output_snapshot, old_pid, new_pid),
                        error_message=s.error_message,
                        started_at=s.started_at,
                        finished_at=s.finished_at,
                        updated_at=now,
                    )
                )

            ex_res = await session.exec(
                select(WorkflowExportRun).where(WorkflowExportRun.workflow_run_id == wid_old)
            )
            ex = ex_res.first()
            if ex is not None:
                session.add(
                    WorkflowExportRun(
                        workflow_run_id=wid_new,
                        status=ex.status,
                        export_format=ex.export_format,
                        output_file_url=remap_project_media_refs(
                            ex.output_file_url, old_pid, new_pid
                        ),
                        error_message=ex.error_message,
                        started_at=ex.started_at,
                        finished_at=ex.finished_at,
                        created_at=now,
                        updated_at=now,
                    )
                )
            else:
                session.add(
                    WorkflowExportRun(
                        workflow_run_id=wid_new,
                        status=EXPORT_NOT_EXPORTED,
                        created_at=now,
                        updated_at=now,
                    )
                )

            art_res = await session.exec(
                select(WorkflowArtifact).where(WorkflowArtifact.workflow_run_id == wid_old)
            )
            for a in art_res.all():
                session.add(
                    WorkflowArtifact(
                        workflow_run_id=wid_new,
                        step_key=a.step_key,
                        artifact_type=a.artifact_type,
                        file_url=remap_project_media_refs(a.file_url, old_pid, new_pid),
                        meta_json=remap_project_media_refs(a.meta_json, old_pid, new_pid),
                        created_at=now,
                    )
                )
        else:
            await ensure_workflow_for_project(session, new_proj, align_from_project=True)

        await session.commit()
        return new_pid
    except Exception:
        await session.rollback()
        shutil.rmtree(storage_root / "projects" / str(new_pid), ignore_errors=True)
        raise
