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
    # 放映页 HTML（JSON 包一大段字符串）易触顶截断，适当加大；0 表示交给 API 默认
    deepseek_deck_max_tokens: int = 8192
    deepseek_fim_enabled: bool = True
    # FIM 单次 max_tokens 上限（官方说明约 4K）
    deepseek_fim_max_tokens: int = 4096
    # DeepSeek 调用 asyncio 超时（秒，内部至少 30s）：结构化/JSON 修复/FIM 等
    deepseek_request_timeout_seconds: int = 240
    # 多页 HTML 生成往往更久
    deepseek_deck_timeout_seconds: int = 720
    # 风格母版纯文本一次调用
    deepseek_style_timeout_seconds: int = 180

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

    storage_root: Path = Field(default_factory=_default_storage_root)

    @field_validator("storage_root", mode="after")
    @classmethod
    def _resolve_storage_root(cls, v: Path) -> Path:
        """相对路径相对于 backend 目录（与 .env 所在目录一致），避免随 uvicorn 启动目录变化。"""
        if v.is_absolute():
            return v
        return (_BACKEND_DIR / v).resolve()

    # 视频导出：Playwright 打开的放映页 origin（无前端进程时会连接失败）
    export_frontend_url: str = "http://127.0.0.1:5173"
    # 非空时优先于请求体里的 frontend_url：专用录屏实例（如 npm run dev:play 的 5174）
    export_play_origin: str = ""

    # 导出脚本拉取 play-manifest 的 API 根地址（子进程内访问，默认同机 8000）
    export_api_url: str = "http://127.0.0.1:8000"

    # 片头/片尾：Playwright 固定时长录制（无独立音轨，导出脚本在音轨首尾拼静音）；0 表示不启用
    export_intro_duration_ms: int = Field(
        default=0,
        validation_alias=AliasChoices(
            "EXPORT_INTRO_DURATION_MS",
            "SLIDEFORGE_EXPORT_INTRO_MS",
        ),
    )
    export_outro_duration_ms: int = Field(
        default=0,
        validation_alias=AliasChoices(
            "EXPORT_OUTRO_DURATION_MS",
            "SLIDEFORGE_EXPORT_OUTRO_MS",
        ),
    )

    # 并发控制：限制重任务同时运行数量，避免数据库锁争用与外部 API 限流
    tts_concurrency_limit: int = 5
    deck_page_concurrency_limit: int = 5
    # 单页演示生成超过该时长仍处于 generating，则判定为失败，避免前端长期转圈
    deck_page_generating_timeout_seconds: int = 600


settings = Settings()
