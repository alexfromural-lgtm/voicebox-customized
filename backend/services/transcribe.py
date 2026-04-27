"""
STT (Speech-to-Text) module - delegates to backend abstraction layer.
Also provides TTS translation and synthesis service.
"""

from typing import Optional, Any, Tuple, Type, List
import tempfile
from pathlib import Path


def get_whisper_model():
    """Get the Whisper STT model instance from the backend."""
    from ..backends import get_stt_backend
    
    stt_backend = get_stt_backend()
    
    # The STT backend is shared across all Whisper model sizes
    # Return the backend itself so callers can load specific models as needed
    return stt_backend


def unload_whisper_model():
    """Unload Whisper model to free memory."""
    from ..backends import get_stt_backend
    
    stt_backend = get_stt_backend()
    
    if stt_backend.is_loaded():
        stt_backend.unload_model()


class TranslateAndSynthesizeService:
    """
    Service for translating text and synthesizing speech.
    
    Uses Seamless M4T for translation and a configurable TTS backend
    (e.g., F5-TTS Ru) for synthesis with optional voice cloning.
    """
    
    def __init__(self, tts_backend_class: Type):
        """
        Initialize the service with a TTS backend class.
        
        Args:
            tts_backend_class: The TTS backend class to use for synthesis.
        """
        self.tts_backend_class = tts_backend_class
        self._tts_backend = None
    
    def _get_tts_backend(self) -> Any:
        """Lazy-load the TTS backend instance."""
        if self._tts_backend is None:
            from ..backends import get_tts_backend
            
            # Get or create the appropriate backend for this class
            if hasattr(get_tts_backend, '_backend_instances'):
                key = self.tts_backend_class.__name__
                if key not in get_tts_backend._backend_instances:
                    get_tts_backend._backend_instances[key] = self.tts_backend_class()
                self._tts_backend = get_tts_backend._backend_instances[key]
            else:
                # Fallback: create instance directly
                self._tts_backend = self.tts_backend_class()
        
        return self._tts_backend
    
    async def translate_and_synthesize(
        self,
        source_text: str,
        target_language: str,
        voice_prompt: Optional[dict] = None
    ) -> Tuple[str, str, float, str]:
        """
        Translate text to target language and synthesize speech.
        
        Args:
            source_text: The original text to translate and synthesize.
            target_language: Target language code (e.g., "ru", "en").
            voice_prompt: Optional dict with ref_audio (file path) and ref_text
                         for voice cloning. If not provided, generates without
                         specific voice characteristics.
        
        Returns:
            Tuple of (translated_text, audio_path, duration_seconds, engine_name)
        """
        import json
        
        # Step 1: Translate the text using Seamless M4T
        translated_text = await self._translate(source_text, target_language)
        
        # Step 2: Synthesize the translated text using the TTS backend
        tts_backend = self._get_tts_backend()
        
        if not voice_prompt:
            voice_prompt = {}
        
        # Generate audio from translated text
        audio_array, sample_rate = await tts_backend.generate(
            text=translated_text,
            voice_prompt=voice_prompt,
            language=target_language.lower().split('-')[0]  # Normalize to base language code
        )
        
        # Save the generated audio to a temporary file
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            import numpy as np
            import soundfile as sf
            
            if len(audio_array) > 0:
                sf.write(tmp.name, audio_array, sample_rate)
            
            duration = len(audio_array) / sample_rate if len(audio_array) > 0 else 0.0
        
        # Get the engine name for reporting
        engine_name = self.tts_backend_class.__name__
        
        return translated_text, tmp.name, duration, engine_name
    
    async def _translate(self, source_text: str, target_language: str) -> str:
        """
        Translate text using HuggingFace's Seamless M4T.
        
        Args:
            source_text: Text to translate.
            target_language: Target language code (e.g., "ru", "en").
        
        Returns:
            Translated text as string.
        """
        from huggingface_hub import InferenceClient
        
        # Use Seamless M4T for translation - using v1 API with explicit parameters
        client = InferenceClient(token=None)  # Uses default token or HF_TOKEN env var
        
        try:
            result = await client.translation(
                text=source_text,
                source_lang="auto",
                target_lang=target_language.lower()
            )
            
            # The translation method returns a dict with 'translation' key
            if isinstance(result, dict):
                translated = result.get("translation", "")
                if not translated:
                    return source_text
                return translated
            else:
                # Fallback - shouldn't happen
                return str(result) if result else source_text
        
        except Exception as e:
            import logging
            logger = logging.getLogger(__name__)
            logger.warning(f"Translation failed: {e}. Returning original text.")
            return source_text


# End of module
