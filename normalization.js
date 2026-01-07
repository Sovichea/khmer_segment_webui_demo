
export class KhmerNormalizer {
    constructor() {
        // Khmer Character Ranges
        this.CONSONANTS = new Set(this.range(0x1780, 0x17A3)); // Ka .. A
        this.INDEP_VOWELS = new Set(this.range(0x17A3, 0x17B4)); // In .. Au
        this.DEP_VOWELS = new Set(this.range(0x17B6, 0x17C6)); // Aa .. Au  (Excluding signs)
        this.SIGNS = new Set(this.range(0x17C6, 0x17D4)); // Nikahit .. Viriam + Others (17D3)
        this.REGISTERS = new Set([0x17C9, 0x17CA]); // Muusikatoan, Triisap
        this.COENG = 0x17D2;
        this.RO = 0x179A;

        // Composite Vowels Map (Split components -> Combined)
        // e.g. E (17C1) + I (17B8) -> OE (17BE)
        // Storing as string keys for easy lookup
        this.composites = {
            '\u17C1\u17B8': '\u17BE',
            '\u17C1\u17B6': '\u17C4', // E + AA -> AU
        };
    }

    range(start, end) {
        return Array.from({ length: end - start }, (_, i) => start + i);
    }

    _get_char_type(char) {
        const code = char.charCodeAt(0);
        if (this.CONSONANTS.has(code) || this.INDEP_VOWELS.has(code)) {
            return 'BASE';
        }
        if (code === this.COENG) {
            return 'COENG';
        }
        if (this.REGISTERS.has(code)) {
            return 'REGISTER';
        }
        if (this.DEP_VOWELS.has(code)) {
            return 'VOWEL';
        }
        if (this.SIGNS.has(code) || code === 0x17DD) { // 17DD is Atthacan
            return 'SIGN';
        }
        return 'OTHER';
    }

    normalize(text) {
        if (!text) return "";

        // Step 0: Strip ZWS, ZWNJ, ZWJ
        text = text.replace(/[\u200b\u200c\u200d]/g, '');

        // Step 1: Fix Composites
        text = text.replace('\u17C1\u17B8', '\u17BE'); // e + i -> oe
        text = text.replace('\u17C1\u17B6', '\u17C4'); // e + aa -> au

        // Step 2: Cluster processing
        const result = [];
        let current_cluster = [];

        let i = 0;
        const n = text.length;

        while (i < n) {
            const char = text[i];
            const ctype = this._get_char_type(char);

            if (ctype === 'BASE') {
                // Start of new cluster. Flush previous.
                if (current_cluster.length > 0) {
                    result.push(this._sort_cluster(current_cluster));
                    current_cluster = [];
                }
                current_cluster.push(char);
                i++;
            } else if (ctype === 'COENG') {
                // Coeng consumes next char if valid consonant
                if (i + 1 < n) {
                    const next_char = text[i + 1];
                    const next_type = this._get_char_type(next_char);
                    if (next_type === 'BASE') { // Consonants are BASE
                        // It is a subscript unit
                        current_cluster.push(char + next_char);
                        i += 2;
                        continue;
                    } else {
                        // Stray Coeng
                        current_cluster.push(char);
                        i++;
                    }
                } else {
                    // Trailing Coeng
                    current_cluster.push(char);
                    i++;
                }
            } else if (['VOWEL', 'SIGN', 'REGISTER'].includes(ctype)) {
                // Append to current cluster if exists, else treat as isolated
                if (current_cluster.length > 0) {
                    current_cluster.push(char);
                } else {
                    result.push(char); // Isolated vowel/sign
                }
                i++;
            } else {
                // Other (Space, Punc, English). Flush cluster.
                if (current_cluster.length > 0) {
                    result.push(this._sort_cluster(current_cluster));
                    current_cluster = [];
                }
                result.push(char);
                i++;
            }
        }

        if (current_cluster.length > 0) {
            result.push(this._sort_cluster(current_cluster));
        }

        return result.join("");
    }

    _sort_cluster(parts) {
        if (!parts || parts.length === 0) return "";

        const base = parts[0];
        const modifiers = parts.slice(1);

        modifiers.sort((a, b) => {
            const getPriority = (item) => {
                if (item.startsWith('\u17D2')) { // Subscript
                    if (item.length === 2) {
                        const sub_con = item.charCodeAt(1);
                        if (sub_con === this.RO) {
                            return 2; // Ro Subscript
                        }
                        return 1; // Non-Ro Subscript
                    }
                    return 1.5; // Stray Coeng?
                }

                const code = item.charCodeAt(0);

                if (this.REGISTERS.has(code)) {
                    return 2.5; // After Subscripts, BEFORE Vowels
                }

                if (this.DEP_VOWELS.has(code)) {
                    return 3;
                }
                if (this.SIGNS.has(code) || code === 0x17DD) {
                    return 4;
                }

                return 5; // Other/Unknown
            };

            return getPriority(a) - getPriority(b);
        });

        return base + modifiers.join("");
    }
}
