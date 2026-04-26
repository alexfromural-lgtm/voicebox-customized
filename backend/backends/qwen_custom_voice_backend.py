"""
Qwen3-TTS CustomVoice backend implementation.

Wraps the Qwen3-TTS-12Hz CustomVoice model for preset-speaker TTS with
instruction-based style control. Uses the same qwen_tts library as the
Base model (pytorch_backend.py) but loads a different checkpoint and
calls generate_custom_voice() instead of generate_voice_clone().

Key differences from the Base engine:
  - Uses preset speakers (9 built-in voices) instead of zero-shot cloning
  - Supports instruct parameter for tone/emotion/prosody control
  - Two model sizes: 1.7B and 0.6B

Languages supported: zh, en, ja, ko, de, fr, ru, pt, es, it
All 9 preset speakers can generate speech in any supported language —
the language is passed as a parameter, not tied to the speaker identity.
"""

import asyncio
import logging
from typing import Optional

import numpy as np
import torch

from . import TTSBackend, LANGUAGE_CODE_TO_NAME
from .base import (
    is_model_cached,
    get_torch_device,
    combine_voice_prompts as _combine_voice_prompts,
    model_load_progress,
)

logger = logging.getLogger(__name__)

# ── Preset speakers ──────────────────────────────────────────────────

# (speaker_id, display_name, gender, native_language_code, description)
QWEN_CUSTOM_VOICES = [
    ("Vivian", "Vivian", "female", "zh", "Bright, slightly edgy young female voice"),
    ("Serena", "Serena", "female", "zh", "Warm, gentle young female voice"),
    ("Uncle_Fu", "Uncle Fu", "male", "zh", "Seasoned male voice with a low, mellow timbre"),
    ("Dylan", "Dylan", "male", "zh", "Youthful Beijing male voice with a clear, natural timbre"),
    ("Eric", "Eric", "male", "zh", "Lively Chengdu male voice with a slightly husky brightness"),
    ("Ryan", "Ryan", "male", "en", "Dynamic male voice with strong rhythmic drive"),
    ("Aiden", "Aiden", "male", "en", "Sunny American male voice with a clear midrange"),
    ("Ono_Anna", "Ono Anna", "female", "ja", "Playful Japanese female voice with a light, nimble timbre"),
    ("Sohee", "Sohee", "female", "ko", "Warm Korean female voice with rich emotion"),
]

QWEN_CV_DEFAULT_SPEAKER = "Ryan"

# HuggingFace repo IDs per model size
QWEN_CV_HF_REPOS = {
    "1.7B": "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
    "0.6B": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
}


