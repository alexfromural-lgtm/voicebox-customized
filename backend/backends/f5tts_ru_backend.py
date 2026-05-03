"""
F5-TTS Russian backend with automatic stress marking.

Zero-shot voice cloning using the Misha24-10/F5-TTS_RUSSIAN fine-tune of F5-TTS.
Trained on 5000+ hours of Russian + English speech.

The model expects Cyrillic text with `+` placed immediately before the stressed
vowel (e.g. молок+о).  Russian input is automatically tagged by RUAccent before
synthesis; English input is passed through unchanged.

HuggingFace repo:  Misha24-10/F5-TTS_RUSSIAN  (public, CC-BY-NC-4.0)
Checkpoint:        F5TTS_v1_Base_v2/model_last_inference.safetensors
Vocab file:        F5TTS_v1_Base/vocab.txt
Vocoder:           charactr/vocos-mel-24khz

Languages:  Russian (primary), English
Type:       Voice cloning from reference audio (3+ seconds recommended)
Sample rate: 24000 Hz

License note: The upstream Russian fine-tune is CC-BY-NC-4.0 (non-commercial).
"""

import asyncio
import logging
import os
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np

from . import TTSBackend
from .base import (
    is_model_cached,
    get_torch_device,
    empty_device_cache,
    manual_seed,
    combine_voice_prompts as _combine_voice_prompts,
    model_load_progress,
)

logger = logging.getLogger(__name__)

# Import stress-marking utility for Russian
try:
    from ..utils.g2p_ru import convert_russian_to_phonetic, is_ruaccent_available
except ImportError as e:
    logger.debug("g2p_ru module not available: %s", e)

    def convert_russian_to_phonetic(text, force_en_phones=False):  # type: ignore[misc]
        return text, False

    def is_ruaccent_available() -> bool:  # type: ignore[misc]
        return False


F5TTS_RU_HF_REPO = "Misha24-10/F5-TTS_RUSSIAN"
VOCOS_HF_REPO = "charactr/vocos-mel-24khz"
F5_SAMPLE_RATE = 24000

# F5-TTS context window is finite; references longer than this produce garbled
# output because the combined (ref + gen) mel sequence exceeds the trained
# maximum duration.  15 s is well within the safe range while still giving the
# model enough voice characteristics to clone from.
_MAX_REF_AUDIO_SECONDS = 15

# Model architecture for F5-TTS Base (DiT backbone)
_MODEL_CFG = dict(
    dim=1024,
    depth=22,
    heads=16,
    ff_mult=2,
    text_dim=512,
    conv_layers=4,
)

# Required files for cache check
_REQUIRED_FILES = ["model_last_inference.safetensors"]


def _check_f5_cached() -> bool:
    """Check if F5-TTS Russian model is in the HF hub cache."""
    return is_model_cached(F5TTS_RU_HF_REPO, required_files=_REQUIRED_FILES)


