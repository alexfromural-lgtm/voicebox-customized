"""
Grapheme-to-Phoneme (G2P) conversion for Russian using espeak-ng.

This module converts Cyrillic text into phonetic representations that include
stress markers directly in the phonemes, bypassing vocabulary limitations and
providing more accurate pronunciation by teaching the model acoustic properties
of stressed vs unstressed vowels as distinct entities.

Method: Use espeak-ng to generate phonetic transcriptions where stress is
explicitly baked into the phoneme itself (e.g., ˈ markers for primary stress).

Dependencies:
    - espeak-ng CLI tool must be installed on the system
    - subprocess module (Python standard library)

Environment variables:
    - PHONEMIZER_ESPEAK_PATH: Path to espeak executable (default: searches PATH, then tries common locations)
    - ESPEAK_DATA_PATH: Path to espeak data directory for Russian voice files
    
Example usage:
    >>> from backend.utils.g2p_ru import convert_russian_to_phonetic
    >>> text = "Привет, мир!"
    >>> phonetic = convert_russian_to_phonetic(text)
    >>> print(phonetic)  # e.g., "prʲɪˈvjet mʲir!"

Note: This implementation is specifically designed for Russian language.
"""

import logging
from pathlib import Path
import subprocess
import os
from typing import Optional, Tuple

logger = logging.getLogger(__name__)


def _get_espeak_path() -> str:
    """Get the path to espeak executable from environment or common locations."""
    # Check PHONEMIZER_ESPEAK_PATH first (takes precedence)
    env_path = os.environ.get("PHONEMIZER_ESPEAK_PATH")
    if env_path:
        return env_path
    
    # Try standard Windows paths in order of likelihood
    windows_paths = [
        r"C:\Program Files\eSpeak NG\espeak-ng.exe",
        r"C:\Program Files (x86)\eSpeak NG\espeak-ng.exe",
    ]
    
    for path in windows_paths:
        if Path(path).exists():
            return path
    
    # Try to find espeak in PATH as fallback
    try:
        result = subprocess.run(
            ["where", "espeak"],  # Windows command to find executable
            capture_output=True,
            text=True,
            timeout=2,
            shell=False,
        )
        if result.returncode == 0 and result.stdout.strip():
            path = Path(result.stdout.split()[0]).resolve()
            return str(path)
    except Exception:
        pass
    
    raise RuntimeError(
        "espeak-ng executable not found. Please install espeak-ng or set PHONEMIZER_ESPEAK_PATH environment variable."
    )


def _get_espeak_data_path() -> Optional[str]:
    """Get the path to espeak data directory from environment."""
    return os.environ.get("ESPEAK_DATA_PATH")


def _check_espeak_available() -> bool:
    """Check if espeak-ng is available and functional."""
    try:
        # Use environment variable or default path
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


def convert_russian_to_phonetic(
    text: str, force_en_phones: bool = False
) -> Tuple[str, bool]:
    """
    Convert Russian text to phonetic representation with stress markers.
    
    Args:
        text: Russian text in Cyrillic script
        force_en_phones: If True, return English IPA phones for non-Russian chars
        
    Returns:
        Tuple of (phonetic_text, success)
        - phonetic_text: Text converted to phonemes with stress markers
        - success: Boolean indicating if conversion was successful
    """
    text = text.strip()
    if not text:
        return "", False
    
    # Check espeak availability once at function level
    available = _check_espeak_available()
    
    if not available:
        logger.error(
            "espeak-ng is required for Russian G2P conversion but not installed. "
            "Please install espeak-ng from your package manager or set PHONEMIZER_ESPEAK_PATH environment variable."
        )
        return text, False
    
    # Get data path if specified (for custom voice packs)
    data_path = _get_espeak_data_path()
    
    # Build command with optional data path
    # Use -q for quiet mode and --stdout to capture output
    cmd_base = [_get_espeak_path(), "-q", "--stdout"]
    
    if data_path:
        cmd_base.extend(["--path=" + str(data_path)])  # Use custom data directory
    else:
        # Use Russian voice from default location
        cmd_base.append("-vru")
    
    cmd = cmd_base + ["--ipa", "-s0"]  # IPA phonemes, speed 0 (default)
    cmd.extend([text])
    
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=10,
            env=dict(os.environ),  # Pass environment including ESPEAK_DATA_PATH if set
        )
        
        if result.returncode != 0:
            logger.error("espeak failed: %s", result.stderr.strip())
            return text, False
        
        phonetic = result.stdout.strip()
    except subprocess.TimeoutExpired:
        logger.error("espeak conversion timed out")
        return text, False
    except Exception as e:
        logger.error(f"Unexpected error in espeak conversion: {e}")
        return text, False
    
    if force_en_phones:
        # Replace non-ASCII Russian chars with their IPA equivalents
        phonetic = _replace_cyrillic_with_ipa(text, phonetic)
    
    return phonetic, True


