"""
Unit tests for backend.utils.roman_numerals.

Scope: Roman numerals I–XXIV (1–24) only.
Numerals above XXIV (25+) are deliberately NOT expanded and must pass through unchanged.

Run with:
    cd backend
    python -m pytest tests/test_roman_numerals.py -v
"""

import pytest
import sys
import os

# Allow running directly from the backend directory without installation
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from utils.roman_numerals import roman_to_int, int_to_words, expand_roman_numerals


# ---------------------------------------------------------------------------
# roman_to_int — valid within range (1–24)
# ---------------------------------------------------------------------------

class TestRomanToInt:
    """Parsing Roman numeral strings; values above 24 must return None."""

    @pytest.mark.parametrize("s,expected", [
        ("I",    1), ("II",   2), ("III",  3), ("IV",   4),
        ("V",    5), ("VI",   6), ("VII",  7), ("VIII", 8),
        ("IX",   9), ("X",   10), ("XI",  11), ("XII", 12),
        ("XIII",13), ("XIV", 14), ("XV",  15), ("XVI", 16),
        ("XVII",17), ("XVIII",18),("XIX", 19), ("XX",  20),
        ("XXI", 21), ("XXII",22), ("XXIII",23),("XXIV",24),
    ])
    def test_valid_range(self, s, expected):
        assert roman_to_int(s) == expected

    # --- case-insensitive ---
    @pytest.mark.parametrize("s,expected", [
        ("ix", 9), ("Ix", 9), ("iX", 9), ("xiv", 14), ("xxiv", 24),
    ])
    def test_case_insensitive(self, s, expected):
        assert roman_to_int(s) == expected

    # --- values above 24 → None ---
    @pytest.mark.parametrize("s", [
        "XXV", "XXX", "XL", "L", "XC", "C", "D", "M",
        "XLII", "MCMXCIX", "MMMCMXCIX", "MMXXI",
    ])
    def test_above_limit_returns_none(self, s):
        assert roman_to_int(s) is None

    # --- structurally invalid tokens → None ---
    @pytest.mark.parametrize("s", [
        "", "IIII", "VV", "ABC", "123", "A",
    ])
    def test_invalid_returns_none(self, s):
        assert roman_to_int(s) is None


# ---------------------------------------------------------------------------
# int_to_words — English (1–24 only)
# ---------------------------------------------------------------------------

class TestIntToWordsEN:
    @pytest.mark.parametrize("n,expected", [
        (1, "one"),   (2, "two"),   (3, "three"),  (4, "four"),
        (5, "five"),  (6, "six"),   (7, "seven"),  (8, "eight"),
        (9, "nine"),  (10, "ten"),  (11, "eleven"), (12, "twelve"),
        (13, "thirteen"), (14, "fourteen"), (15, "fifteen"),
        (16, "sixteen"),  (17, "seventeen"), (18, "eighteen"),
        (19, "nineteen"), (20, "twenty"),
        (21, "twenty-one"), (22, "twenty-two"),
        (23, "twenty-three"), (24, "twenty-four"),
    ])
    def test_en(self, n, expected):
        assert int_to_words(n, "en") == expected

    def test_en_normalise_locale(self):
        """en-US should map to English."""
        assert int_to_words(9, "en-US") == "nine"


# ---------------------------------------------------------------------------
# int_to_words — Russian (1–24 only)
# ---------------------------------------------------------------------------

class TestIntToWordsRU:
    @pytest.mark.parametrize("n,expected", [
        (1, "один"),        (2, "два"),          (3, "три"),
        (4, "четыре"),      (5, "пять"),         (6, "шесть"),
        (7, "семь"),        (8, "восемь"),        (9, "девять"),
        (10, "десять"),     (11, "одиннадцать"),  (12, "двенадцать"),
        (13, "тринадцать"), (14, "четырнадцать"), (15, "пятнадцать"),
        (16, "шестнадцать"),(17, "семнадцать"),   (18, "восемнадцать"),
        (19, "девятнадцать"),(20, "двадцать"),
        (21, "двадцать один"), (22, "двадцать два"),
        (23, "двадцать три"), (24, "двадцать четыре"),
    ])
    def test_ru(self, n, expected):
        assert int_to_words(n, "ru") == expected


# ---------------------------------------------------------------------------
# int_to_words — Italian (1–24 only)
# ---------------------------------------------------------------------------

