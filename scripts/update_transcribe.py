import re

# Read current file
with open('backend/services/transcribe.py', 'r') as f:
    content = f.read()

# New translate_and_synthesize method with HF API integration
new_method = '''    async def translate_and_synthesize(
        self,
        source_text: str,
        target_language: str = "ru",
        voice_prompt: Optional[dict] = None,
    ):
        """
        Translate source text to target language and synthesize audio.
        
        Uses Hugging Face Seamless M4T Large API for translation when targeting Russian.
        Falls back to returning source text unchanged if HF token is missing or service unavailable.

        Args:
            source_text: The original text in source language (e.g., English).
            target_language: Target language code (e.g., "ru" for Russian, "es" for Spanish).
            voice_prompt: Optional dict with reference audio path and reference text.

        Returns:
            Tuple of (translated_text, audio_path, duration_seconds, engine_used)
        """
        import logging
        from huggingface_hub import InferenceClient

        logger = logging.getLogger(__name__)
        
        # Try to translate using Hugging Face Seamless M4T Large API
        try:
            client = InferenceClient(timeout=120)  # Add timeout for reliability
            
            if target_language == "ru":
                russian_text = client.pipeline(
                    "seamless-m4t-large",
                    text=source_text,
                    task="translate",
                    source_lang="auto",
                    target_lang=target_language
                )
            else:
                # For non-Russian targets, return as-is (F5-TTS RU backend is Russian-focused)
                russian_text = source_text
                
            translated_text = str(russian_text).strip()
            logger.info(f"Translated to {target_language}: {translated_text[:100]}...")
            
        except Exception as e:
            logger.warning(f"HF Seamless M4T translation failed: {e}")
            # Fallback: return source text unchanged
            translated_text = source_text
        
        backend = self._get_backend()

        # If no voice prompt is provided, return without audio synthesis
        if not voice_prompt:
            return (translated_text, None, 0, "f5tts_ru_no_voice")

        # Load the F5-TTS RU backend model if not already loaded
        import asyncio
        await asyncio.to_thread(backend.load_model)

        try:
            # Generate audio with reference voice prompt
            audio_array, sample_rate = await backend.generate(
                text=translated_text,
                voice_prompt=voice_prompt,
                language=target_language
            )

            duration_seconds = len(audio_array) / sample_rate
            
            # Save audio to a temporary file
            import tempfile
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                from scipy.io.wavfile import write as wav_write
                wav_write(tmp.name, int(sample_rate), audio_array.astype('int16'))
                audio_path = tmp.name
            
            return (translated_text, audio_path, duration_seconds, "f5tts_ru_with_voice")
            
        finally:
            # Unload model to free memory
            backend.unload_model()
'''

# Find and replace the method - look for the function definition through its closing
pattern = r'(    async def translate_and_synthesize\([^)]+\):.*?)(?=\n    \w|\nclass |\Z)'
replacement = new_method + '\n'

content = re.sub(pattern, replacement, content, flags=re.DOTALL)

# Write updated file
with open('backend/services/transcribe.py', 'w') as f:
    f.write(content)

print("Updated translate_and_synthesize method with HF API integration")
