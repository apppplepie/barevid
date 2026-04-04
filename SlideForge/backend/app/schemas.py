from pydantic import BaseModel, Field


class Segment(BaseModel):
    subtitle: str = Field(..., description="小标题")
    script: str = Field(..., description="该段播客口播全文，用于 TTS")
    brief: str | None = Field(
        default=None,
        description="该段提炼版（1~2 句），用于展示和演示生成",
    )


class Section(BaseModel):
    main_title: str = Field(..., description="大标题")
    segments: list[Segment] = Field(default_factory=list)


class StructuredPodcast(BaseModel):
    items: list[Section] = Field(default_factory=list)


class GenerateRequest(BaseModel):
    raw_text: str = Field(..., min_length=1)
    name: str | None = Field(default=None, description="项目名称，可选")


class ProjectCloneRequest(BaseModel):
    """深度克隆已有项目（数据库 + 媒体目录）；可选新名称。"""

    name: str | None = Field(
        default=None,
        max_length=200,
        description="新项目名；省略则使用「原名 + 复制版」",
    )


class ProjectCreate(BaseModel):
    """先落库为 queued，再由后台跑结构化 → 配音 → 演示页。"""

    name: str = Field(..., min_length=1, max_length=200, description="项目名称")
    raw_text: str = Field(..., min_length=1, description="主题素材，送入 STRUCTURE_SYSTEM")
    deck_page_size: str | None = Field(default=None, description="（已废弃）")
    deck_style_preset: str | None = Field(
        default=None,
        description="基本风格：aurora_glass | minimal_tech | dark_neon | editorial_luxury | futuristic_hud",
    )
    copy_deck_master_from_project_id: int | None = Field(
        default=None,
        ge=1,
        description="指定时从该项目的 project_styles 复制已就绪的演示母版到新项目，跳过 AI 生成母版",
    )
    deck_style_user_hint: str | None = Field(
        default=None,
        max_length=4000,
        description="用户自定义风格补充，写入 user_style_hint；仅在不复用源母版时参与母版生成",
    )
    target_narration_seconds: int | None = Field(
        default=None,
        description="目标口播总时长（秒），送入结构化以约束全文 script 体量；省略表示不限制",
    )
    pipeline_auto_advance: bool = Field(
        default=True,
        description="为 False 时创建后不自动排队跑流水线，需在工程内手动点步骤开始",
    )


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=40)
    password: str = Field(..., min_length=6, max_length=128)


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=40)
    password: str = Field(..., min_length=6, max_length=128)


class AuthResponse(BaseModel):
    token: str
    user_id: int
    username: str


class AudioPart(BaseModel):
    index: int
    filename: str
    url: str
    subtitle: str
    main_title: str


class GenerateResponse(BaseModel):
    project_id: int
    structured: StructuredPodcast
    audios: list[AudioPart]


class GenerateOutlineResponse(BaseModel):
    project_id: int
    structured: StructuredPodcast


class SynthesizeAudioResponse(BaseModel):
    project_id: int
    audios: list[AudioPart]


class ResynthesizeStepAudioRequest(BaseModel):
    """可选：用该字符串代替节点上的口播全文做合成；不传则使用已存全文。"""

    text: str | None = None


class ProjectPatch(BaseModel):
    name: str | None = Field(default=None, description="项目名称")
    is_shared: bool | None = Field(default=None, description="是否共享给所有用户可编辑")
    input_prompt: str | None = Field(
        default=None,
        description="项目原始素材/口播稿（手动流水线编辑后保存）",
    )


class WorkflowStepActionBody(BaseModel):
    """工作流面板：取消运行中步骤 / 回退已完成步骤。"""

    step: str = Field(
        description="text | audio | deck_master | deck_render | pages | export",
    )


class DeckStylePatch(BaseModel):
    deck_style_preset: str | None = Field(
        default=None,
        description="基本风格：aurora_glass | minimal_tech | dark_neon | editorial_luxury | futuristic_hud",
    )
    deck_style_user_hint: str | None = Field(
        default=None,
        description="用户提示词，写入样式表并参与风格母版生成",
    )
    deck_page_size: str | None = Field(default=None, description="（已废弃）")

class ExportVideoRequest(BaseModel):
    width: int | None = Field(default=None, description="导出视频宽度（像素），可选")
    height: int | None = Field(default=None, description="导出视频高度（像素），可选")
    frontend_url: str | None = Field(
        default=None,
        description="放映页 origin；导出页可传 window.location.origin。若服务端配置了 EXPORT_PLAY_ORIGIN 则以后者为准。",
    )
    force_reexport: bool = Field(
        default=False,
        description="为 true 时忽略与素材同步的已有成片，强制重新执行导出流程",
    )


class PipelineStages(BaseModel):
    outline: bool = Field(description="文案已写入大纲")
    audio: bool = Field(description="配音完成")
    deck: bool = Field(description="所需演示 HTML 页均已生成就绪")
    video: bool = Field(description="已成功导出过成片 MP4")


class ExportVideoResponse(BaseModel):
    output_url: str = Field(
        default="",
        description="成片 URL；排队中可能为空或仍为旧成片链接",
    )
    action: str = Field(
        description="export | download | queued（远程 worker 模式下入队）",
    )
    pipeline: PipelineStages
    video_exported_at: str | None = Field(default=None, description="（已废弃）")
    export_job_id: int | None = Field(
        default=None,
        description="新导出任务入队后返回；与已有任务重复排队时返回在办 job id",
    )


class WorkerVideoExportFailBody(BaseModel):
    error: str = Field(default="导出失败", description="错误信息")


class WorkerVideoExportJobPayload(BaseModel):
    job_id: int
    project_id: int
    project_name: str
    width: int
    height: int
    frontend_url: str
    api_url: str
    media_base_url: str
    authorization: str = Field(
        description="含 Bearer 的完整 Authorization 值，传给 export_video 子进程",
    )


class ContextualAIDraftRequest(BaseModel):
    instruction: str = Field(..., min_length=1, description="用户自然语言编辑要求")
    current_json: str | None = Field(
        default=None, description="当前页面 JSON 文本（前端上下文）"
    )


class ContextualAIDraftApplyRequest(BaseModel):
    draft_json: dict = Field(..., description="待应用草稿，至少包含 html")
