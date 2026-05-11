"""
Roman numeral expansion for TTS pre-processing.

Detects standalone Roman numeral tokens in text and replaces them with
their cardinal word equivalents in English, Russian, or Italian — before
the text reaches the synthesis model.

    >>> from backend.utils.roman_numerals import expand_roman_numerals
    >>> expand_roman_numerals("Chapter IX ends here.", lang="en")
    'Chapter nine ends here.'
    >>> expand_roman_numerals("Глава IX начинается.", lang="ru")
    'Глава девять начинается.'
    >>> expand_roman_numerals("Capitolo IX è qui.", lang="it")
    'Capitolo nove è qui.'

Supported range: I–MMMCMXCIX (1–3999).
Languages: "en", "ru", "it".  Other lang codes pass text through unchanged.
Zero external dependencies — pure Python standard library only.
"""

import re
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Roman numeral → integer
# ---------------------------------------------------------------------------

_ROMAN_VALUES = {
    "I": 1, "V": 5, "X": 10, "L": 50,
    "C": 100, "D": 500, "M": 1000,
}

# Maximum Roman numeral value handled by this module.
# Numerals above this limit are left in the original text unchanged.
_MAX_ROMAN_VALUE = 24

# Strict grammar regex: matches *valid* Roman numeral strings (1-3999).
# We parse against the full grammar first, then enforce the value cap.
# Anchored at word boundaries in expand_roman_numerals; here it validates
# the token itself.
_ROMAN_GRAMMAR_RE = re.compile(
    r"^M{0,3}"                         # thousands
    r"(?:CM|CD|D?C{0,3})"             # hundreds
    r"(?:XC|XL|L?X{0,3})"            # tens
    r"(?:IX|IV|V?I{0,3})"            # units
    r"$",
    re.IGNORECASE,
)

# Scanning pattern: candidate word-boundary tokens of Roman numeral chars.
# We validate each match against _ROMAN_GRAMMAR_RE afterward.
_ROMAN_SCAN_RE = re.compile(r"\b([MDCLXVI]+)\b", re.IGNORECASE)


def roman_to_int(s: str) -> Optional[int]:
    """Convert a Roman numeral string to an integer.

    Returns ``None`` if *s* is not a valid Roman numeral, represents 0,
    or exceeds ``_MAX_ROMAN_VALUE`` (24).

    Args:
        s: Roman numeral string (case-insensitive).

    Returns:
        Integer value 1–24, or ``None`` for invalid or out-of-range input.
    """
    if not s:
        return None
    upper = s.upper()
    if not _ROMAN_GRAMMAR_RE.match(upper):
        return None

    total = 0
    prev = 0
    for ch in reversed(upper):
        val = _ROMAN_VALUES[ch]
        if val < prev:
            total -= val
        else:
            total += val
        prev = val

    if total <= 0 or total > _MAX_ROMAN_VALUE:
        return None
    return total


# ---------------------------------------------------------------------------
# Integer → words (EN)
# ---------------------------------------------------------------------------

_EN_ONES = [
    "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
    "seventeen", "eighteen", "nineteen",
]
_EN_TENS = [
    "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
]


