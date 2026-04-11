import os
import sys
from pathlib import Path

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_DIR = Path(__file__).resolve().parent.parent
_LEGACY_STORAGE = _BACKEND_DIR / "storage"


def _default_storage_root() -> Path:
    """运行时写入目录；默认放在项目外，避免 uvicorn --reload 监控到频繁写文件导致死循环。

    若曾在仓库内 `backend/storage` 下使用过 SQLite（slideforge.db），则继续使用该路径，便于无缝升级。
    可通过环境变量 STORAGE_ROOT 覆盖。
    """
    if (_LEGACY_STORAGE / "slideforge.db").exists():
        return _LEGACY_STORAGE
    if sys.platform == "win32":
        local = os.environ.get("LOCALAPPDATA")
        if local:
            return Path(local) / "SlideForge" / "storage"
        return Path.home() / "SlideForge" / "storage"
    if sys.platform == "darwin":
        return (
            Path.home()
            / "Library"
            / "Application Support"
            / "SlideForge"
            / "storage"
        )
    xdg = os.environ.get("XDG_DATA_HOME")
    if xdg:
        return Path(xdg) / "slideforge" / "storage"
    return Path.home() / ".local" / "share" / "slideforge" / "storage"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com/v1"
    # FIM 补全（Beta）网关，需与官方文档一致，例如 https://api.deepseek.com/beta
    deepseek_beta_base_url: str = "https://api.deepseek.com/beta"
    deepseek_model: str = "deepseek-chat"
    # 容器/远程网络下若模型长时间无响应，需尽快失败并回写 workflow，避免长期 running。
    deepseek_request_timeout_seconds: int = 180
    deepseek_style_timeout_seconds: int = 180
    deepseek_deck_timeout_seconds: int = 420
    # chat/completions 的 max_tokens：deepseek-chat（V3）单次输出 API 上限 8192，超过无效；不传时服务端默认约 4096，长 JSON/HTML 易截断。
    # 放映页 / 单页 AI 草稿 / JSON 修复等共用此上限（程序化调用时在请求体显式传入）。
    deepseek_deck_max_tokens: int = 8192
    # 文本结构化（大纲 JSON）输出；建议与 deck 同为 8192，避免长素材被截断。
    deepseek_structure_max_tokens: int = 8192
    # 风格母版纯文本；通常短于放映页 HTML。
    deepseek_style_max_tokens: int = 4096
    deepseek_fim_enabled: bool = True
    # FIM 单次 max_tokens 上限（官方说明约 4K）
    deepseek_fim_max_tokens: int = 4096

    # 豆包语音合成：默认 HTTP V3 单向流式（文档 1598757）；V1 见 1257584
    doubao_tts_use_v3: bool = True
    # V3 必填，须与音色版本一致：TTS2.0 用 seed-tts-2.0，TTS1.0 用 seed-tts-1.0 等
    doubao_tts_resource_id: str = "seed-tts-2.0"
    doubao_tts_app_id: str = ""
    doubao_tts_access_token: str = ""
    # 须与 DOUBAO_TTS_RESOURCE_ID 同版本：seed-tts-2.0 应用「豆包语音合成模型2.0」音色（见文档 1257544）
    doubao_tts_voice_type: str = "zh_male_m191_uranus_bigtts"
    doubao_tts_cluster: str = "volcano_tts"
    doubao_tts_uid: str = "slideforge"
    doubao_tts_speed_ratio: float = 1.0
    # 字级时间戳：V1 为 with_timestamp；V3 在 TTS2.0 为 audio_params.enable_subtitle
    doubao_tts_with_timestamp: bool = True
    # 豆包 TTS 单次请求（含流式读响应体）超时；长文稿或网络慢时易触发 httpx.ReadTimeout，宜与 audio_pipeline 同量级
    doubao_tts_http_timeout_seconds: float = 600.0

    storage_root: Path = Field(default_factory=_default_storage_root)
    # 必填（无默认值，避免误用 SQLite）。见 backend/.env 中 DATABASE_URL。
    # mysql+asyncmy://user:pass@host:3306/slideforge?charset=utf8mb4
    # 或显式 SQLite：sqlite+aiosqlite:////abs/path/slideforge.db
    database_url: str = ""

    @field_validator("storage_root", mode="after")
    @classmethod
    def _resolve_storage_root(cls, v: Path) -> Path:
        """相对路径相对于 backend 目录（与 .env 所在目录一致），避免随 uvicorn 启动目录变化。"""
        if v.is_absolute():
            return v
        return (_BACKEND_DIR / v).resolve()

    # 视频导出：Playwright 打开的放映页 origin（无前端进程时会连接失败）
    export_frontend_url: str = Field(
        default="http://127.0.0.1:3000",
        validation_alias=AliasChoices(
            "EXPORT_FRONTEND_URL",
            "SLIDEFORGE_FRONTEND_URL",
        ),
    )
    # 非空时优先于请求体里的 frontend_url：专用录屏实例（如 npm run dev:play 的 5174）
    export_play_origin: str = Field(
        default="",
        validation_alias=AliasChoices(
            "EXPORT_PLAY_ORIGIN",
            "SLIDEFORGE_EXPORT_PLAY_ORIGIN",
        ),
    )

    # 导出脚本拉取 play-manifest 的 API 根地址（子进程内访问，默认同机 8000）
    export_api_url: str = Field(
        default="http://127.0.0.1:8000",
        validation_alias=AliasChoices(
            "EXPORT_API_URL",
            "SLIDEFORGE_API_URL",
        ),
    )

    # 视频导出一律入队；Worker 请求头 X-SlideForge-Worker-Key 须与此一致（必填，否则无法导出）
    export_worker_token: str = Field(
        default="",
        validation_alias=AliasChoices(
            "EXPORT_WORKER_TOKEN",
            "SLIDEFORGE_WORKER_KEY",
            "SLIDEFORGE_WORKER_TOKEN",
        ),
    )
    # 远程 worker 用 HTTP 拉取 /media/... 音频时的站点根（通常与对外 API 同源，如 https://api.example.com）
    export_public_base_url: str = Field(
        default="",
        validation_alias=AliasChoices(
            "EXPORT_PUBLIC_BASE_URL",
            "SLIDEFORGE_PUBLIC_BASE_URL",
        ),
    )
    export_job_running_timeout_seconds: int = 7200
    export_upload_max_bytes: int = 1_073_741_824

    # 默认禁用遗留开发后门；仅在显式设置时才允许 Bearer legacy。
    legacy_dev_auth_enabled: bool = False
    auth_session_ttl_days: int = 30

    # 火山引擎账号 AK/SK（控制台 IAM，与豆包语音「应用」的 AppId/AccessToken 不同）。
    # 配置后可由后端调用 ResourcePacksStatus 展示语音合成 2.0 试用字数余量（barevid 宣传页）。
    volcengine_access_key: str = ""
    volcengine_secret_key: str = ""
    # ResourcePacksStatus 的 ProjectName，控制台未改时一般为 default
    barevid_volcengine_project_name: str = "default"
    # 宣传页 barevidweb：无 DEEPSEEK_API_KEY 或余额接口失败时的兜底展示文案（可留空）
    barevid_deepseek_balance_display: str = ""
    # 无火山 AK/SK 或 ResourcePacksStatus 失败时的豆包试用展示文案（可留空）
    barevid_doubao_trial_display: str = ""
    # 逗号分隔的额外 CORS 源，例如 https://barevid.example.com,http://127.0.0.1:9080
    cors_extra_origins: str = ""

    # 并发控制：限制重任务同时运行数量，避免数据库锁争用与外部 API 限流。
    # 豆包 TTS 账号级并发常见为 10，请在 .env 设 TTS_CONCURRENCY_LIMIT（勿超过控制台配额）。
    tts_concurrency_limit: int = Field(default=5, ge=1, le=64)
    deck_page_concurrency_limit: int = 5
    audio_pipeline_timeout_seconds: int = 600
    deck_pipeline_timeout_seconds: int = 900
    # 单页演示生成超过该时长仍处于 generating，则判定为失败，避免前端长期转圈
    deck_page_generating_timeout_seconds: int = 600

    # --- 片头/片尾配置（暂不使用；恢复时取消注释并在 worker_claim 中取消对应逻辑注释）---
    # export_intro_duration_ms: int = Field(
    #     default=0,
    #     ge=0,
    #     description="片头时长（毫秒）；0 表示不插入",
    # )
    # export_outro_duration_ms: int = Field(
    #     default=0,
    #     ge=0,
    #     description="片尾时长（毫秒）；0 表示不插入",
    # )


settings = Settings()
