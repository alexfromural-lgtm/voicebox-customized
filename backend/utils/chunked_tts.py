"""
Chunked TTS generation utilities.

Splits long text into sentence-boundary chunks, generates audio per-chunk
via any TTSBackend, and concatenates with crossfade.  All logic is
engine-agnostic — it wraps the standard ``TTSBackend.generate()`` interface.

Short text (≤ max_chunk_chars) uses the single-shot fast path with zero
overhead.
"""

import logging
import re
from typing import List, Tuple

import numpy as np

logger = logging.getLogger("voicebox.chunked-tts")

# Default chunk size in characters.  Can be overridden per-request via
# the ``max_chunk_chars`` field on GenerationRequest.
DEFAULT_MAX_CHUNK_CHARS = 1800

# Common abbreviations that should NOT be treated as sentence endings.
# Lowercase for case-insensitive matching.
_ABBREVIATIONS = frozenset(
    {
        "mr",
        "mrs",
        "ms",
        "dr",
        "prof",
        "sr",
        "jr",
        "st",
        "ave",
        "blvd",
        "inc",
        "ltd",
        "corp",
        "dept",
        "est",
        "approx",
        "vs",
        "etc",
        "e.g",
        "i.e",
        "a.m",
        "p.m",
        "u.s",
        "u.s.a",
        "u.k",
    }
)

# Paralinguistic tags used by Chatterbox Turbo.  The splitter must never
# cut inside one of these.
_PARA_TAG_RE = re.compile(r"\[[^\]]*\]")

# Regex for paragraph / line breaks used to insert silence between segments.
_BREAK_RE = re.compile(r"(\n\n+|\n)")


def split_text_into_chunks(text: str, max_chars: int = DEFAULT_MAX_CHUNK_CHARS) -> List[str]:
    """Split *text* at natural boundaries into chunks of at most *max_chars*.

    Priority: sentence-end (``.!?`` not preceded by an abbreviation and not
    inside brackets) → clause boundary (``;:,—``) → whitespace → hard cut.

    Paralinguistic tags like ``[laugh]`` are treated as atomic and will not
    be split across chunks.
    """
    text = text.strip()
    if not text:
        return []
    if len(text) <= max_chars:
        return [text]

    chunks: List[str] = []
    remaining = text

    while remaining:
        remaining = remaining.lstrip()
        if not remaining:
            break
        if len(remaining) <= max_chars:
            chunks.append(remaining)
            break

        segment = remaining[:max_chars]

        # Try to split at the last real sentence ending, but only if the
        # split point falls in the latter half of the window.  This prevents
        # a short opening paragraph (e.g. 200 chars ending with ".") from
        # becoming a tiny standalone chunk when the following paragraph has
        # no period within the remaining budget, which would produce far more
        # chunks than expected (e.g. 4 chunks instead of 2 for 3000 chars).
        split_pos = _find_last_sentence_end(segment)
        if split_pos != -1 and split_pos <= max_chars // 2:
            split_pos = -1  # too early — ignore and fall through
        if split_pos == -1:
            split_pos = _find_last_clause_boundary(segment)
            if split_pos != -1 and split_pos <= max_chars // 2:
                split_pos = -1
        if split_pos == -1:
            split_pos = segment.rfind(" ")
        if split_pos == -1:
            # Absolute fallback: hard cut but avoid splitting inside a tag
            split_pos = _safe_hard_cut(segment, max_chars)

        chunk = remaining[: split_pos + 1].strip()
        if chunk:
            chunks.append(chunk)
        remaining = remaining[split_pos + 1 :]

    return chunks


def split_text_by_breaks(text: str) -> list:
    """Split *text* into ``(segment, break_type)`` pairs preserving break info.

    Splits on ``\\n\\n+`` (paragraph break) and ``\\n`` (line break).
    Returns a list of ``(segment_str, break_type)`` tuples where *break_type*
    is ``"paragraph"``, ``"line"``, or ``""`` for the final segment.
    """
    parts = _BREAK_RE.split(text)
    # re.split with a capturing group produces:
    #   [seg, delim, seg, delim, ..., seg]
    result = []
    i = 0
    while i < len(parts):
        segment = parts[i]
        if i + 1 < len(parts):
            delim = parts[i + 1]
            break_type = "paragraph" if len(delim) >= 2 else "line"
            i += 2
        else:
            break_type = ""
            i += 1
        result.append((segment, break_type))
    return result