class QwenCustomVoiceBackend(TTSBackend):
    """
    Backend for Qwen CustomVoice TTS engine.

    Uses preset speakers and instruction-based control (instruct parameter)
    to generate speech with different tones, emotions, or prosody styles.

    Languages: zh, en, ja, ko, de, fr, ru, pt, es, it
    """

    ENGINE_ID = "qwen_custom_voice"

    def __init__(self):
        super().__init__()
        self.model_size = None
        self._current_model_size = None
        self.model = None
        self.processor = None
        self.device = None

    def is_loaded(self) -> bool:
        """Check if model is loaded."""
        return self.model is not None

    # All languages supported by the model regardless of speaker identity
    SUPPORTED_LANGUAGES = ["zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"]

    def get_supported_languages(self) -> list[str]:
        """Return list of ISO language codes supported by this engine."""
        return self.SUPPORTED_LANGUAGES

    def _is_model_cached(self, model_size: str = "1.7B") -> bool:
        """Check whether the model weights are present in the local HF cache."""
        repo_id = QWEN_CV_HF_REPOS.get(model_size, QWEN_CV_HF_REPOS["1.7B"])
        return is_model_cached(repo_id)

    async def load_model_async(self, model_size: Optional[str] = None) -> None:
        """
        Async entry point for loading (or hot-swapping) the CustomVoice model.

        Offloads the blocking HF download + model init to a thread-pool worker
        so the event loop stays responsive during the multi-second load.
        """
        if model_size is None:
            model_size = self.model_size or "1.7B"

        # Already loaded with the right size — nothing to do.
        if self.model is not None and self._current_model_size == model_size:
            return

        # Unload stale model before loading a new size.
        if self.model is not None and self._current_model_size != model_size:
            self.unload_model()

        await asyncio.to_thread(self._load_model_sync, model_size)

    # Alias expected by load_engine_model() and get_model_load_func()
    load_model = load_model_async

    def _load_model_sync(self, model_size: str) -> None:
        """Blocking model load — runs inside a thread-pool worker."""
        model_name = f"qwen-custom-voice-{model_size}"
        repo_id = QWEN_CV_HF_REPOS[model_size]
        is_cached = is_model_cached(repo_id)

        self.device = get_torch_device()

        with model_load_progress(model_name, is_cached):
            try:
                from qwen_tts import Qwen3TTSModel
            except ImportError:
                raise RuntimeError(
                    "Please install qwen-tts package. Run:\n  pip install qwen-tts"
                )

            from huggingface_hub import constants as hf_constants
            cache_dir = hf_constants.HF_HUB_CACHE

            # Qwen3TTSModel.from_pretrained loads model + processor in one call.
            if self.device == "cpu":
                self.model = Qwen3TTSModel.from_pretrained(
                    repo_id,
                    cache_dir=cache_dir,
                    torch_dtype=torch.float32,
                    low_cpu_mem_usage=False,
                )
            else:
                self.model = Qwen3TTSModel.from_pretrained(
                    repo_id,
                    cache_dir=cache_dir,
                    device_map=self.device,
                    torch_dtype=torch.bfloat16,
                )

        self.model_size = model_size
        self._current_model_size = model_size
        logger.info(f"QwenCustomVoice {model_size} model loaded successfully.")

    def unload_model(self) -> None:
        """Release GPU memory and clear model references."""
        if self.model is not None:
            del self.model
            self.model = None
        self._current_model_size = None

        from .base import empty_device_cache
        if self.device:
            empty_device_cache(self.device)

    async def create_voice_prompt(
        self,
        audio_path: str,
        reference_text: str,
        use_cache: bool = True,
    ) -> tuple[dict, bool]:
        """
        CustomVoice doesn't use reference audio — it uses preset speakers.
        Returns a minimal dict pointing at the default speaker so callers
        that expect a voice_prompt dict still work.
        """
        return {
            "voice_type": "preset",
            "preset_engine": "qwen_custom_voice",
            "preset_voice_id": QWEN_CV_DEFAULT_SPEAKER,
        }, False

    async def combine_voice_prompts(
        self,
        audio_paths: list[str],
        reference_texts: list[str],
    ) -> tuple[np.ndarray, str]:
        return await _combine_voice_prompts(audio_paths, reference_texts)

    async def get_speakers(
        self, lang: Optional[str] = None
    ) -> list[dict]:
        """Return all preset speakers from the CustomVoice library."""
        return [
            {"speaker_id": s[0], "display_name": s[1]} for s in QWEN_CUSTOM_VOICES
        ]

    async def generate(
        self,
        text: str,
        voice_prompt: dict,
        language: str = "en",
        seed: Optional[int] = None,
        instruct: Optional[str] = None,
    ) -> tuple[np.ndarray, int]:
        """
        Generate audio using Qwen CustomVoice.

        Args:
            text: Text to synthesize.
            voice_prompt: Dict with preset_voice_id (speaker name).
            language: Language code (zh, en, ja, ko, ru, etc.).
            seed: Random seed for reproducibility.
            instruct: Natural language instruction for style control
                      (e.g. "Speak in an angry tone", "Very happy").

        Returns:
            Tuple of (audio_array, sample_rate).
        """
        await self.load_model_async(None)

        speaker = voice_prompt.get("preset_voice_id") or QWEN_CV_DEFAULT_SPEAKER

        def _generate_sync():
            if seed is not None:
                torch.manual_seed(seed)
                if torch.cuda.is_available():
                    torch.cuda.manual_seed(seed)

            lang_name = LANGUAGE_CODE_TO_NAME.get(language, "auto")

            gen_kwargs = {
                "text": text,
                "language": lang_name.capitalize() if lang_name != "auto" else "Auto",
                "speaker": speaker,
            }

            if instruct:
                gen_kwargs["instruct"] = instruct

            wavs, sr = self.model.generate_custom_voice(**gen_kwargs)
            return wavs[0], sr

        audio, sample_rate = await asyncio.to_thread(_generate_sync)
        return audio, sample_rate

    async def get_model_info(self) -> dict:
        """Return model metadata (size, repo URL, supported languages, etc.)."""
        return {
            "engine": self.ENGINE_ID,
            "model_size": self.model_size or "unknown",
            "repo_url": QWEN_CV_HF_REPOS.get(self.model_size, ""),
            "languages": self.get_supported_languages(),
            "num_speakers": len(QWEN_CUSTOM_VOICES),
        }



# ── Factory functions ─────────────────────────────────────────────────

def create_qwen_custom_voice_backend(
    model_size: str = "1.7B", device_id: Optional[int] = None, use_fp8: bool = False
) -> QwenCustomVoiceBackend:
    """Factory function to create a new CustomVoice backend instance."""
    return QwenCustomVoiceBackend()


def get_available_model_sizes() -> list[str]:
    """Return list of available model sizes for the CustomVoice engine."""
    return list(QWEN_CV_HF_REPOS.keys())


