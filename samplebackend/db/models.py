from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


# 大纲节点类型（数据库存树）
KIND_PAGE = "page"
KIND_STEP = "step"
KIND_PAUSE = "pause"


class Project(SQLModel, table=True):
    __tablename__ = "projects"

    id: Optional[int] = Field(default=None, primary_key=True)
    owner_user_id: int = Field(foreign_key="users.id", index=True)
    # 历史库另有 user_id 列；与 owner_user_id 一致，均指向项目创建者
    user_id: Optional[int] = Field(
        default=None,
        foreign_key="users.id",
        index=True,
    )
    is_shared: bool = False
    name: str
    description: Optional[str] = Field(default=None)
    input_prompt: str
    status: str  # queued / pending_text / structuring / draft / synthesizing / ready / failed / …
    deck_status: Optional[str] = Field(
        default=None,
        description="idle / generating / ready / failed",
    )
    deck_json: Optional[str] = Field(
        default=None,
        description="演示页聚合 JSON（各页 HTML 等），与样式配置无关",
    )
    deck_error: Optional[str] = Field(default=None)
    deck_page_size: Optional[str] = Field(
        default="16:9",
        description="演示页面尺寸预设：16:9 | 4:3 | 9:16 | 1:1（留在项目表）",
    )
    video_exported_at: Optional[datetime] = Field(
        default=None,
        description="最近一次成功导出成片（export.mp4）的时间",
    )
    video_source_updated_at: datetime = Field(
        default_factory=utc_now,
        description="影响视频内容的素材最近变更时间；晚于导出时间则需重新导出",
    )
    text_status: Optional[str] = Field(
        default=None,
        description="文本结构化：not_started | running | success | failed",
    )
    audio_status: Optional[str] = Field(
        default=None,
        description="配音：not_started | running | success | failed",
    )
    demo_status: Optional[str] = Field(
        default=None,
        description="演示页：not_started | running | success | failed",
    )
    export_status: Optional[str] = Field(
        default=None,
        description="导出：not_started | running | success | failed",
    )
    text_error: Optional[str] = Field(default=None)
    audio_error: Optional[str] = Field(default=None)
    demo_error: Optional[str] = Field(default=None)
    export_error: Optional[str] = Field(default=None)
    text_result_url: Optional[str] = Field(default=None)
    audio_result_url: Optional[str] = Field(default=None)
    demo_result_url: Optional[str] = Field(default=None)
    export_file_url: Optional[str] = Field(default=None)
    narration_target_seconds: Optional[int] = Field(
        default=None,
        description="结构化口播目标体量（秒）；用于换算字数区间提示模型，非成片精确时长",
    )
    tts_voice_type: Optional[str] = Field(
        default=None,
        description="豆包 TTS 音色 voice_type（V3 即 speaker）；空则使用服务器 .env 默认",
    )
    pipeline_auto_advance: bool = Field(
        default=True,
        description="为 True 时文案成功后自动并行配音与演示；任一步失败会置 False（退回手动逐步确认）",
    )
    text_structure_mode: Optional[str] = Field(
        default=None,
        description="polish | verbatim_split；决定结构化时使用的系统提示",
    )
    manual_outline_confirmed: bool = Field(
        default=True,
        description="手动流水线：为 False 时禁止整稿配音/场景生成，直至用户确认口播分段",
    )
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class ProjectStyle(SQLModel, table=True):
    """演示样式：与项目 1:1。基本风格与用户提示词在此表；屏幕尺寸在项目表。"""

    __tablename__ = "project_styles"

    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="projects.id", unique=True, index=True)
    style_preset: str = Field(
        default="none",
        description="基本风格 slug：none | aurora_glass | minimal_tech | …",
    )
    user_style_hint: Optional[str] = Field(
        default=None,
        description="用户提示词，参与风格母版生成",
    )
    style_prompt_text: str = Field(
        default="",
        description="AI 生成的纯文本风格说明（可读摘要）",
    )
    style_data_json: Optional[str] = Field(
        default=None,
        description='可选扩展 JSON；母版生成成功后存信封 {"preset","user_hint","page_size","style_base"}',
    )
    style_base_json: Optional[str] = Field(
        default="",
        description="旧库 NOT NULL 兼容；与 style_data_json 同步写入，读取优先 style_data_json",
    )
    version: int = Field(default=1, ge=1)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class WorkflowRun(SQLModel, table=True):
    """项目级工作流实例（当前 1:1 project）；总览状态便于列表与监控。"""

    __tablename__ = "workflow_runs"

    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="projects.id", unique=True, index=True)
    owner_user_id: int = Field(foreign_key="users.id", index=True)
    overall_status: str = Field(
        default="pending",
        description="pending | running | success | failed | partial",
    )
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    finished_at: Optional[datetime] = Field(default=None)


