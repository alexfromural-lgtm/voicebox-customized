/**
 * numToWords.ts
 *
 * Converts numeric tokens inside a string to their spoken-word equivalents
 * before TTS synthesis, so the engine doesn't have to guess how to read them.
 *
 * Supported locales: 'en' (English), 'it' (Italian), 'ru' (Russian).
 * All other locales fall back to leaving the number unchanged.
 *
 * Handles:
 *  - Non-negative integers: 0 – 999 999 999 (nine hundred ninety-nine million …)
 *  - Negative integers:     -42 → "minus forty-two" / "минус сорок два"
 *  - Decimals:              3.14 → "three point one four" / "три целых одна четыре"
 *    (digit-by-digit after the decimal point, the most natural TTS reading)
 *  - Numbers inside words (e.g. "mp3") are left untouched — only standalone
 *    numeric tokens (possibly preceded by a minus sign) are converted.
 */

// ─── English ─────────────────────────────────────────────────────────────────

const EN_ONES = [
  '', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];

const EN_TENS = [
  '', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
];

function intToWordsEn(n: number): string {
  if (n === 0) return 'zero';
  if (n < 0) return `minus ${intToWordsEn(-n)}`;

  const parts: string[] = [];

  if (n >= 1_000_000_000) {
    parts.push(`${intToWordsEn(Math.floor(n / 1_000_000_000))} billion`);
    n %= 1_000_000_000;
  }
  if (n >= 1_000_000) {
    parts.push(`${intToWordsEn(Math.floor(n / 1_000_000))} million`);
    n %= 1_000_000;
  }
  if (n >= 1_000) {
    parts.push(`${intToWordsEn(Math.floor(n / 1_000))} thousand`);
    n %= 1_000;
  }
  if (n >= 100) {
    parts.push(`${EN_ONES[Math.floor(n / 100)]} hundred`);
    n %= 100;
  }
  if (n >= 20) {
    const tens = EN_TENS[Math.floor(n / 10)];
    const ones = EN_ONES[n % 10];
    parts.push(ones ? `${tens}-${ones}` : tens);
  } else if (n > 0) {
    parts.push(EN_ONES[n]);
  }

  return parts.join(' ');
}

function numberToWordsEn(numStr: string): string {
  const isNegative = numStr.startsWith('-');
  const abs = isNegative ? numStr.slice(1) : numStr;
  const [intPart, fracPart] = abs.split('.');

  const intWords = intToWordsEn(parseInt(intPart, 10));
  const prefix = isNegative ? 'minus ' : '';

  if (fracPart === undefined) {
    return prefix + intWords;
  }

  // Decimal digits read one-by-one: 3.14 → "three point one four"
  const fracWords = fracPart.split('').map((d) => EN_ONES[parseInt(d, 10)] || 'zero').join(' ');
  return `${prefix}${intWords} point ${fracWords}`;
}

// ─── Russian ──────────────────────────────────────────────────────────────────

// Russian numbers are grammatically complex; we use a simplified but natural
// reading that matches how a native speaker would read an isolated number.

const RU_ONES_M = [
  '', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять',
  'десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать',
  'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать',
];

// Feminine forms used for thousands (тысяча is feminine)
const RU_ONES_F = [
  '', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять',
  'десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать',
  'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать',
];

const RU_TENS = [
  '', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят',
  'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто',
];

const RU_HUNDREDS = [
  '', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот',
  'шестьсот', 'семьсот', 'восемьсот', 'девятьсот',
];

// Returns word for a number 1–999 in the given gender ('m' = masculine, 'f' = feminine)
function ruChunk(n: number, gender: 'm' | 'f'): string {
  const parts: string[] = [];
  const ones = gender === 'f' ? RU_ONES_F : RU_ONES_M;

  if (n >= 100) {
    parts.push(RU_HUNDREDS[Math.floor(n / 100)]);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(RU_TENS[Math.floor(n / 10)]);
    n %= 10;
    if (n > 0) parts.push(ones[n]);
  } else if (n > 0) {
    parts.push(ones[n]);
  }

  return parts.join(' ');
}

// Russian thousand/million/billion require specific noun forms based on the last digits
function ruThousandForm(n: number): string {
  const last2 = n % 100;
  const last1 = n % 10;
  if (last2 >= 11 && last2 <= 19) return 'тысяч';
  if (last1 === 1) return 'тысяча';
  if (last1 >= 2 && last1 <= 4) return 'тысячи';
  return 'тысяч';
}