def _int_to_words_en(n: int) -> str:
    """Convert integer 1–3999 to English cardinal words."""
    if n <= 0 or n > 3999:
        return str(n)
    if n < 20:
        return _EN_ONES[n]
    if n < 100:
        ones = n % 10
        return _EN_TENS[n // 10] + ("-" + _EN_ONES[ones] if ones else "")
    if n < 1000:
        rest = n % 100
        return (
            _EN_ONES[n // 100]
            + " hundred"
            + (" " + _int_to_words_en(rest) if rest else "")
        )
    # 1000–3999
    rest = n % 1000
    return (
        _EN_ONES[n // 1000]
        + " thousand"
        + (" " + _int_to_words_en(rest) if rest else "")
    )


# ---------------------------------------------------------------------------
# Integer → words (RU) — masculine cardinal form
# ---------------------------------------------------------------------------

_RU_ONES = [
    "", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять",
    "десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать",
    "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать",
]
_RU_TENS = [
    "", "", "двадцать", "тридцать", "сорок", "пятьдесят",
    "шестьдесят", "семьдесят", "восемьдесят", "девяносто",
]
_RU_HUNDREDS = [
    "", "сто", "двести", "триста", "четыреста", "пятьсот",
    "шестьсот", "семьсот", "восемьсот", "девятьсот",
]
# Thousands use feminine form: одна тысяча, две тысячи, …
_RU_THOU_ONES = [
    "", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять",
    "десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать",
    "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать",
]

def _ru_thou_suffix(n: int) -> str:
    """Russian genitive suffix for 'thousand'."""
    if 11 <= n % 100 <= 19:
        return "тысяч"
    m = n % 10
    if m == 1:
        return "тысяча"
    if 2 <= m <= 4:
        return "тысячи"
    return "тысяч"


def _int_to_words_ru(n: int) -> str:
    """Convert integer 1–3999 to Russian masculine cardinal words."""
    if n <= 0 or n > 3999:
        return str(n)

    parts = []

    # Thousands
    thou = n // 1000
    if thou:
        if thou < 20:
            parts.append(_RU_THOU_ONES[thou])
        else:
            t = thou // 10
            o = thou % 10
            parts.append(_RU_TENS[t])
            if o:
                parts.append(_RU_THOU_ONES[o])
        parts.append(_ru_thou_suffix(thou))
        n %= 1000

    # Hundreds
    hund = n // 100
    if hund:
        parts.append(_RU_HUNDREDS[hund])
        n %= 100

    # Tens + ones
    if n >= 20:
        parts.append(_RU_TENS[n // 10])
        n %= 10
        if n:
            parts.append(_RU_ONES[n])
    elif n > 0:
        parts.append(_RU_ONES[n])

    return " ".join(parts)


# ---------------------------------------------------------------------------
# Integer → words (IT) — Italian cardinal form
# ---------------------------------------------------------------------------

_IT_ONES = [
    "", "uno", "due", "tre", "quattro", "cinque", "sei", "sette", "otto", "nove",
    "dieci", "undici", "dodici", "tredici", "quattordici", "quindici", "sedici",
    "diciassette", "diciotto", "diciannove",
]
_IT_TENS = [
    "", "", "venti", "trenta", "quaranta", "cinquanta",
    "sessanta", "settanta", "ottanta", "novanta",
]
_IT_HUNDREDS = [
    "", "cento", "duecento", "trecento", "quattrocento", "cinquecento",
    "seicento", "settecento", "ottocento", "novecento",
]


def _it_tens_ones(n: int) -> str:
    """Italian 20–99 with elision: venti+uno → ventuno, venti+otto → ventotto."""
    if n < 20:
        return _IT_ONES[n]
    tens_word = _IT_TENS[n // 10]
    ones = n % 10
    if ones == 0:
        return tens_word
    ones_word = _IT_ONES[ones]
    # Elide trailing vowel of tens word before uno/otto
    if ones in (1, 8) and tens_word[-1] in "aeiou":
        tens_word = tens_word[:-1]
    return tens_word + ones_word


def _int_to_words_it(n: int) -> str:
    """Convert integer 1–3999 to Italian cardinal words."""
    if n <= 0 or n > 3999:
        return str(n)

    if n < 100:
        return _it_tens_ones(n)

    if n < 1000:
        hund = n // 100
        rest = n % 100
        # cento elides the 'o' before following vowel? — not standard; keep simple
        hund_word = _IT_HUNDREDS[hund]
        return hund_word + (_it_tens_ones(rest) if rest else "")

    # 1000–3999
    thou = n // 1000
    rest = n % 1000
    # "mille" for 1000, "duemila" etc. for 2000+
    if thou == 1:
        thou_word = "mille"
    else:
        thou_word = _it_tens_ones(thou) + "mila"
    return thou_word + (_int_to_words_it(rest) if rest else "")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

_SUPPORTED_LANGS = {"en", "ru", "it"}


def int_to_words(n: int, lang: str) -> str:
    """Convert integer *n* to cardinal words in *lang*.

    Args:
        n: Integer 1–3999.
        lang: Language code — ``"en"``, ``"ru"``, or ``"it"``.
              Other codes fall back to the digit string.

    Returns:
        Word form of *n* in the requested language.
    """
    lang = lang.lower().split("-")[0]  # normalise "en-US" → "en"
    if lang == "en":
        return _int_to_words_en(n)
    if lang == "ru":
        return _int_to_words_ru(n)
    if lang == "it":
        return _int_to_words_it(n)
    return str(n)


def expand_roman_numerals(text: str, lang: str) -> str:
    """Replace standalone Roman numeral tokens in *text* with word forms.

    Detection rules:
    - Only standalone tokens (``\\b`` word boundaries on both sides).
    - Only *valid* Roman numeral strings (validated by ``roman_to_int``).
    - Case-insensitive: "ix", "Ix", "IX" all match.
    - Tokens longer than 15 characters are skipped (likely an acronym /
      allcaps word that happens to use only Roman numeral letters, e.g.
      "MDIVISION").

    Args:
        text: Input text.
        lang: Language code for word generation (``"en"``, ``"ru"``, ``"it"``).
              If the language is not supported the original text is returned
              unchanged (fast path — no scanning overhead).

    Returns:
        Text with Roman numerals replaced by word equivalents, or the
        original string if the language is unsupported or no numerals found.
    """
    norm_lang = lang.lower().split("-")[0]
    if norm_lang not in _SUPPORTED_LANGS:
        return text

    def _replace(m: re.Match) -> str:
        token = m.group(1)
        # Reject over-long tokens (likely acronyms)
        if len(token) > 15:
            return m.group(0)
        value = roman_to_int(token)
        if value is None:
            return m.group(0)  # not a valid numeral — leave as-is
        word = int_to_words(value, norm_lang)
        # Preserve capitalisation of the first character if the token was
        # Title-cased (e.g. "Ix" → language word with capital first letter).
        # Single all-caps tokens like "I", "V", "X" are NOT title-cased —
        # they are fully upper and should map to their plain word form.
        if (
            len(token) > 1
            and token[0].isupper()
            and not token[1:].isupper()
        ):
            word = word[0].upper() + word[1:] if word else word
        logger.debug("Roman numeral: %s (%d) → %r [%s]", token, value, word, norm_lang)
        return word

    result = _ROMAN_SCAN_RE.sub(_replace, text)
    if result != text:
        logger.info("Roman numerals expanded (%s): %r → %r", norm_lang, text[:120], result[:120])
    return result