class F5TTSRuBackend:
    """
    F5-TTS Russian voice cloning backend.

    Fine-tuned on 5000+ hours of Russian speech. Accepts a reference audio
    sample (3+ seconds) and reference text to clone the speaker's voice for
    arbitrary Russian or English target text.

    Voice prompt pattern: deferred file paths (Pattern B) — the reference
    audio is loaded at generation time, not pre-encoded.
    """

    def __init__(self):
        self._model = None
        self._vocoder = None
        self._device: Optional[str] = None
        self._model_load_lock = asyncio.Lock()
        self.model_size = "default"

    def _get_device(self) -> str:
        # F5-TTS sets PYTORCH_ENABLE_MPS_FALLBACK=1 at import; allow MPS
        return get_torch_device(allow_mps=True)

    @property
    def device(self) -> str:
        if self._device is None:
            self._device = self._get_device()
        return self._device

    def is_loaded(self) -> bool:
        return self._model is not None

    def _get_model_path(self, model_size: str = "default") -> str:
        return F5TTS_RU_HF_REPO

    def _is_model_cached(self, model_size: str = "default") -> bool:
        return _check_f5_cached()

    async def load_model(self, model_size: str = "default") -> None:
        """Load F5-TTS Russian model and Vocos vocoder."""
        if self._model is not None:
            return
        async with self._model_load_lock:
            if self._model is not None:
                return
            await asyncio.to_thread(self._load_model_sync)

    def _load_model_sync(self) -> None:
        """Synchronous model loading — downloads from HF if not cached."""
        model_name = "f5tts-ru"
        is_cached = _check_f5_cached()

        with model_load_progress(model_name, is_cached):
            from huggingface_hub import snapshot_download, hf_hub_download
            from huggingface_hub import constants as hf_constants

            device = self.device
            logger.info("Loading F5-TTS Russian on %s...", device)

            # Download full F5-TTS Russian repo (contains all checkpoints + vocab)
            local_path = snapshot_download(F5TTS_RU_HF_REPO, token=None)

            ckpt_path = os.path.join(local_path, "F5TTS_v1_Base_v2", "model_last_inference.safetensors")
            vocab_file = os.path.join(local_path, "F5TTS_v1_Base", "vocab.txt")

            if not os.path.exists(ckpt_path):
                raise FileNotFoundError(
                    f"F5-TTS Russian checkpoint not found at {ckpt_path}. "
                    "Try deleting the cached repo and re-downloading."
                )
            if not os.path.exists(vocab_file):
                raise FileNotFoundError(
                    f"F5-TTS Russian vocab file not found at {vocab_file}."
                )

            from f5_tts.model import DiT
            from f5_tts.infer.utils_infer import load_model, load_vocoder

            logger.info("Loading F5-TTS Russian model from %s", ckpt_path)
            self._model = load_model(
                DiT,
                _MODEL_CFG,
                ckpt_path,
                vocab_file=vocab_file,
                use_ema=True,
                device=device,
            )

            logger.info("Loading Vocos vocoder from %s", VOCOS_HF_REPO)
            self._vocoder = load_vocoder(
                "vocos",
                is_local=False,
                device=device,
                hf_cache_dir=hf_constants.HF_HUB_CACHE,
            )

        self._device = device
        logger.info("F5-TTS Russian loaded successfully")

    def unload_model(self) -> None:
        """Unload model and vocoder to free memory."""
        if self._model is not None:
            del self._model
            self._model = None
        if self._vocoder is not None:
            del self._vocoder
            self._vocoder = None

        if self._device:
            empty_device_cache(self._device)

        logger.info("F5-TTS Russian unloaded")

    async def create_voice_prompt(
        self,
        audio_path: str,
        reference_text: str,
        use_cache: bool = True,
    ) -> Tuple[dict, bool]:
        """
        Create voice prompt from reference audio.

        F5-TTS processes audio at generation time — stores deferred file path.
        Reference text should be the transcription of the reference audio.
        Leave reference_text empty to auto-transcribe (slower).
        """
        return {
            "ref_audio": str(audio_path),
            "ref_text": reference_text,
        }, False

    async def combine_voice_prompts(
        self,
        audio_paths: List[str],
        reference_texts: List[str],
    ) -> Tuple[np.ndarray, str]:
        return await _combine_voice_prompts(audio_paths, reference_texts, sample_rate=F5_SAMPLE_RATE)

    async def generate(
        self,
        text: str,
        voice_prompt: dict,
        language: str = "ru",
        seed: Optional[int] = None,
        instruct: Optional[str] = None,
    ) -> Tuple[np.ndarray, int]:
        """
        Generate speech by cloning voice from reference audio.

        Russian Cyrillic input is automatically tagged with `+` stress markers
        by RUAccent before synthesis (e.g. "хромосомы" → "хромос+омы").
        This matches the training format of the F5-TTS_RUSSIAN model.

        Args:
            text: Target text. Russian Cyrillic is stress-tagged automatically;
                  you may also pre-tag manually (e.g. "молок+о").
            voice_prompt: Dict with ref_audio (file path) and ref_text.
            language: Ignored — model handles ru/en natively.
            seed: Optional random seed.
            instruct: Ignored.

        Returns:
            (audio_array, sample_rate)
        """
        await self.load_model()

        # Insert + stress markers into Russian Cyrillic text
        is_ru_language = language.lower().startswith("ru") or any(
            char in text for char in "АаБбВвГгДдЕеЁёЖжЗзИиЙйКкЛлМмНнОоПпРрСсТтУуФфХхЦцЧчШщЪъЫыЬьЭэЮюЯя"
        )

        if is_ru_language and text.strip():
            logger.info("Tagging Russian stress markers...")
            stressed_text, success = convert_russian_to_phonetic(text)
            if success:
                logger.debug("Original: %s", text[:120])
                logger.debug("Stressed: %s", stressed_text[:120])
                text = stressed_text

        ref_audio = voice_prompt.get("ref_audio")
        ref_text = voice_prompt.get("ref_text", "")

        # Apply stress marking to ref_text too — the model was trained with + markers
        # in both reference and generated text; mismatched formats hurt stress accuracy.
        if ref_text and is_ru_language:
            stressed_ref, ref_ok = convert_russian_to_phonetic(ref_text)
            if ref_ok:
                ref_text = stressed_ref

        if ref_audio and not Path(ref_audio).exists():
            logger.warning("F5-TTS reference audio not found: %s", ref_audio)
            ref_audio = None

        def _generate_sync() -> Tuple[np.ndarray, int]:
            import torch
            import soundfile as sf
            from f5_tts.infer.utils_infer import infer_batch_process, chunk_text
            
            # Patch torchaudio.load to return empty tensor when ref_audio is None
            # This bypasses the torchcodec dependency issue
            original_load = None
            def patched_load(filepath, mode=None, channels=None, frame_offset=0, duration=None):
                """Mock load that returns a 0.5s silence tensor for None paths."""
                if filepath is None:
                    import numpy as np
                    sr_mock = self.device == "cuda" and 24000 or F5_SAMPLE_RATE
                    return torch.zeros(1, int(0.5 * sr_mock), dtype=torch.float32), sr_mock
                return original_load(filepath, mode=mode, channels=channels, frame_offset=frame_offset, duration=duration)

            if seed is not None:
                manual_seed(seed, self.device)
            
            # Patch only for this generation call
            try:
                import torchaudio
                original_load = torchaudio.load
                torchaudio.load = patched_load
            except Exception as e:
                logger.warning(f"Could not patch torchaudio.load: {e}")

            # Always compute gen_text_batches so it is available in both branches
            gen_text_batches = chunk_text(text)

            if ref_audio:
                audio_data, sr = sf.read(ref_audio, dtype="float32")
                if audio_data.ndim > 1:
                    audio_data = audio_data.mean(axis=1)

                # Trim over-long reference audio to avoid exceeding the model's
                # context window.  Scale the reference text by the same ratio so
                # the phoneme-to-frame alignment stays consistent.
                max_samples = int(_MAX_REF_AUDIO_SECONDS * sr)
                if len(audio_data) > max_samples:
                    ratio = max_samples / len(audio_data)
                    audio_data = audio_data[:max_samples]
                    trimmed_chars = max(1, int(len(ref_text) * ratio))
                    effective_ref_text = ref_text[:trimmed_chars]
                    logger.debug(
                        "F5-TTS: reference audio trimmed to %ds (%.1fs original); "
                        "ref_text trimmed to %d/%d chars",
                        _MAX_REF_AUDIO_SECONDS,
                        len(audio_data) / sr / ratio,
                        trimmed_chars,
                        len(ref_text),
                    )
                else:
                    effective_ref_text = ref_text

                # Append a short silence to the END of the reference audio so
                # the mel-spectrogram boundary (ref_audio_len cut point inside
                # infer_batch_process) falls within a quiet region rather than
                # right at a voiced frame.  This prevents the model's attention
                # from "bleeding" the reference tail into the first generated
                # frames, which is the source of the leading noise artifact.
                silence_pad = int(0.30 * sr)  # 300 ms of zeros at native sr
                audio_data = np.concatenate(
                    [audio_data, np.zeros(silence_pad, dtype=audio_data.dtype)]
                )

                ref_audio_tuple = (
                    torch.from_numpy(audio_data).unsqueeze(0),  # [1, T]
                    sr,
                )
            else:
                # No reference audio - generate without voice cloning using standard f5_tts
                logger.warning("No reference audio — generating without voice cloning")

                # Create a minimal valid reference audio tensor (0.5s silence at F5 sample rate)
                ref_audio_tensor = torch.zeros(1, int(0.5 * F5_SAMPLE_RATE), dtype=torch.float32)
                ref_audio_tuple = (ref_audio_tensor, F5_SAMPLE_RATE)

                # Normalize text ending for voice cloning mode
                norm_text = text.strip()
                if norm_text and not norm_text.endswith((".", "。", " ")):
                    norm_text += ". "

                # Use infer_batch_process with minimal ref audio - this will use the empty tensor
                # provided above instead of trying to load a file
                gen_text_batches = chunk_text(norm_text)  # override with normalised text
                
                result = next(
                    infer_batch_process(
                        ref_audio_tuple,
                        norm_text,
                        gen_text_batches,
                        self._model,
                        self._vocoder,
                        mel_spec_type="vocos",
                        device=self.device,
                    )
                )

                if result[0] is None:
                    return np.zeros(F5_SAMPLE_RATE, dtype=np.float32), F5_SAMPLE_RATE

                final_wave = np.asarray(result[0], dtype=np.float32)

                # Apply same audio processing (cut leading artifact, fade-in)
                cut_samples = int(0.10 * F5_SAMPLE_RATE)  # 100 ms
                if len(final_wave) > cut_samples:
                    final_wave = final_wave[cut_samples:]
                
                fade_samples = int(0.02 * F5_SAMPLE_RATE)  # 20 ms
                if len(final_wave) > fade_samples:
                    final_wave[:fade_samples] *= np.linspace(0.0, 1.0, fade_samples, dtype=np.float32)

                return final_wave, F5_SAMPLE_RATE
            
            # Normalise ref_text ending (required by F5-TTS internals) - only for voice cloning mode
            norm_ref_text = effective_ref_text.strip()
            if norm_ref_text and not norm_ref_text.endswith((".", "。", " ")):
                norm_ref_text += ". "

            result = next(
                infer_batch_process(
                    ref_audio_tuple,
                    norm_ref_text,
                    gen_text_batches,
                    self._model,
                    self._vocoder,
                    mel_spec_type="vocos",
                    device=self.device,
                )
            )

            if result[0] is None:
                return np.zeros(F5_SAMPLE_RATE, dtype=np.float32), F5_SAMPLE_RATE

            final_wave = np.asarray(result[0], dtype=np.float32)

            # Hard-cut the leading artifact from the mel-spectrogram boundary.
            cut_samples = int(0.10 * F5_SAMPLE_RATE)  # 100 ms
            if len(final_wave) > cut_samples:
                final_wave = final_wave[cut_samples:]

            # Short fade-in to smooth any remaining onset transient.
            fade_samples = int(0.02 * F5_SAMPLE_RATE)  # 20 ms
            if len(final_wave) > fade_samples:
                final_wave[:fade_samples] *= np.linspace(0.0, 1.0, fade_samples, dtype=np.float32)

            return final_wave, F5_SAMPLE_RATE

        return await asyncio.to_thread(_generate_sync)

    async def translate_and_synthesize(self, source_text: str, target_language: str, voice_prompt: dict) -> Tuple[np.ndarray, int]:
        """
        Translate text to target language and synthesize speech with voice cloning.

        For F5-TTS Russian backend, this is a simple passthrough since the model
        handles both Russian and English natively. The source_text will be used as-is
        if it's already in Russian or English; otherwise, external translation services
        should be used to convert the text first.

        Args:
            source_text: Text to translate (if needed) and synthesize.
            target_language: Target language code (e.g., "ru", "en"). Currently ignored - uses source_text as-is.
            voice_prompt: Dict with ref_audio (file path) and ref_text.

        Returns:
            (audio_array, sample_rate)
        """
        # For now, passthrough the source text directly since F5-TTS handles ru/en natively
        logger.info(f"Translating/synthesizing to {target_language}...")

        result = await self.generate(source_text, voice_prompt, language=target_language)
        
        if len(result[0]) > 0:
            logger.debug("Translation/synthesis completed successfully")
        else:
            logger.warning("Translation/synthesis produced no audio output")
            
        return result


# End of F5TTSRuBackend class
