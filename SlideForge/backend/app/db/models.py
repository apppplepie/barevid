from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Column, Text, UniqueConstraint
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
    description: Optional[str] = Field(default=None, sa_column=Column(Text))
    input_prompt: str = Field(sa_column=Column(Text, nullable=False))
    status: str  # queued / structuring / draft / synthesizing / ready / failed / …
    aspect_ratio: Optional[str] = Field(default="16:9")
    deck_width: Optional[int] = Field(default=1920)
    deck_height: Optional[int] = Field(default=1080)
    style_id: Optional[int] = Field(default=None, foreign_key="project_styles.id")
    # 目标口播总时长（秒），结构化时写入 AI 约束；NULL 表示不限制（旧项目）
    target_narration_seconds: Optional[int] = Field(default=None)
    # False：创建后不自动跑 queued 流水线，由用户在工程内手动触发各步
    pipeline_auto_advance: bool = Field(default=True)
    # 非空时覆盖全局 DOUBAO_TTS_VOICE_TYPE 作为该项目默认合成音色
    tts_voice_type: Optional[str] = Field(default=None, max_length=200)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class ProjectStyle(SQLModel, table=True):
    """演示母版：由 projects.style_id 引用，可被多个项目复用。"""

    __tablename__ = "project_styles"

    id: Optional[int] = Field(default=None, primary_key=True)
    origin_project_id: Optional[int] = Field(
        default=None,
        foreign_key="projects.id",
        index=True,
    )
    style_preset: str = Field(
        default="aurora_glass",
        description="基本风格 slug：aurora_glass | minimal_tech | …",
    )
    user_style_hint: Optional[str] = Field(
        default=None,
        description="用户提示词，参与风格母版生成",
    )
    style_prompt_text: str = Field(
        default="",
        sa_column=Column(Text, nullable=False),
        description="AI 生成的纯文本风格说明（可读摘要）",
    )
    style_data_json: Optional[str] = Field(
        default=None,
        sa_column=Column(Text),
        description='可选扩展 JSON；母版生成成功后存信封 {"preset","user_hint","page_size","style_base"}',
    )
    style_base_json: Optional[str] = Field(
        default="",
        sa_column=Column(Text),
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
        description="pending | running | success | failed | partial | cancelled",
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
        description="pending | ready | running | succeeded | failed | cancelled",
    )
    ready_at: Optional[datetime] = Field(default=None)
    cancelled_at: Optional[datetime] = Field(default=None)
    attempt_no: int = Field(default=0, ge=0)
    input_snapshot: Optional[str] = Field(default=None, sa_column=Column(Text))
    output_snapshot: Optional[str] = Field(default=None, sa_column=Column(Text))
    error_message: Optional[str] = Field(default=None, sa_column=Column(Text))
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
    output_file_url: Optional[str] = Field(default=None, sa_column=Column(Text))
    error_message: Optional[str] = Field(default=None, sa_column=Column(Text))
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
    file_url: Optional[str] = Field(default=None, sa_column=Column(Text))
    meta_json: Optional[str] = Field(default=None, sa_column=Column(Text))
    created_at: datetime = Field(default_factory=utc_now)


class VideoExportJob(SQLModel, table=True):
    """视频导出异步任务：入队于服务器，由远程 worker 领取、上传成品。"""

    __tablename__ = "video_export_jobs"

    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="projects.id", index=True)
    status: str = Field(
        default="queued",
        description="queued | running | succeeded | failed",
    )
    width: int = Field(default=1920, ge=2)
    height: int = Field(default=1080, ge=2)
    request_authorization: Optional[str] = Field(
        default=None,
        sa_column=Column(Text),
        description="任务存活期内的 Authorization 请求头原文，用于 worker 调 play-manifest；结束后清空",
    )
    error_message: Optional[str] = Field(default=None, sa_column=Column(Text))
    worker_id: Optional[str] = Field(default=None, max_length=128)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    started_at: Optional[datetime] = Field(default=None)
    finished_at: Optional[datetime] = Field(default=None)


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
        sa_column=Column(Text),
        description="page 节点：AI 生成的整页 HTML（含 data-key 占位）",
    )
    page_deck_status: Optional[str] = Field(
        default=None,
        description="page 节点：idle / generating / ready / failed / cancelled",
    )
    page_deck_error: Optional[str] = Field(default=None, sa_column=Column(Text))
    narration_text: str = Field(default="", sa_column=Column(Text, nullable=False))
    narration_brief: Optional[str] = Field(
        default=None,
        sa_column=Column(Text),
        description="step 节点：口播提炼版（用于演示页生成、摘要展示）",
    )
    duration_ms: Optional[int] = Field(default=None)
    narration_alignment_json: Optional[str] = Field(
        default=None,
        sa_column=Column(Text),
        description="step：豆包 TTS with_timestamp 返回的附加信息 JSON（含字级时间轴等）",
    )
    audio_sequence: int = Field(
        default=0,
        description="step：全项目带音频的播放顺序 1-based（001.xxx）；page 无音频时为 0",
    )
    audio_asset_id: Optional[int] = Field(default=None)
    image_asset_id: Optional[int] = Field(default=None)
    background_asset_id: Optional[int] = Field(default=None)
    scene_style_json: Optional[str] = Field(default=None, sa_column=Column(Text))
    enter_transition: Optional[str] = Field(default=None)
    exit_transition: Optional[str] = Field(default=None)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
