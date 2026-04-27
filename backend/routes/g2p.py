"""G2P (Grapheme-to-Phoneme) conversion endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from typing import Optional

router = APIRouter()


# G2P is handled in the F5-TTS RU backend via the g2p_ru module
# This route exists for potential future direct G2P endpoint usage


@router.get("/g2p/health")
def get_g2p_health():
    """Check if G2P conversion utilities are available."""
    from ..utils.g2p_ru import convert_russian_to_phonetic

    try:
        convert_russian_to_phonetic("Привет, мир!")
        return {"available": True}
    except ImportError:
        return {"available": False, "reason": "g2p_ru module not installed"}
    except Exception as e:
        return {"available": False, "error": str(e)}