def _find_last_sentence_end(text: str) -> int:
    """Return the index of the last sentence-ending punctuation in *text*.

    Skips periods that follow common abbreviations (``Dr.``, ``Mr.``, etc.)
    and periods inside bracket tags (``[laugh]``).  Also handles CJK
    sentence-ending punctuation (``。！？``).
    """
    best = -1
    # ASCII sentence ends
    for m in re.finditer(r"[.!?](?:\s|$)", text):
        pos = m.start()
        char = text[pos]
        # Skip periods after abbreviations
        if char == ".":
            # Walk backwards to find the preceding word
            word_start = pos - 1
            while word_start >= 0 and text[word_start].isalpha():
                word_start -= 1
            word = text[word_start + 1 : pos].lower()
            if word in _ABBREVIATIONS:
                continue
            # Skip decimal numbers (digit immediately before the period)
            if word_start >= 0 and text[word_start].isdigit():
                continue
        # Skip if we're inside a bracket tag
        if _inside_bracket_tag(text, pos):
            continue
        best = pos
    # CJK sentence-ending punctuation
    for m in re.finditer(r"[\u3002\uff01\uff1f]", text):
        if m.start() > best:
            best = m.start()
    return best


def _find_last_clause_boundary(text: str) -> int:
    """Return the index of the last clause-boundary punctuation."""
    best = -1
    for m in re.finditer(r"[;:,\u2014](?:\s|$)", text):
        pos = m.start()
        # Skip if inside a bracket tag
        if _inside_bracket_tag(text, pos):
            continue
        best = pos
    return best


def _inside_bracket_tag(text: str, pos: int) -> bool:
    """Return True if *pos* falls inside a ``[...]`` tag."""
    for m in _PARA_TAG_RE.finditer(text):
        if m.start() < pos < m.end():
            return True
    return False


def _safe_hard_cut(segment: str, max_chars: int) -> int:
    """Find a hard-cut position that doesn't split a ``[tag]``."""
    cut = max_chars - 1
    # Check if the cut falls inside a bracket tag; if so, move before it
    for m in _PARA_TAG_RE.finditer(segment):
        if m.start() < cut < m.end():
            return m.start() - 1 if m.start() > 0 else cut
    return cut


def concatenate_audio_chunks(
    chunks: List[np.ndarray],
    sample_rate: int,
    crossfade_ms: int = 50,
) -> np.ndarray:
    """Concatenate audio arrays with a short crossfade to eliminate clicks.

    Each chunk is expected to be a 1-D float32 ndarray at *sample_rate* Hz.
    """
    if not chunks:
        return np.array([], dtype=np.float32)
    if len(chunks) == 1:
        return chunks[0]

    crossfade_samples = int(sample_rate * crossfade_ms / 1000)
    result = np.array(chunks[0], dtype=np.float32, copy=True)

    for chunk in chunks[1:]:
        if len(chunk) == 0:
            continue
        overlap = min(crossfade_samples, len(result), len(chunk))
        if overlap > 0:
            fade_out = np.linspace(1.0, 0.0, overlap, dtype=np.float32)
            fade_in = np.linspace(0.0, 1.0, overlap, dtype=np.float32)
            result[-overlap:] = result[-overlap:] * fade_out + chunk[:overlap] * fade_in
            result = np.concatenate([result, chunk[overlap:]])
        else:
            result = np.concatenate([result, chunk])

    return result


