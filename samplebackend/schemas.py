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
    narration_target_seconds: int | None = Field(
        default=None,
        ge=10,
        le=3600,
        description="口播目标体量（秒），传入则写入项目并约束结构化字数",
    )


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
    deck_page_size: str | None = Field(
        default=None,
        description="16:9 | 4:3 | 9:16 | 1:1",
    )
    deck_style_preset: str | None = Field(
        default=None,
        description="基本风格：none（默认未选）| aurora_glass | minimal_tech | dark_neon | editorial_luxury | futuristic_hud",
    )
    deck_style_user_hint: str | None = Field(
        default=None,
        max_length=8000,
        description="演示风格用户补充提示词，写入样式表并参与母版生成；可与预设同时生效",
    )
    copy_deck_master_from_project_id: int | None = Field(
        default=None,
        ge=1,
        description="指定时从该项目的 project_styles 复制已就绪的演示母版到新项目，跳过 AI 生成母版",
    )
    include_intro: bool = Field(
        default=False,
        description="导出视频时附加服务端默认时长的片头",
    )
    intro_style_id: int | None = Field(
        default=None,
        ge=1,
        le=99,
        description="片头样式 id（与前端 bumper 注册表一致）；省略且勾选片头时默认为 1",
    )
    include_outro: bool = Field(
        default=False,
        description="导出视频时附加服务端默认时长的片尾",
    )
    narration_target_seconds: int | None = Field(
        default=None,
        ge=10,
        le=3600,
        description="结构化口播目标体量（秒），换算为字数区间提示模型；省略表示不额外约束",
    )
    tts_voice_type: str | None = Field(
        default=None,
        max_length=128,
        description="豆包 TTS 音色 voice_type；省略或空串则使用服务器 .env 默认",
    )
    pipeline_auto_advance: bool = Field(
        default=True,
        description="True=文案成功后自动跑配音与演示；False=仅结构化，需在工程内手动开始各步",
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


class NarrationTextPatch(BaseModel):
    """将 step 节点的口播正文写入库（与已合成音频应对齐；通常先 resynthesize 再保存）。"""

    narration_text: str = Field(default="", description="口播全文，允许空串")


class ProjectPatch(BaseModel):
    name: str | None = Field(default=None, description="项目名称")
    is_shared: bool | None = Field(default=None, description="是否共享给所有用户可编辑")
    tts_voice_type: str | None = Field(
        default=None,
        description="豆包音色 voice_type；传空串清除项目覆盖并跟随服务器默认；省略则不修改",
    )
    input_prompt: str | None = Field(
        default=None,
        description="主题素材原文；手动流程可在生成口播前修改后再跑结构化",
    )
    text_structure_mode: str | None = Field(
        default=None,
        description="polish=AI 整理口播腔；verbatim_split=不改写原文仅分段+概括",
    )


class ManualOutlineSegmentEdit(BaseModel):
    step_node_id: int = Field(..., ge=1)
    subtitle: str = Field(default="", max_length=4000)
    narration_text: str = Field(default="", max_length=500_000)
    narration_brief: str | None = Field(default=None, max_length=16_000)


class ManualOutlinePageEdit(BaseModel):
    page_node_id: int = Field(..., ge=1)
    main_title: str = Field(default="", max_length=4000)
    segments: list[ManualOutlineSegmentEdit] = Field(default_factory=list)


class ManualConfirmOutlineRequest(BaseModel):
    pages: list[ManualOutlinePageEdit] = Field(..., min_length=1)


class WorkflowStepControlRequest(BaseModel):
    """顶栏流水线：取消进行中 / 成功步骤回退。"""

    step: str = Field(
        ...,
        min_length=2,
        max_length=32,
        description="text | audio | pages | deck_master | deck_render | export",
    )


class DeckStylePatch(BaseModel):
    deck_style_preset: str | None = Field(
        default=None,
        description="基本风格：none | aurora_glass | minimal_tech | dark_neon | editorial_luxury | futuristic_hud",
    )
    deck_style_user_hint: str | None = Field(
        default=None,
        description="用户提示词，写入样式表并参与风格母版生成",
    )
    deck_page_size: str | None = Field(
        default=None,
        description="页面尺寸预设：16:9 | 4:3 | 9:16 | 1:1",
    )


class DeckStylePromptTextPatch(BaseModel):
    """仅更新 project_styles.style_prompt_text，不清空母版 JSON、不整表重置导出。"""

    deck_style_prompt_text: str = Field(
        default="",
        max_length=32000,
        description="AI 生成的风格说明纯文本；生成场景页前可由用户微调后写入",
    )


class CopyDeckStyleFromRequest(BaseModel):
    """将另一项目的就绪演示母版样式复制到当前项目（不调用模型生成）。"""

    source_project_id: int = Field(..., ge=1, description="源项目数字 ID")

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
    output_url: str
    action: str = Field(
        description="export: 本次执行了重新合成；download: 复用已有 mp4 直链下载",
    )
    pipeline: PipelineStages
    video_exported_at: str | None = Field(
        default=None, description="ISO 时间，最近一次导出成功"
    )


class ContextualAIDraftRequest(BaseModel):
    instruction: str = Field(..., min_length=1, description="用户自然语言编辑要求")
    current_json: str | None = Field(
        default=None, description="当前页面 JSON 文本（前端上下文）"
    )


class ContextualAIDraftApplyRequest(BaseModel):
    draft_json: dict = Field(..., description="待应用草稿，至少包含 html")
