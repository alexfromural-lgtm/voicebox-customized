"""
Russian stress marking for F5-TTS Russian (Misha24-10/F5-TTS_RUSSIAN).

The F5-TTS Russian model was trained on Cyrillic text with `+` placed before
the stressed vowel (e.g. молок+о).  This module inserts those markers so the
model pronounces words with correct stress.

Primary approach — RUAccent (ruaccent Python package):
    Outputs Cyrillic + `+` markers directly.  Recommended by the model author.

Fallback (when ruaccent is not installed):
    Returns the original Cyrillic text without stress markers.  The model can
    still synthesize speech; stress accuracy is lower for uncommon words.

Environment variables:
    PHONEMIZER_ESPEAK_PATH  Path to the espeak-ng executable or its directory.
                            Only needed if espeak helpers are used directly.
    ESPEAK_DATA_PATH        Custom espeak-ng data directory.

Example:
    >>> from backend.utils.g2p_ru import convert_russian_to_phonetic
    >>> text, ok = convert_russian_to_phonetic("Привет мир!")
    >>> print(text)   # e.g. "Прив+ет м+ир!"
"""

import logging
import os
import subprocess
from pathlib import Path
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# RUAccent — primary stress tagger
# ---------------------------------------------------------------------------

_ruaccent_instance = None
_ruaccent_load_attempted = False


def _get_ruaccent():
    """Lazy-load and cache the RUAccent accentizer (downloads model on first use)."""
    global _ruaccent_instance, _ruaccent_load_attempted
    if _ruaccent_load_attempted:
        return _ruaccent_instance
    _ruaccent_load_attempted = True
    try:
        from ruaccent import RUAccent  # type: ignore

        acc = RUAccent()
        acc.load(omograph_model_size="turbo", use_dictionary=True)
        _ruaccent_instance = acc
        logger.info("RUAccent loaded successfully")
    except Exception as e:
        logger.warning("RUAccent not available (%s); stress marking will be skipped", e)
        _ruaccent_instance = None
    return _ruaccent_instance


def is_ruaccent_available() -> bool:
    """Return True if RUAccent can be loaded."""
    return _get_ruaccent() is not None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def convert_russian_to_phonetic(
    text: str,
    force_en_phones: bool = False,
) -> Tuple[str, bool]:
    """
    Add stress markers to Russian text for F5-TTS Russian.

    The model expects Cyrillic text with `+` placed immediately before each
    stressed vowel (e.g. "молок+о").  This function inserts those markers
    using RUAccent.

    Args:
        text: Russian Cyrillic text.
        force_en_phones: Ignored (kept for API compatibility).

    Returns:
        (marked_text, success)
        - marked_text: Cyrillic text with `+` stress markers when successful,
                       or the original text unchanged when not.
        - success: True when stress markers were inserted, False otherwise.
    """
    text = text.strip()
    if not text:
        return "", False

    acc = _get_ruaccent()
    if acc is None:
        logger.warning(
            "RUAccent is not installed. Install it with: pip install ruaccent\n"
            "Falling back to unmarked Cyrillic text — stress may be incorrect."
        )
        return text, False

    try:
        marked = acc.process_all(text)
        if not marked:
            logger.error("RUAccent returned empty output for: %s", text[:80])
            return text, False
        logger.debug("Stress: %r -> %r", text[:100], marked[:100])
        return marked, True
    except Exception as e:
        logger.error("RUAccent error: %s", e)
        return text, False


def convert_batch_russian_to_phonetic(texts: list) -> list:
    """
    Add stress markers to a list of Russian texts.

    Returns a list of (marked_text, success) tuples.
    """
    results = []
    for text in texts:
        if not isinstance(text, str):
            continue
        results.append(convert_russian_to_phonetic(text))

    failed = sum(1 for _, ok in results if not ok)
    if failed:
        logger.warning(
            "Stress marking failed for %d of %d texts", failed, len(results)
        )
    return results


# ---------------------------------------------------------------------------
# espeak-ng helpers (kept for potential future use / diagnostics)
# ---------------------------------------------------------------------------


def _get_espeak_path() -> str:
    """
    Locate the espeak-ng executable.

    Checks PHONEMIZER_ESPEAK_PATH env var first (handles both file and
    directory values), then falls back to well-known Windows install paths,
    then PATH.
    """
    env_path = os.environ.get("PHONEMIZER_ESPEAK_PATH")
    if env_path:
        p = Path(env_path)
        if p.is_file():
            return str(p)
        # Env var points to a directory — look for the executable inside it
        for exe_name in ("espeak-ng.exe", "espeak-ng", "espeak.exe", "espeak"):
            candidate = p / exe_name
            if candidate.is_file():
                return str(candidate)
        # Env var set but executable not found there — fall through

    windows_paths = [
        r"C:\Program Files\eSpeak NG\espeak-ng.exe",
        r"C:\Program Files (x86)\eSpeak NG\espeak-ng.exe",
    ]
    for path in windows_paths:
        if Path(path).exists():
            return path

    # Try PATH
    for cmd_name in ("espeak-ng", "espeak"):
        try:
            result = subprocess.run(
                ["where", cmd_name],
                capture_output=True,
                text=True,
                timeout=2,
                shell=False,
            )
            if result.returncode == 0 and result.stdout.strip():
                first_line = result.stdout.strip().splitlines()[0]
                return str(Path(first_line).resolve())
        except Exception:
            pass

    raise RuntimeError(
        "espeak-ng executable not found. "
        "Install it or set the PHONEMIZER_ESPEAK_PATH environment variable."
    )


def _get_espeak_data_path() -> Optional[str]:
    """Return the custom espeak data path from ESPEAK_DATA_PATH, if set."""
    return os.environ.get("ESPEAK_DATA_PATH")


def _check_espeak_available() -> bool:
    """Return True if espeak-ng is installed and responsive."""
    try:
        executable = _get_espeak_path()
        result = subprocess.run(
            [executable, "--version"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        return result.returncode == 0
    except Exception:
        logger.debug("espeak-ng not available")
        return False


def is_espeak_installed() -> bool:
    """Return True if espeak-ng is installed and functional."""
    return _check_espeak_available()
