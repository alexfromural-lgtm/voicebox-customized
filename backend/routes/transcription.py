"""Transcription endpoints."""

import asyncio
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile

from .. import models
from ..backends import WHISPER_HF_REPOS
from ..services.transcribe import TranslateAndSynthesizeService
from ..services import transcribe as stt_transcribe
from ..services.task_queue import create_background_task
from ..utils.tasks import get_task_manager

router = APIRouter()

UPLOAD_CHUNK_SIZE = 1024 * 1024  # 1MB


@router.post("/transcribe", response_model=models.TranscriptionResponse)
async def transcribe_audio(
    file: UploadFile = File(...),
    language: str | None = Form(None),
    model: str | None = Form(None),
):
    """Transcribe audio file to text."""
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        while chunk := await file.read(UPLOAD_CHUNK_SIZE):
            tmp.write(chunk)
        tmp_path = tmp.name

    try:
        from ..utils.audio import load_audio

        audio, sr = await asyncio.to_thread(load_audio, tmp_path)
        duration = len(audio) / sr

        whisper_model = stt_transcribe.get_whisper_model()
        model_size = model if model else whisper_model.model_size

        valid_sizes = list(WHISPER_HF_REPOS.keys())
        if model_size not in valid_sizes:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid model size '{model_size}'. Must be one of: {', '.join(valid_sizes)}",
            )

        already_loaded = whisper_model.is_loaded() and whisper_model.model_size == model_size
        if not already_loaded and not whisper_model._is_model_cached(model_size):
            progress_model_name = f"whisper-{model_size}"
            task_manager = get_task_manager()

            async def download_whisper_background():
                try:
                    await whisper_model.load_model_async(model_size)
                    task_manager.complete_download(progress_model_name)
                except Exception as e:
                    task_manager.error_download(progress_model_name, str(e))

            task_manager.start_download(progress_model_name)
            create_background_task(download_whisper_background())

            raise HTTPException(
                status_code=202,
                detail={
                    "message": f"Whisper model {model_size} is being downloaded. Please wait and try again.",
                    "model_name": progress_model_name,
                    "downloading": True,
                },
            )

        text = await whisper_model.transcribe(tmp_path, language, model_size)

        return models.TranscriptionResponse(
            text=text,
            duration=duration,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        Path(tmp_path).unlink(missing_ok=True)


@router.post("/transcribe_and_synth", response_model=models.TranslateAndSynthesizeResponse)
async def transcribe_and_synthesize(request: Request):
    """
    Seamless translation and synthesis endpoint.
    
    Converts source text to target language, then synthesizes in the voice
    of a reference speaker (if provided). The f5tts_ru backend automatically
    converts Russian Cyrillic to phonetic representation with stress markers,
    providing accurate pronunciation by teaching the model acoustic properties
    of stressed vs unstressed vowels.

    For English source text with Russian target: G2P conversion is skipped as
    English has no stress-marked phonemes in this implementation. The F5-TTS
    model handles both languages natively without additional conversion.
    """
    try:
        from ..backends.f5tts_ru_backend import F5TTSRuBackend

        service = TranslateAndSynthesizeService(F5TTSRuBackend)

        async def get_body():
            return await request.body()

        body = await get_body()
        
        import json
        try:
            data = json.loads(body)
            source_text = data.get("source_text", "")
            target_language = data.get("target_language", "ru")
            voice_prompt = data.get("voice_prompt")
        except Exception as e:
            print(f"Error parsing request body: {e}")
            raise HTTPException(status_code=400, detail="Invalid JSON in request body")

        # Await the async translate_and_synthesize method
        result = await service.translate_and_synthesize(
            source_text=source_text,
            target_language=target_language,
            voice_prompt=voice_prompt
        )
        
        translated_text, audio_path, duration, engine_used = result

        return models.TranslateAndSynthesizeResponse(
            source_text=source_text,
            target_language=target_language,
            translated_text=translated_text,
            audio_path=audio_path,
            duration=duration,
            engine_used=engine_used
        )
    except Exception as e:
        import traceback
        print(f"Error in transcribe_and_synth: {e}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/translate", response_model=dict)
async def translate_audio(
    source_audio: UploadFile = File(..., description="Source audio in any language"),
    target_language: str = Form("rus", description="Target language code (default: rus for Russian)"),
):
    """Translate speech from any language to Russian text using HuggingFace Seamless M4T."""
    
    # Read audio file
    audio_bytes = await source_audio.read()
    
    try:
        # Save to temp file for HF API processing
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name
        
        try:
            # Use HuggingFace InferenceAPI for Seamless M4T translation
            from huggingface_hub import InferenceClient
            
            client = InferenceClient(token=None)  # Use default token or set HF_TOKEN env var
            
            result = client.pipeline(
                "seamless-m4t-large",
                audio=audio_bytes,
                task="translate",
                source_lang="auto",
                target_lang=target_language
            )
            
            return {
                "translated_text": str(result),
                "target_language": target_language
            }
        finally:
            Path(tmp_path).unlink(missing_ok=True)
            
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Translation service unavailable: {str(e)}")

@router.post("/translate_audio", response_model=models.TranslateAndSynthesizeResponse)
async def translate_audio_text(request: Request):
    """
    Translate text to target language and synthesize audio.
    
    Accepts JSON with source_text, target_language, and optional voice_prompt.
    Uses Seamless M4T for translation + F5-TTS Ru for synthesis.

    Example request body:
        {
            "source_text": "Hello world",
            "target_language": "ru"
        }

    Response includes translated text and audio file path.
    """
    try:
        from ..backends.f5tts_ru_backend import F5TTSRuBackend

        service = TranslateAndSynthesizeService(F5TTSRuBackend)

        async def get_body():
            return await request.body()

        body = await get_body()
        
        import json
        try:
            data = json.loads(body)
            source_text = data.get("source_text", "")
            target_language = data.get("target_language", "ru")
            voice_prompt = data.get("voice_prompt")
        except Exception as e:
            print(f"Error parsing request body: {e}")
            raise HTTPException(status_code=400, detail="Invalid JSON in request body")

        # Await the async translate_and_synthesize method
        result = await service.translate_and_synthesize(
            source_text=source_text,
            target_language=target_language,
            voice_prompt=voice_prompt
        )
        
        translated_text, audio_path, duration, engine_used = result

        return models.TranslateAndSynthesizeResponse(
            source_text=source_text,
            target_language=target_language,
            translated_text=translated_text,
            audio_path=audio_path,
            duration=duration,
            engine_used=engine_used
        )
    except Exception as e:
        import traceback
        print(f"Error in translate_audio: {e}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))



@router.post("/translate-and-synthesize", response_model=dict)
async def translate_and_synthesize_frontend(request: Request):
    """
    Translate text and synthesize audio (frontend-friendly endpoint).
    
    Accepts JSON with `text` and `language`.
    Returns `{ status, translatedText, audioUrl, error }`.

    Example request body:
        {
            "text": "Hello world",
            "language": "ru"
        }

    Response:
        {
          "status": "success|error",
          "translated_text": "Привет мир",
          "audio_url": "/api/audio/xxx",
          "error": null
        }
    """
    try:
        from ..backends.f5tts_ru_backend import F5TTSRuBackend

        service = TranslateAndSynthesizeService(F5TTSRuBackend)

        async def get_body():
            return await request.body()

        body = await get_body()
        
        import json
        try:
            data = json.loads(body)
            source_text = data.get("text", "") or data.get("source_text", "")
            target_language = data.get("language", "ru") or data.get("target_language", "ru")
            voice_prompt = data.get("voice_prompt")
        except Exception as e:
            print(f"Error parsing request body: {e}")
            raise HTTPException(status_code=400, detail="Invalid JSON in request body")

        # Await the async translate_and_synthesize method
        result = await service.translate_and_synthesize(
            source_text=source_text,
            target_language=target_language,
            voice_prompt=voice_prompt
        )
        
        translated_text, audio_path, duration, engine_used = result
        
        # Build the URL for the frontend to download the audio
        from ..app import app as main_app
        audio_url = f"/api/audio/{audio_path}"

        return {
            "status": "success",
            "translated_text": translated_text,
            "audio_url": audio_url,
            "engine_used": engine_used
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"Error in translate_and_synthesize_frontend: {e}")
        print(traceback.format_exc())
        return {
            "status": "error",
            "translated_text": None,
            "audio_url": None,
            "error": str(e)
        }