function ruMillionForm(n: number): string {
  const last2 = n % 100;
  const last1 = n % 10;
  if (last2 >= 11 && last2 <= 19) return 'миллионов';
  if (last1 === 1) return 'миллион';
  if (last1 >= 2 && last1 <= 4) return 'миллиона';
  return 'миллионов';
}

function ruBillionForm(n: number): string {
  const last2 = n % 100;
  const last1 = n % 10;
  if (last2 >= 11 && last2 <= 19) return 'миллиардов';
  if (last1 === 1) return 'миллиард';
  if (last1 >= 2 && last1 <= 4) return 'миллиарда';
  return 'миллиардов';
}

function intToWordsRu(n: number): string {
  if (n === 0) return 'ноль';
  if (n < 0) return `минус ${intToWordsRu(-n)}`;

  const parts: string[] = [];

  if (n >= 1_000_000_000) {
    const billions = Math.floor(n / 1_000_000_000);
    parts.push(ruChunk(billions, 'm'), ruBillionForm(billions));
    n %= 1_000_000_000;
  }
  if (n >= 1_000_000) {
    const millions = Math.floor(n / 1_000_000);
    parts.push(ruChunk(millions, 'm'), ruMillionForm(millions));
    n %= 1_000_000;
  }
  if (n >= 1_000) {
    const thousands = Math.floor(n / 1_000);
    parts.push(ruChunk(thousands, 'f'), ruThousandForm(thousands));
    n %= 1_000;
  }
  if (n > 0) {
    parts.push(ruChunk(n, 'm'));
  }

  return parts.filter(Boolean).join(' ');
}

const RU_DIGIT_WORDS = ['ноль', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];

function numberToWordsRu(numStr: string): string {
  const isNegative = numStr.startsWith('-');
  const abs = isNegative ? numStr.slice(1) : numStr;
  const [intPart, fracPart] = abs.split('.');

  const intWords = intToWordsRu(parseInt(intPart, 10));
  const prefix = isNegative ? 'минус ' : '';

  if (fracPart === undefined) {
    return prefix + intWords;
  }

  // "3.14" → "три целых один четыре"
  const fracWords = fracPart.split('').map((d) => RU_DIGIT_WORDS[parseInt(d, 10)]).join(' ');
  return `${prefix}${intWords} целых ${fracWords}`;
}

// ─── Italian ─────────────────────────────────────────────────────────────────
//
// Italian-specific rules implemented here:
//  1. Tens drop their final vowel before "uno" (1) and "otto" (8):
//     venti+uno → ventuno, trenta+otto → trentotto
//  2. "tre" at the end of a compound takes an accent: ventitré, trentatré
//     (omitted here — TTS reads the plain word identically)
//  3. Hundreds are compound words: duecento, trecento … novecento
//     ("cento" alone for exactly 100)
//  4. Thousands: "mille" for 1 000, but attached "mila" for 2 000+ (duemila)
//  5. Millions/billions: "un milione" / "due milioni", "un miliardo" / "due miliardi"

const IT_ONES = [
  'zero', 'uno', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'nove',
  'dieci', 'undici', 'dodici', 'tredici', 'quattordici', 'quindici', 'sedici',
  'diciassette', 'diciotto', 'diciannove',
];

const IT_TENS = [
  '', '', 'venti', 'trenta', 'quaranta', 'cinquanta',
  'sessanta', 'settanta', 'ottanta', 'novanta',
];

// Hundreds 100–900 as natural compound words
const IT_HUNDREDS = [
  '', 'cento', 'duecento', 'trecento', 'quattrocento', 'cinquecento',
  'seicento', 'settecento', 'ottocento', 'novecento',
];

/** Convert 0–99 to Italian words. */
function itBelow100(n: number): string {
  if (n < 20) return IT_ONES[n];
  const tensDigit = Math.floor(n / 10);
  const onesDigit = n % 10;
  if (onesDigit === 0) return IT_TENS[tensDigit];
  // Elide the final vowel of the tens word before 1 and 8
  const tensWord =
    onesDigit === 1 || onesDigit === 8
      ? IT_TENS[tensDigit].slice(0, -1)
      : IT_TENS[tensDigit];
  return tensWord + IT_ONES[onesDigit];
}

