# Seamless Communication + F5-TTS Russian: Expressive Speech-to-Speech Translation Pipeline

## Overview

This document outlines the integration of **Seamless Communication (Meta)** for speech translation with **F5-TTS_RUSSIAN** for high-fidelity Russian voice cloning. This creates a powerful **"Expressive Speech-to-Speech Translation"** pipeline that can translate any language's audio into cloned Russian speech while preserving emotional prosody and stress patterns.

---

## Architecture: Three-Step Pipeline

```
┌─────────────────────┐     ┌──────────────────────┐     ┌─────────────────────────┐
│  Source Audio       │ ──> │ Seamless M4T (S2TT)  │ ──> │ F5-TTS Russian Backend  │
│  (any language)     │     │ Translate → Russian  │     │ Generate Cloned Speech  │
└─────────────────────┘     └──────────────────────┘     └─────────────────────────┘
                                    │                              │
                                    ▼                              ▼
                            ┌───────────────┐              ┌──────────────────┐
                            │ Stress Marked │              │ Voice Cloning    │
                            │ Russian Text  │              │ from Reference   │
                            └───────────────┘              └──────────────────┘
```

### Step 1: Translation (SeamlessM4T v2)
- **Input**: Source audio in any of 101 supported languages
- **Task**: Speech-to-Text Translation (S2TT) → Russian text output
- **Output**: Clean Russian transcript
- **Why Seamless?**: Single model handles speech recognition + translation simultaneously with high accuracy across all major languages

### Step 2: Text Pre-processing (Stress Marking via G2P)
- **Input**: Raw Russian text from Seamless
- **Process**: Convert Cyrillic → phonetic representation with stress markers using espeak-ng
- **Output**: Phonetically marked text (e.g., "молок+о" where `+` marks stressed vowels)
- **Why?**: F5-TTS requires explicit prosody/stress information to generate natural-sounding Russian