class WorkflowStepRun(SQLModel, table=True):
    """单步执行状态：text / audio / deck_master / deck_render。"""

    __tablename__ = "workflow_step_runs"
    __table_args__ = (
        UniqueConstraint("workflow_run_id", "step_key", name="uq_workflow_step_run_key"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    workflow_run_id: int = Field(foreign_key="workflow_runs.id", index=True)
    step_key: str = Field(index=True, description="text | audio | deck_master | deck_render")
    status: str = Field(
        default="pending",
        description="pending | running | success | failed",
    )
    attempt_no: int = Field(default=0, ge=0)
    input_snapshot: Optional[str] = Field(default=None)
    output_snapshot: Optional[str] = Field(default=None)
    error_message: Optional[str] = Field(default=None)
    started_at: Optional[datetime] = Field(default=None)
    finished_at: Optional[datetime] = Field(default=None)
    updated_at: datetime = Field(default_factory=utc_now)


class WorkflowExportRun(SQLModel, table=True):
    """导出子状态机，与内容步骤分列。"""

    __tablename__ = "workflow_export_runs"

    id: Optional[int] = Field(default=None, primary_key=True)
    workflow_run_id: int = Field(foreign_key="workflow_runs.id", unique=True, index=True)
    status: str = Field(
        default="not_exported",
        description="not_exported | exporting | export_success | export_failed",
    )
    export_format: Optional[str] = Field(default="mp4")
    output_file_url: Optional[str] = Field(default=None)
    error_message: Optional[str] = Field(default=None)
    started_at: Optional[datetime] = Field(default=None)
    finished_at: Optional[datetime] = Field(default=None)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class WorkflowArtifact(SQLModel, table=True):
    """步骤产物索引（大文件走 URL，摘要进 meta_json）。"""

    __tablename__ = "workflow_artifacts"

    id: Optional[int] = Field(default=None, primary_key=True)
    workflow_run_id: int = Field(foreign_key="workflow_runs.id", index=True)
    step_key: str = Field(index=True)
    artifact_type: str = Field(default="file", index=True)
    file_url: Optional[str] = Field(default=None)
    meta_json: Optional[str] = Field(default=None)
    created_at: datetime = Field(default_factory=utc_now)


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: Optional[int] = Field(default=None, primary_key=True)
    username: str = Field(index=True, unique=True)
    password_hash: str
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class AuthSession(SQLModel, table=True):
    __tablename__ = "auth_sessions"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="users.id", index=True)
    token_hash: str = Field(index=True, unique=True)
    expires_at: datetime
    created_at: datetime = Field(default_factory=utc_now)


class OutlineNode(SQLModel, table=True):
    """
    剧本结构树：根为 page（大标题），子节点为 step（小标题）或 pause（空拍）。
    page 可有 NodeContent（page_code HTML）；step 必有 NodeContent（口播与 actions）。
    """

    __tablename__ = "outline_nodes"

    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="projects.id", index=True)
    parent_id: Optional[int] = Field(
        default=None,
        foreign_key="outline_nodes.id",
        index=True,
    )
    sort_order: int = 0
    title: str = ""
    node_kind: str = KIND_STEP  # page | step | pause
    subtree_has_content: bool = False
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class NodeContent(SQLModel, table=True):
    """
    挂在节点上的内容：
    - page：可存 page_code（整页 HTML）。
    - step：口播、时长、音频等；板块切换由放映索引驱动，不存动作脚本。
    """

    __tablename__ = "node_contents"

    id: Optional[int] = Field(default=None, primary_key=True)
    node_id: int = Field(foreign_key="outline_nodes.id", unique=True, index=True)
    page_code: Optional[str] = Field(
        default=None,
        description="page 节点：AI 生成的整页 HTML（含 data-key 占位）",
    )
    page_deck_status: Optional[str] = Field(
        default=None,
        description="page 节点：idle / generating / ready / failed",
    )
    page_deck_error: Optional[str] = Field(default=None)
    narration_text: str = ""
    narration_brief: Optional[str] = Field(
        default=None,
        description="step 节点：口播提炼版（用于演示页生成、摘要展示）",
    )
    duration_ms: Optional[int] = Field(default=None)
    narration_alignment_json: Optional[str] = Field(
        default=None,
        description="step：豆包 TTS with_timestamp 返回的附加信息 JSON（含字级时间轴等）",
    )
    audio_sequence: int = Field(
        default=0,
        description="step：全项目带音频的播放顺序 1-based（001.xxx）；page 无音频时为 0",
    )
    audio_asset_id: Optional[int] = Field(default=None)
    image_asset_id: Optional[int] = Field(default=None)
    background_asset_id: Optional[int] = Field(default=None)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