def _replace_cyrillic_with_ipa(text: str, phonetic: str) -> str:
    """
    Replace Cyrillic characters with IPA equivalents when forcing English phones.
    
    This is a fallback approach that maps common Russian graphemes to IPA symbols.
    Note: This loses stress information and should only be used as a last resort.
    """
    # Map common Russian letters/consonants to IPA
    cyrillic_to_ipa = {
        "А": "a", "а": "a", "Б": "b", "б": "b", "В": "v", "в": "v", "Г": "ɡ", "г": "ɡ",
        "Д": "d", "д": "d", "Е": "jɛ", "е": "jɛ", "Ё": "jo", "ё": "jo", "Ж": "ʐ", "ж": "ʐ",
        "З": "z", "з": "z", "И": "i", "и": "i", "Й": "j", "й": "j", "К": "k", "к": "k",
        "Л": "l", "л": "l", "М": "m", "м": "m", "Н": "n", "н": "n", "О": "o", "о": "o",
        "П": "p", "п": "p", "Р": "r", "р": "r", "С": "s", "с": "s", "Т": "t", "т": "t",
        "У": "u", "у": "u", "Ф": "f", "ф": "f", "Х": "x", "х": "x", "Ц": "ts", "ц": "ts",
        "Ч": "tʃ", "ч": "tʃ", "Ш": "ʂ", "ш": "ʂ", "Щ": "ʂː", "щ": "ʂː", "Ъ": "", "ъ": "",
        "Ы": "ɯ", "ы": "ɯ", "Ь": "ʲ", "ь": "ʲ", "Э": "ɛ", "э": "ɛ", "Ю": "ju", "ю": "ju",
        "Я": "ja", "я": "ja",
    }
    
    result = []
    for char in phonetic:
        if ord(char) > 127:  # Keep IPA symbols
            result.append(char)
        else:
            # Try to find a mapping for the character
            found = False
            for ru, ipa in cyrillic_to_ipa.items():
                if char == ru or char == ru.lower() or char == ru.upper():
                    result.append(ipa[0] if len(ipa) == 1 else ipa)  # Simplified mapping
                    found = True
                    break
            if not found:
                result.append(char)
    
    return "".join(result)


def convert_batch_russian_to_phonetic(texts: list[str]) -> list[tuple[str, bool]]:
    """
    Convert multiple Russian texts to phonetic representations.
    
    Args:
        texts: List of Russian text strings
        
    Returns:
        List of tuples (phonetic_text, success) for each input text
    """
    results = []
    for text in texts:
        if not isinstance(text, str):
            continue
        phonetic, success = convert_russian_to_phonetic(text)
        results.append((phonetic, success))
    
    # Count failures and log summary
    total = len([r for r in results if r[1]])
    failed = len([r for r in results if not r[1]])
    if failed > 0:
        logger.warning("G2P conversion failed for %d of %d texts", failed, total + failed)
    
    return results


def is_espeak_installed() -> bool:
    """
    Check if espeak-ng is installed and available.
    
    Returns:
        True if espeak-ng is installed and functional, False otherwise
    """
    return _check_espeak_available()