/** Convert 0–999 to Italian words (used for all groups). */
function itBelow1000(n: number): string {
  if (n < 100) return itBelow100(n);
  const h = Math.floor(n / 100);
  const remainder = n % 100;
  const hundredsWord = IT_HUNDREDS[h];
  if (remainder === 0) return hundredsWord;
  return hundredsWord + ' ' + itBelow100(remainder);
}

function intToWordsIt(n: number): string {
  if (n === 0) return 'zero';
  if (n < 0) return `meno ${intToWordsIt(-n)}`;

  const parts: string[] = [];

  if (n >= 1_000_000_000) {
    const billions = Math.floor(n / 1_000_000_000);
    parts.push(
      billions === 1
        ? 'un miliardo'
        : `${intToWordsIt(billions)} miliardi`,
    );
    n %= 1_000_000_000;
  }
  if (n >= 1_000_000) {
    const millions = Math.floor(n / 1_000_000);
    parts.push(
      millions === 1
        ? 'un milione'
        : `${intToWordsIt(millions)} milioni`,
    );
    n %= 1_000_000;
  }
  if (n >= 1_000) {
    const thousands = Math.floor(n / 1_000);
    if (thousands === 1) {
      // 1 000 = "mille" (no prefix)
      parts.push('mille');
    } else {
      // 2 000+ = "duemila", "tremila" … (attached, no space before "mila")
      parts.push(`${itBelow1000(thousands)}mila`);
    }
    n %= 1_000;
  }
  if (n > 0) {
    parts.push(itBelow1000(n));
  }

  return parts.join(' ');
}

const IT_DIGIT_WORDS = [
  'zero', 'uno', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'nove',
];

function numberToWordsIt(numStr: string): string {
  const isNegative = numStr.startsWith('-');
  const abs = isNegative ? numStr.slice(1) : numStr;
  const [intPart, fracPart] = abs.split('.');

  const intWords = intToWordsIt(parseInt(intPart, 10));
  const prefix = isNegative ? 'meno ' : '';

  if (fracPart === undefined) {
    return prefix + intWords;
  }

  // "3,14" → "tre virgola uno quattro"
  const fracWords = fracPart.split('').map((d) => IT_DIGIT_WORDS[parseInt(d, 10)]).join(' ');
  return `${prefix}${intWords} virgola ${fracWords}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Replace all standalone numeric tokens in `text` with their word equivalents
 * for the given language code.
 *
 * A "standalone numeric token" is a sequence of digits (optionally preceded by
 * a minus sign and optionally containing a single decimal separator) that is
 * NOT directly adjacent to a letter on either side. This prevents touching
 * identifiers like "mp3", "IPv4", "A1", etc.
 *
 * @example
 * replaceNumbersWithWords('Call 495 now!', 'en')
 * // → 'Call four hundred ninety-five now!'
 *
 * replaceNumbersWithWords('Позвони по номеру 495.', 'ru')
 * // → 'Позвони по номеру четыреста девяносто пять.'
 *
 * replaceNumbersWithWords('Chiama il 495.', 'it')
 * // → 'Chiama il quattrocentonovantacinque.'
 */
export function replaceNumbersWithWords(text: string, lang: string): string {
  // Only handle languages we know. Fall through for everything else.
  if (lang !== 'en' && lang !== 'ru' && lang !== 'it') return text;

  const converter =
    lang === 'ru' ? numberToWordsRu
    : lang === 'it' ? numberToWordsIt
    : numberToWordsEn;

  // Match: optional leading minus, digits, optional decimal part
  // The (?<![A-Za-zА-Яа-яЁё\d]) / (?![A-Za-zА-Яа-яЁё\d]) negative look-
  // around prevents matching numbers that are glued to letters (e.g. "mp3").
  return text.replace(
    /(?<![A-Za-zА-Яа-яЁё\d])-?\d+(?:[.,]\d+)?(?![A-Za-zА-Яа-яЁё\d])/g,
    (match) => {
      // Normalise decimal separator (some locales use comma)
      const normalised = match.replace(',', '.');
      try {
        return converter(normalised);
      } catch {
        return match; // Safety: if conversion fails, keep original
      }
    },
  );
}