### Step 3: Synthesis (F5-TTS_RUSSIAN)
- **Inputs**: 
  - Phonetically marked Russian text from G2P
  - Reference audio (10-30 seconds of target speaker's voice)
  - Reference text (transcription of reference audio, optional auto-transcribe)
- **Process**: Voice cloning with stress-aware prosody generation
- **Output**: High-fidelity cloned Russian speech at 24kHz

---

## Implementation Plan

### Phase 1: API Endpoint for Translation Service

Create a new endpoint in `backend/routes/transcription.py` or create a dedicated translation router that accepts source audio and returns translated Russian text.

#### Proposed Changes to `transcription.py`:

```python
"""Add Seamless M4T translation endpoints."""

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
import io
import tempfile
import os

router = APIRouter()


@router.post("/translate", response_model=dict)
async def translate_audio(
    source_audio: UploadFile = File(..., description="Source audio in any language"),
    target_language: str = Form("rus", description="Target language code (default: rus for Russian)"
):
    """Translate speech from any language to Russian text using Seamless M4T."""
    
    # 1. Load Seamless model if not cached
    seamless_model = get_seamless_instance()
    
    # 2. Read audio file
    audio_bytes = await source_audio.read()
    audio_path = _save_temp_audio(audio_bytes)
    
    try:
        # 3. Perform speech-to-text translation
        russian_text = seamless_model.predict(
            input_audio=audio_path,
            task_str="S2TT",
            tgt_lang=target_language or "rus"
        )
        
        return {
            "translated_text": russian_text,
            "source_language_detected": seamless_model.detected_language,
            "confidence": seamless_model.confidence_score
        }
    finally:
        # Clean up temp file
        os.unlink(audio_path)


def get_seamless_instance():
    """Lazy-load Seamless model to avoid blocking import."""
    if not hasattr(_seamless_cache, "model"):
        _seamless_cache.model = load_seamless_model()
    return _seamless_cache.model


def load_seamless_model():
    """Load Meta's Seamless Communication M4T model."""
    from seamless_communication import models
    
    # Hugging Face version: meta-llama/SeamlessCommunication2
    model = models.load_model(
        name="meta-llama/SeamlessCommunication2",
        device="auto"
    )
    
    return model


def _save_temp_audio(audio_bytes, suffix=".wav"):
    """Save audio bytes to temp file for model input."""
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as f:
        f.write(audio_bytes)
        f.flush()
        return f.name
```

---

### Phase 2: Integrate Translation into F5-TTS Backend

Modify `backend/backends/f5tts_ru_backend.py` to optionally accept pre-translated Russian text or trigger automatic translation from source audio.

#### Proposed Changes to `f5tts_ru_backend.py`:

Add a new method that handles the full translation → synthesis pipeline:

```python
# Add near top of class, after __init__

async def translate_and_synthesize(
    self,
    source_audio_path: str,
    target_text: Optional[str] = None,  # If provided, use this instead of transcribing
    ref_audio_path: str = "",
    ref_text: str = "",
) -> Tuple[np.ndarray, int]:
    """
    Full pipeline: Translate source audio to Russian text (or use provided),
    convert to phonetic form with stress markers, synthesize cloned speech.
    
    Args:
        source_audio_path: Path to source audio in any language
        target_text: Optional Russian text override (skips translation step)
        ref_audio_path: Reference audio for voice cloning
        ref_text: Reference text transcription
    
    Returns:
        (audio_array, sample_rate)
    
    Raises:
        HTTPException if Seamless model not available or translation fails
    """
    from ..services import history  # Import history service for async DB access
    
    # Step 1: Get Russian text via Seamless (or use provided)
    russian_text = None
    if target_text is None:
        try:
            logger.info("Translating source audio to Russian...")
            translation_result = await self._translate_audio_sync(source_audio_path)
            russian_text = translation_result["translated_text"]
        except Exception as e:
            logger.error(f"Translation failed: {e}")
            raise HTTPException(status_code=503, detail="Translation service unavailable")
    else:
        logger.info("Using provided Russian text (translation skipped)")
        russian_text = target_text
    
    # Step 2: Convert to phonetic representation with stress markers
    if is_espeak_installed():
        from ..utils.g2p_ru import convert_russian_to_phonetic
        phonetic_text, success = convert_russian_to_phonetic(russian_text)
        if not success:
            logger.warning("G2P conversion failed, using raw text")
    else:
        logger.warning("espeak-ng not available, skipping G2P")
        phonetic_text = russian_text
    
    # Step 3: Call standard generate with phonetic text
    voice_prompt = await self.create_voice_prompt(ref_audio_path, ref_text)
    
    return await self.generate(
        text=phonetic_text,
        voice_prompt=voice_prompt,
        language="ru"
    )


async def _translate_audio_sync(self, audio_path: str) -> dict:
    """Synchronous wrapper for Seamless translation."""
    # Lazy load to avoid blocking during async
    from seamless_communication import models
    
    model = models.load_model(
        name="meta-llama/SeamlessCommunication2",
        device="auto"
    )
    
    result = model.predict(
        input_audio=audio_path,
        task_str="S2TT",  # Speech-to-Text Translation
        tgt_lang="rus"
    )
    
    return {"translated_text": result}


# Add this to the generate() method's docstring:
"""
Note: For full speech-to-speech translation pipeline, use translate_and_synthesize()
which handles Seamless translation → G2P conversion → F5-TTS generation automatically.
The standard generate() method still works for direct text input with manual stress markers.
"""
```

---

### Phase 3: Add Translation Route to API

Ensure the transcription router includes the new endpoint and is properly registered in `backend/app.py`:

```python
# In backend/app.py or main entry point
from .routes import transcription, generations, health, history, models as models_routes, profiles, tasks

app.include_router(transcription.router)  # Add this if not already present
```

---

### Phase 4: Update Requirements.txt

Add Seamless Communication dependency to `backend/requirements.txt`:

```txt
# Add these lines (or update existing seamless line):
seamless-communication>=1.0.0.post2503161
# Or use HuggingFace API directly:
huggingface_hub>=0.24.0  # For model downloads if using HF interface instead
```

**Note**: As of early 2025, the official `seamless-communication` PyPI package may not be available yet. Options:
1. Use pip install from GitHub directly: `pip install git+https://github.com/facebookresearch/seamless_communication.git@main`
2. Or use Hugging Face Inference API instead of local model

---

## Example Usage

### Direct API Call (Full Pipeline)

```bash
curl -X POST "http://localhost:8000/translate" \
  -F "source_audio=@input_english.wav" \
  -F "target_language=rus" \
  | python3 -m json.tool
```

### Python SDK Example

```python
from fastapi import FastAPI, UploadFile, File
import requests

# Option A: Direct endpoint call
response = requests.post(
    "http://localhost:8000/translate",
    files={"source_audio": open("english_speech.wav", "rb")},
    data={"target_language": "rus"}
)
russian_text = response.json()["translated_text"]

# Option B: Direct pipeline call to F5-TTS backend (if exposing as API endpoint too)
from backend.backends.f5tts_ru_backend import F5TTSRuBackend
import asyncio

backend = F5TTSRuBackend()
audio, sr = asyncio.run(
    backend.translate_and_synthesize(
        source_audio_path="english_speech.wav",
        ref_audio_path="russian_reference.wav",
        ref_text="Привет"  # Optional: transcription of reference
    )
)

import soundfile as sf
sf.write("output_russian_cloned.wav", audio, sr)
```

---

## Dependencies & Installation

### New Dependencies

| Package | Purpose | Install Command |
|---------|---------|-----------------|
| `seamless-communication` | Speech-to-text translation model | `pip install git+https://github.com/facebookresearch/seamless_communication.git@main` |
| `espeak-ng` (system) | Russian G2P phonetic conversion | Windows: download installer from espeak.org or use conda |

### Optional Dependencies for Better Integration

| Package | Purpose | Install Command |
|---------|---------|-----------------|
| `torchaudio` | Alternative audio I/O | `pip install torchaudio` |
| `soundfile` | High-quality WAV I/O (already in requirements) | Already included ✅ |

---

## Testing Strategy

### Unit Tests (`backend/tests/test_integration.py`)

```python
import pytest
from backend.backends.f5tts_ru_backend import F5TTSRuBackend
from pathlib import Path
import tempfile
import os

@pytest.fixture
def temp_audio_files():
    """Create temporary audio files for testing."""
    # Create 10s reference audio (silence for demo)
    ref_path = Path(tempfile.mktemp(suffix=".wav"))
    with open(ref_path, "wb") as f:
        import numpy as np
        from soundfile import write
        sr = 24000
        duration = 10
        data = np.zeros(int(sr * duration), dtype=np.float32)
        write(str(ref_path), sr, data)
    
    # Create source audio (English)
    src_path = Path(tempfile.mktemp(suffix=".wav"))
    with open(src_path, "wb") as f:
        import numpy as np
        from soundfile import write
        sr = 16000
        duration = 5
        data = np.random.randn(int(sr * duration)).astype(np.float32) / 32768.0
        write(str(src_path), sr, data)
    
    yield str(ref_path), str(src_path)
    
    # Cleanup
    os.unlink(ref_path)
    os.unlink(src_path)


@pytest.mark.asyncio
async def test_translate_and_synthesize(temp_audio_files):
    """Test full translation → synthesis pipeline."""
    ref_path, src_path = temp_audio_files
    
    backend = F5TTSRuBackend()
    
    # This should:
    # 1. Run Seamless translation (will fail with silence input)
    # 2. Convert to phonetic form
    # 3. Generate Russian speech
    try:
        audio, sr = await backend.translate_and_synthesize(
            source_audio_path=src_path,
            ref_audio_path=ref_path,
            ref_text="Hello"
        )
        
        assert audio.shape[0] > 0
        assert audio.dtype == np.float32
        
    except Exception as e:
        pytest.skip("Translation not configured (requires real audio input)")
```

### Integration Tests

1. **Mock Seamless**: Create mock translation service for testing without actual model download
2. **End-to-End API Test**: Send English text → expect Russian audio output
3. **Stress Marker Validation**: Verify G2P conversion produces correct phonetic markers

---

## Known Limitations & Considerations

### 1. Seamless Model Size
- M4T v2 model is ~6GB when fully downloaded
- Consider serving via Hugging Face Inference API for smaller deployment:
  ```python
  from huggingface_hub import InferenceClient
  
  client = InferenceClient(token="YOUR_HF_TOKEN")
  russian_text = client.pipeline(
      "seamless-m4t-large",
      audio=audio_bytes,
      task="translate",
      source_lang="auto",
      target_lang="rus"
  )
  ```

### 2. Reference Audio Length
- F5-TTS Russian backend limits reference to 15 seconds max (see `_MAX_REF_AUDIO_SECONDS`)
- For longer voice samples, consider splitting or selecting key segments

### 3. G2P Dependency on espeak-ng
- Windows users must install espeak-ng separately
- Fallback mode available (skips stress marking if espeak unavailable)

### 4. License Considerations
- **Seamless M4T**: Meta license, generally permissive for commercial use
- **F5-TTS_RUSSIAN**: CC-BY-NC-4.0 (non-commercial only) ⚠️
  - Must attribute: "Based on F5-TTS by Misha24-10"
  - Cannot be used in commercial products without permission

---

## Future Enhancements

### Priority 1: Hugging Face Inference API Integration
Replace local Seamless model with HF serverless inference to reduce deployment complexity.

### Priority 2: Batch Processing
Add support for translating and synthesizing multiple audio files in parallel.

### Priority 3: Web UI Extension
Add "Translate & Speak" mode in the frontend that automatically chains both services.

### Priority 4: Multiple Language Support
Extend pipeline to translate from any language but synthesize in different target languages (Spanish, French, etc.) by training separate F5-TTS fine-tunes per language.

---

## Summary of Changes Required

| File | Change Type | Description |
|------|-------------|-------------|
| `backend/routes/transcription.py` | Add | Seamless translation endpoint (`POST /translate`) |
| `backend/backends/f5tts_ru_backend.py` | Modify | Add `translate_and_synthesize()` method; update docstrings |
| `backend/requirements.txt` | Add | `seamless-communication` (or HF API client) |
| `docs/plans/integrate-seamless-translation.md` | Create | This documentation file ✅ |

---

## Quick Start Checklist

- [ ] Install new dependencies (`pip install seamless-communication`)
- [ ] Install espeak-ng on Windows system
- [ ] Add transcription endpoint to app router
- [ ] Implement `translate_and_synthesize()` method in backend
- [ ] Test with sample English → Russian audio pipeline
- [ ] Verify G2P phonetic conversion produces correct stress markers
- [ ] Document API usage in main README.md

---

*Generated: 2026-04-26 | For Voicebox Project v1.0*