async def generate_chunked(
    backend,
    text: str,
    voice_prompt: dict,
    language: str = "en",
    seed: int | None = None,
    instruct: str | None = None,
    max_chunk_chars: int = DEFAULT_MAX_CHUNK_CHARS,
    crossfade_ms: int = 50,
    trim_fn=None,
    paragraph_pause_ms: int = 500,
    line_pause_ms: int = 200,
    sentence_pause_ms: int = 200,
) -> Tuple[np.ndarray, int]:
    """Generate audio with automatic chunking for long text, with optional
    pauses at paragraph and line breaks.

    For text shorter than *max_chunk_chars* and containing no line breaks,
    this is a thin wrapper around ``backend.generate()`` with zero overhead.

    For longer text the input is split at natural sentence boundaries,
    each chunk is generated independently, optionally trimmed (useful for
    Chatterbox engines that hallucinate trailing noise), and the results
    are concatenated with a crossfade (or hard cut if *crossfade_ms* is 0).

    If the text contains newlines, each paragraph / line is generated
    separately and the results are interleaved with silent gaps of
    *paragraph_pause_ms* ms (for ``\\n\\n+``) or *line_pause_ms* ms (for
    ``\\n``).

    Parameters
    ----------
    backend : TTSBackend
        Any backend implementing the ``generate()`` protocol.
    text : str
        Input text (may be arbitrarily long).
    voice_prompt, language, seed, instruct
        Forwarded to ``backend.generate()`` verbatim.
    max_chunk_chars : int
        Maximum characters per chunk (default 800).
    crossfade_ms : int
        Crossfade duration in milliseconds between sentence chunks.  0 for a
        hard cut with no overlap (default 50).
    trim_fn : callable | None
        Optional ``(audio, sample_rate) -> audio`` post-processing
        function applied to each chunk before concatenation (e.g.
        ``trim_tts_output`` for Chatterbox engines).
    paragraph_pause_ms : int
        Duration of silence (ms) inserted at ``\\n\\n+`` paragraph breaks
        (default 500).  Set to 0 to disable.
    line_pause_ms : int
        Duration of silence (ms) inserted at single ``\\n`` line breaks
        (default 200).  Set to 0 to disable.
    sentence_pause_ms : int
        Duration of silence (ms) inserted after each sentence chunk that ends
        with ``.``, ``!``, or ``?`` (default 200).  Set to 0 to disable.

    Returns
    -------
    (audio, sample_rate) : Tuple[np.ndarray, int]
    """
    # ── Paragraph / line-break aware path ─────────────────────────────────
    if "\n" in text and (paragraph_pause_ms > 0 or line_pause_ms > 0):
        segments = split_text_by_breaks(text)
        audio_parts: List[np.ndarray] = []
        sample_rate: int | None = None
        chunk_index = 0          # global counter for seed variation
        pending_pause_ms: int = 0  # silence to prepend before the next segment

        for seg_text, break_type in segments:
            seg_stripped = seg_text.strip()

            if not seg_stripped:
                # Empty segment (e.g. leading/trailing newline) — accumulate pause
                if break_type:
                    pause = paragraph_pause_ms if break_type == "paragraph" else line_pause_ms
                    pending_pause_ms = max(pending_pause_ms, pause)
                continue

            # Insert pending silence before this segment (never before the first)
            if audio_parts and pending_pause_ms > 0:
                sr_for_silence = sample_rate or 24000
                silence = np.zeros(
                    int(sr_for_silence * pending_pause_ms / 1000), dtype=np.float32
                )
                audio_parts.append(silence)
                logger.debug(
                    "Inserted %d ms silence before segment", pending_pause_ms
                )
            pending_pause_ms = 0

            # Generate audio for this segment using sentence-level chunking
            seg_chunks = split_text_into_chunks(seg_stripped, max_chunk_chars)
            seg_audio_parts: List[np.ndarray] = []

            # Prepend a leading silence before the first chunk of the first segment
            # (only when there is no pending_pause already, i.e. truly the first segment)
            if not audio_parts and sentence_pause_ms > 0 and seg_chunks:
                sr_for_lead = sample_rate or 24000
                lead_silence = np.zeros(
                    int(sr_for_lead * sentence_pause_ms / 1000), dtype=np.float32
                )
                seg_audio_parts.append(lead_silence)

            if not seg_chunks:
                pass
            elif len(seg_chunks) == 1:
                chunk_seed = (seed + chunk_index) if seed is not None else None
                chunk_audio, chunk_sr = await backend.generate(
                    seg_stripped, voice_prompt, language, chunk_seed, instruct,
                )
                if trim_fn is not None:
                    chunk_audio = trim_fn(chunk_audio, chunk_sr)
                seg_audio_parts.append(np.asarray(chunk_audio, dtype=np.float32))
                if sample_rate is None:
                    sample_rate = chunk_sr
                chunk_index += 1
            else:
                logger.info(
                    "Segment split into %d sentence chunks (%d chars)",
                    len(seg_chunks),
                    len(seg_stripped),
                )
                for seg_chunk in seg_chunks:
                    chunk_seed = (seed + chunk_index) if seed is not None else None
                    chunk_audio, chunk_sr = await backend.generate(
                        seg_chunk, voice_prompt, language, chunk_seed, instruct,
                    )
                    if trim_fn is not None:
                        chunk_audio = trim_fn(chunk_audio, chunk_sr)
                    seg_audio_parts.append(np.asarray(chunk_audio, dtype=np.float32))
                    if sample_rate is None:
                        sample_rate = chunk_sr
                    # Insert silence after sentence-ending punctuation
                    if sentence_pause_ms > 0 and seg_chunk.rstrip().endswith(('.', '!', '?')):
                        seg_audio_parts.append(
                            np.zeros(int((sample_rate or 24000) * sentence_pause_ms / 1000), dtype=np.float32)
                        )
                    chunk_index += 1

            if seg_audio_parts:
                seg_combined = concatenate_audio_chunks(
                    seg_audio_parts, sample_rate, crossfade_ms=crossfade_ms
                )
                audio_parts.append(seg_combined)

            # Schedule the silence that follows this segment
            if break_type:
                pause = paragraph_pause_ms if break_type == "paragraph" else line_pause_ms
                pending_pause_ms = pause

        if not audio_parts:
            return np.array([], dtype=np.float32), sample_rate or 24000

        logger.info(
            "Paragraph-aware generation: %d parts, %.1f s total",
            len(audio_parts),
            sum(len(p) for p in audio_parts) / (sample_rate or 24000),
        )
        # Hard-concatenate: silence gaps don't need crossfading
        return np.concatenate(audio_parts), sample_rate

    # ── Original single-block path ─────────────────────────────────────────
    chunks = split_text_into_chunks(text, max_chunk_chars)

    if len(chunks) <= 1:
        # Short text — single-shot fast path
        audio, sample_rate = await backend.generate(
            text,
            voice_prompt,
            language,
            seed,
            instruct,
        )
        if trim_fn is not None:
            audio = trim_fn(audio, sample_rate)
        return audio, sample_rate

    # Long text — chunked generation
    logger.info(
        "Splitting %d chars into %d chunks (max %d chars each)",
        len(text),
        len(chunks),
        max_chunk_chars,
    )
    audio_chunks: List[np.ndarray] = []
    sample_rate: int | None = None

    # Prepend a leading silence before the very first chunk so the audio
    # starts with the same gentle onset as the pauses between sentence chunks.
    if sentence_pause_ms > 0:
        lead_silence = np.zeros(
            int(24000 * sentence_pause_ms / 1000), dtype=np.float32
        )
        audio_chunks.append(lead_silence)

    for i, chunk_text in enumerate(chunks):
        logger.info(
            "Generating chunk %d/%d (%d chars)",
            i + 1,
            len(chunks),
            len(chunk_text),
        )
        # Vary the seed per chunk to avoid correlated RNG artefacts,
        # but keep it deterministic so the same (text, seed) pair
        # always produces the same output.
        chunk_seed = (seed + i) if seed is not None else None

        chunk_audio, chunk_sr = await backend.generate(
            chunk_text,
            voice_prompt,
            language,
            chunk_seed,
            instruct,
        )
        if trim_fn is not None:
            chunk_audio = trim_fn(chunk_audio, chunk_sr)

        audio_chunks.append(np.asarray(chunk_audio, dtype=np.float32))
        if sample_rate is None:
            sample_rate = chunk_sr
        # Insert silence after sentence-ending punctuation
        if sentence_pause_ms > 0 and chunk_text.rstrip().endswith(('.', '!', '?')):
            audio_chunks.append(
                np.zeros(int((sample_rate or 24000) * sentence_pause_ms / 1000), dtype=np.float32)
            )

    audio = concatenate_audio_chunks(audio_chunks, sample_rate, crossfade_ms=crossfade_ms)
    return audio, sample_rate