class TestIntToWordsIT:
    @pytest.mark.parametrize("n,expected", [
        (1, "uno"),        (2, "due"),     (3, "tre"),
        (4, "quattro"),    (5, "cinque"),  (6, "sei"),
        (7, "sette"),      (8, "otto"),    (9, "nove"),
        (10, "dieci"),     (11, "undici"), (12, "dodici"),
        (13, "tredici"),   (14, "quattordici"), (15, "quindici"),
        (16, "sedici"),    (17, "diciassette"), (18, "diciotto"),
        (19, "diciannove"),(20, "venti"),
        (21, "ventuno"),   # elision: venti + uno → ventuno
        (22, "ventidue"),  (23, "ventitre"),
        (24, "ventiquattro"),
    ])
    def test_it(self, n, expected):
        assert int_to_words(n, "it") == expected


# ---------------------------------------------------------------------------
# expand_roman_numerals — integration / end-to-end
# ---------------------------------------------------------------------------

class TestExpandRomanNumerals:

    # --- English replacements ---
    def test_en_simple(self):
        assert expand_roman_numerals("Chapter IX ends here.", "en") == "Chapter nine ends here."

    def test_en_multiple(self):
        result = expand_roman_numerals("Parts I, IV, and XIV.", "en")
        assert result == "Parts one, four, and fourteen."

    def test_en_start_of_sentence(self):
        # Single uppercase I → stays lowercase because it's single-char
        assert expand_roman_numerals("I think so.", "en") == "one think so."

    def test_en_ix(self):
        assert expand_roman_numerals("IX problems.", "en") == "nine problems."

    def test_en_xxiv(self):
        assert expand_roman_numerals("XXIV hours.", "en") == "twenty-four hours."

    # --- Numbers above the cap are left unchanged ---
    def test_en_above_cap_unchanged(self):
        assert expand_roman_numerals("Chapter XXV here.", "en") == "Chapter XXV here."
        assert expand_roman_numerals("Chapter L here.", "en") == "Chapter L here."
        assert expand_roman_numerals("MCMXCIX problems.", "en") == "MCMXCIX problems."

    # --- Russian replacements ---
    def test_ru_simple(self):
        assert expand_roman_numerals("Глава IX начинается.", "ru") == "Глава девять начинается."

    def test_ru_multiple(self):
        result = expand_roman_numerals("Параграфы I и XIV.", "ru")
        assert result == "Параграфы один и четырнадцать."

    def test_ru_above_cap_unchanged(self):
        assert expand_roman_numerals("Глава XXV.", "ru") == "Глава XXV."

    # --- Italian replacements ---
    def test_it_simple(self):
        assert expand_roman_numerals("Capitolo IX è qui.", "it") == "Capitolo nove è qui."

    def test_it_elision(self):
        result = expand_roman_numerals("Capitolo XXI.", "it")
        assert result == "Capitolo ventuno."

    def test_it_above_cap_unchanged(self):
        assert expand_roman_numerals("Capitolo XXV.", "it") == "Capitolo XXV."

    # --- False-positive guards ---
    def test_no_match_inside_word(self):
        """Tokens inside longer words must not be replaced."""
        assert expand_roman_numerals("VIVID colors", "en") == "VIVID colors"

    def test_no_match_covid(self):
        assert expand_roman_numerals("COVID cases", "en") == "COVID cases"

    # --- Case handling ---
    def test_lowercase(self):
        assert expand_roman_numerals("chapter ix", "en") == "chapter nine"

    def test_mixed_case_title(self):
        """'Ix' (title-case token) capitalises the replacement word."""
        result = expand_roman_numerals("Chapter Ix here", "en")
        assert result == "Chapter Nine here"

    def test_single_uppercase_no_cap(self):
        """Single-letter tokens like 'I' are not treated as title-case."""
        result = expand_roman_numerals("Section I done", "en")
        assert result == "Section one done"

    # --- Unsupported language → pass-through ---
    def test_unsupported_lang_passthrough(self):
        assert expand_roman_numerals("Chapter IX ends here.", "fr") == "Chapter IX ends here."
        assert expand_roman_numerals("Chapter IX ends here.", "es") == "Chapter IX ends here."
        assert expand_roman_numerals("Chapter IX ends here.", "ja") == "Chapter IX ends here."

    # --- No Roman numerals → text unchanged ---
    def test_no_numerals_unchanged(self):
        text = "Hello world, no numerals here."
        assert expand_roman_numerals(text, "en") == text

    def test_empty_string(self):
        assert expand_roman_numerals("", "en") == ""
