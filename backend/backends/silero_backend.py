"""
Silero TTS backend implementation.

Provides 5 native Russian preset voices (aidar, baya, kseniya, xenia, eugene)
using the Silero v4_ru model. Loaded via torch.package.PackageImporter directly
from the model file — no silero PyPI package required at inference time.

Model source: https://models.silero.ai/models/tts/ru/v4_ru.pt
Stored in:    {HF_HUB_CACHE}/silero-tts-ru/v4_ru.pt

Languages: Russian (ru) — primary; model supports CIS languages via speaker
Sample rate: 24000 Hz
Type: Preset voices (no voice cloning from reference audio)
"""

import asyncio
import logging
import os
from pathlib import Path
from typing import Optional

import numpy as np

from . import TTSBackend
from .base import (
    get_torch_device,
    combine_voice_prompts as _combine_voice_prompts,
    model_load_progress,
)

logger = logging.getLogger(__name__)

SILERO_V4_RU_URL = "https://models.silero.ai/models/tts/ru/v4_ru.pt"
SILERO_MODEL_FILENAME = "v4_ru.pt"
SILERO_SAMPLE_RATE = 48000

# All available voices in the Silero v4_ru model
SILERO_VOICES = [
    ("aidar", "Aidar", "male", "ru"),
    ("baya", "Baya", "female", "ru"),
    ("kseniya", "Kseniya", "female", "ru"),
    ("xenia", "Xenia", "female", "ru"),
    ("eugene", "Eugene", "male", "ru"),
]

SILERO_DEFAULT_VOICE = "xenia"


def _get_model_cache_path() -> Path:
    """Return path where the Silero model file is stored (inside HF hub cache dir)."""
    from huggingface_hub import constants as hf_constants

    cache_dir = Path(hf_constants.HF_HUB_CACHE) / "silero-tts-ru"
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir / SILERO_MODEL_FILENAME


class SileroTTSBackend:
    """
    Silero v4_ru preset-voice TTS backend.

    Uses 5 built-in Russian speaker identities (aidar, baya, kseniya, xenia,
    eugene). Generates speech at 24 kHz via torch.package-packaged model.
    Does not support voice cloning from reference audio.
    """

    def __init__(self):
        self._model = None
        self._device: Optional[str] = None
        self.model_size = "default"

    def _get_device(self) -> str:
        return get_torch_device()

    @property
    def device(self) -> str:
        if self._device is None:
            self._device = self._get_device()
        return self._device

    def is_loaded(self) -> bool:
        return self._model is not None

    def _get_model_path(self, model_size: str = "default") -> str:
        return "snakers4/silero-models"  # display reference only

    def _is_model_cached(self, model_size: str = "default") -> bool:
        """Check if the Silero v4_ru model file exists locally."""
        return _get_model_cache_path().exists()

    def _download_model(self, model_path: Path) -> None:
        """Download v4_ru.pt from Silero CDN using httpx with progress reporting."""
        import httpx
        from ..utils.progress import get_progress_manager
        from ..utils.tasks import get_task_manager

        progress_manager = get_progress_manager()
        task_manager = get_task_manager()

        task_manager.start_download("silero-ru")
        progress_manager.update_progress(
            model_name="silero-ru",
            current=0,
            total=0,
            filename="Connecting to models.silero.ai...",
            status="downloading",
        )

        logger.info("Downloading Silero v4_ru from %s", SILERO_V4_RU_URL)
        tmp_path = model_path.with_suffix(".pt.tmp")

        try:
            with httpx.stream("GET", SILERO_V4_RU_URL, follow_redirects=True, timeout=300) as resp:
                resp.raise_for_status()
                total = int(resp.headers.get("content-length", 0))
                downloaded = 0

                with open(tmp_path, "wb") as f:
                    for chunk in resp.iter_bytes(chunk_size=65536):
                        f.write(chunk)
                        downloaded += len(chunk)
                        if total > 0:
                            progress_manager.update_progress(
                                model_name="silero-ru",
                                current=downloaded,
                                total=total,
                                filename=SILERO_MODEL_FILENAME,
                                status="downloading",
                            )

            tmp_path.replace(model_path)
            task_manager.complete_download("silero-ru")
            logger.info("Silero v4_ru downloaded to %s", model_path)

        except Exception as e:
            if tmp_path.exists():
                tmp_path.unlink(missing_ok=True)
            task_manager.error_download("silero-ru", str(e))
            raise

    async def load_model(self, model_size: str = "default") -> None:
        """Load the Silero v4_ru model."""
        if self._model is not None:
            return
        await asyncio.to_thread(self._load_model_sync)

    def _load_model_sync(self) -> None:
        """Synchronous model loading — download if needed, then load via torch.package."""
        import torch

        model_path = _get_model_cache_path()
        is_cached = model_path.exists()

        if not is_cached:
            self._download_model(model_path)

        with model_load_progress("silero-ru", is_cached=True):
            logger.info("Loading Silero v4_ru from %s on %s...", model_path, self.device)

            imp = torch.package.PackageImporter(str(model_path))
            model = imp.load_pickle("tts_models", "model")
            model.to(self.device)
            self._model = model

        logger.info("Silero v4_ru loaded successfully")

    def unload_model(self) -> None:
        """Unload model to free memory."""
        if self._model is not None:
            del self._model
            self._model = None

            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()

            logger.info("Silero unloaded")

    async def create_voice_prompt(
        self,
        audio_path: str,
        reference_text: str,
        use_cache: bool = True,
    ) -> tuple[dict, bool]:
        """
        Silero uses preset voices — no reference audio.
        Returns the default voice prompt so callers work uniformly.
        """
        return {
            "voice_type": "preset",
            "preset_engine": "silero",
            "preset_voice_id": SILERO_DEFAULT_VOICE,
        }, False

    async def combine_voice_prompts(
        self,
        audio_paths: list[str],
        reference_texts: list[str],
    ) -> tuple[np.ndarray, str]:
        return await _combine_voice_prompts(audio_paths, reference_texts, sample_rate=SILERO_SAMPLE_RATE)

    async def generate(
        self,
        text: str,
        voice_prompt: dict,
        language: str = "ru",
        seed: Optional[int] = None,
        instruct: Optional[str] = None,
    ) -> tuple[np.ndarray, int]:
        """
        Generate speech with the selected Silero preset voice.

        Args:
            text: Russian text to synthesize.
                  Use + before stressed vowels for better quality
                  (e.g. "В н+едрах т+ундры в+ыдры").
            voice_prompt: Dict with preset_voice_id key.
            language: Ignored (model is Russian-only).
            seed: Random seed for reproducibility.
            instruct: Ignored.

        Returns:
            (audio_array, sample_rate)
        """
        await self.load_model()

        voice_id = (
            voice_prompt.get("preset_voice_id")
            or SILERO_DEFAULT_VOICE
        )
        # Validate voice ID
        valid_ids = {v[0] for v in SILERO_VOICES}
        if voice_id not in valid_ids:
            logger.warning("Unknown Silero voice '%s', falling back to '%s'", voice_id, SILERO_DEFAULT_VOICE)
            voice_id = SILERO_DEFAULT_VOICE

        def _generate_sync() -> tuple[np.ndarray, int]:
            import torch

            if seed is not None:
                torch.manual_seed(seed)
                if torch.cuda.is_available():
                    torch.cuda.manual_seed(seed)

            audio_tensor = self._model.apply_tts(
                text=text,
                speaker=voice_id,
                sample_rate=SILERO_SAMPLE_RATE,
                put_accent=True,
                put_yo=True,
            )

            if isinstance(audio_tensor, torch.Tensor):
                audio = audio_tensor.squeeze().cpu().numpy().astype(np.float32)
            else:
                audio = np.asarray(audio_tensor, dtype=np.float32).squeeze()

            return audio, SILERO_SAMPLE_RATE

        return await asyncio.to_thread(_generate_sync)
