import { KhmerNormalizer } from './normalization.js';
import { RuleBasedEngine } from './rule_engine.js';

export class KhmerSegmenter {
    // Constructor accepts raw content strings or objects
    constructor(dictionaryContent, frequencyData, rulesData) {
        this.words = new Set();
        this.normalizer = new KhmerNormalizer();
        this.maxWordLength = 0;

        // Word Costs
        this.wordCosts = {};
        this.defaultCost = 10.0;
        this.unknownCost = 20.0;

        // Initialize Rule Engine
        // We need to bind methods to 'this' effectively or wrapper functions
        this.ruleEngine = new RuleBasedEngine(
            (seg) => this._isInvalidSingle(seg),
            (seg) => this._isSeparator(seg),
            rulesData || []
        );

        this._loadDictionary(dictionaryContent);
        this._loadFrequencies(frequencyData);
    }

    _loadDictionary(content) {
        if (!content) return;

        const lines = content.split(/\r?\n/);

        for (let line of lines) {
            let word = line.trim().replace(/[\u200b\u200c\u200d]/g, '');
            if (word) {
                if (word.length === 1 && !this._isValidSingleBaseChar(word)) {
                    continue;
                }

                this.words.add(word);
                if (word.length > this.maxWordLength) {
                    this.maxWordLength = word.length;
                }

                // Generate variants
                const variants = this._generateVariants(word);
                for (const v of variants) {
                    this.words.add(v);
                    if (v.length > this.maxWordLength) {
                        this.maxWordLength = v.length;
                    }
                }
            }
        }

        // Filter out compound words containing "ឬ" (or) 
        // Logic from Python:
        const wordsToRemove = new Set();
        for (const word of this.words) {
            if (word.includes("ឬ") && word.length > 1) {
                if (word.startsWith("ឬ")) {
                    const suffix = word.substring(1);
                    if (this.words.has(suffix)) wordsToRemove.add(word);
                } else if (word.endsWith("ឬ")) {
                    const prefix = word.slice(0, -1);
                    if (this.words.has(prefix)) wordsToRemove.add(word);
                } else {
                    const parts = word.split("ឬ");
                    if (parts.every(p => this.words.has(p) || p === "")) {
                        wordsToRemove.add(word);
                    }
                }
            }
            if (word.includes('ៗ')) {
                wordsToRemove.add(word);
            }
            if (word.startsWith('\u17D2')) {
                wordsToRemove.add(word);
            }
        }

        if (wordsToRemove.size > 0) {
            // console.log(`Removing ${wordsToRemove.size} invalid words.`);
            for (const w of wordsToRemove) {
                this.words.delete(w);
            }
        }

        if (this.words.has("ៗ")) {
            this.words.delete("ៗ");
        }

        // Recalculate max length
        this.maxWordLength = 0;
        for (const word of this.words) {
            if (word.length > this.maxWordLength) {
                this.maxWordLength = word.length;
            }
        }

        // console.log(`Loaded ${this.words.size} words. Max length: ${this.maxWordLength}`);
    }

    _isValidSingleBaseChar(char) {
        const code = char.charCodeAt(0);
        // Consonants: 0x1780 - 0x17A2
        if (code >= 0x1780 && code <= 0x17A2) return true;
        // Indep Vowels: 0x17A3 - 0x17B3
        if (code >= 0x17A3 && code <= 0x17B3) return true;
        return false;
    }

    _isInvalidSingle(seg) {
        if (seg.length !== 1) return false;
        if (!this._isKhmerChar(seg)) return false;
        if (this._isValidSingleBaseChar(seg)) return false;
        if (this._isDigit(seg)) return false;
        if (this._isSeparator(seg)) return false;
        if (this.words.has(seg)) return false;
        return true;
    }

    _generateVariants(word) {
        const variants = new Set();
        const coeng_ta = '\u17D2\u178F';
        const coeng_da = '\u17D2\u178A';

        if (word.includes(coeng_ta)) {
            variants.add(word.replace(new RegExp(coeng_ta, 'g'), coeng_da));
        }
        if (word.includes(coeng_da)) {
            variants.add(word.replace(new RegExp(coeng_da, 'g'), coeng_ta));
        }

        const baseSet = new Set([word, ...variants]);
        const finalVariants = new Set(variants);

        // Pattern 1: Coeng Ro followed by Other Coeng
        // (\u17D2\u179A)(\u17D2[^\u179A])
        const p1 = /(\u17D2\u179A)(\u17D2[^\u179A])/g;

        // Pattern 2: Other Coeng followed by Coeng Ro
        // (\u17D2[^\u179A])(\u17D2\u179A)
        const p2 = /(\u17D2[^\u179A])(\u17D2\u179A)/g;

        for (const w of baseSet) {
            let wNew = w;
            if (p1.test(w)) {
                wNew = w.replace(p1, '$2$1');
                finalVariants.add(wNew);
            }

            let wNew2 = w;
            if (p2.test(w)) {
                wNew2 = w.replace(p2, '$2$1');
                finalVariants.add(wNew2);
            }
        }
        return finalVariants;
    }

    _loadFrequencies(data) {
        if (!data) {
            console.log(`No frequency data provided. Using default costs.`);
            return;
        }

        const minFreqFloor = 5.0;
        const effectiveCounts = {};
        let totalTokens = 0;

        for (let [word, count] of Object.entries(data)) {
            word = word.replace(/[\u200b\u200c\u200d]/g, '');
            const eff = Math.max(count, minFreqFloor);
            effectiveCounts[word] = eff;

            const variants = this._generateVariants(word);
            for (const v of variants) {
                if (!(v in effectiveCounts)) {
                    effectiveCounts[v] = eff;
                }
            }
            totalTokens += eff;
        }

        if (totalTokens > 0) {
            const minProb = minFreqFloor / totalTokens;
            this.defaultCost = -Math.log10(minProb);
            this.unknownCost = this.defaultCost + 5.0;

            for (const [word, count] of Object.entries(effectiveCounts)) {
                const prob = count / totalTokens;
                if (prob > 0) {
                    this.wordCosts[word] = -Math.log10(prob);
                }
            }
        }
    }

    getWordCost(word) {
        if (word in this.wordCosts) return this.wordCosts[word];
        if (this.words.has(word)) return this.defaultCost;
        return this.unknownCost;
    }

    _isKhmerChar(char) {
        const code = char.charCodeAt(0);
        return (code >= 0x1780 && code <= 0x17FF) || (code >= 0x19E0 && code <= 0x19FF);
    }

    _getKhmerClusterLength(text, startIndex) {
        const n = text.length;
        if (startIndex >= n) return 0;

        let i = startIndex;
        const char = text[i];
        const code = char.charCodeAt(0);

        if (!(code >= 0x1780 && code <= 0x17B3)) {
            return 1;
        }

        i++;
        while (i < n) {
            const nextChar = text[i];
            const nextCode = nextChar.charCodeAt(0);

            // Coeng
            if (nextCode === 0x17D2) {
                if (i + 1 < n) {
                    const subChar = text[i + 1];
                    const subCode = subChar.charCodeAt(0);
                    if (subCode >= 0x1780 && subCode <= 0x17A2) {
                        i += 2;
                        continue;
                    }
                }
                break;
            }

            // Vowels/Signs
            if ((nextCode >= 0x17B6 && nextCode <= 0x17D1) || nextCode === 0x17D3 || nextCode === 0x17DD) {
                i++;
                continue;
            }
            break;
        }
        return i - startIndex;
    }

    _isDigit(text) {
        if (text.length !== 1) {
            return [...text].every(c => this._isDigit(c));
        }
        const code = text.charCodeAt(0);
        return (code >= 0x30 && code <= 0x39) || (code >= 0x17E0 && code <= 0x17E9);
    }

    _getNumberLength(text, startIndex) {
        const n = text.length;
        let i = startIndex;
        if (!this._isDigit(text[i])) return 0;
        i++;
        while (i < n) {
            const char = text[i];
            if (this._isDigit(char)) {
                i++;
                continue;
            }
            if (char === ',' || char === '.') {
                if (i + 1 < n && this._isDigit(text[i + 1])) {
                    i += 2;
                    continue;
                } else {
                    break;
                }
            } else {
                break;
            }
        }
        return i - startIndex;
    }

    _isSeparator(char) {
        if (char.length !== 1) return false;
        const code = char.charCodeAt(0);
        if (code >= 0x17D4 && code <= 0x17DA) return true;
        if (code === 0x17DB) return true;

        if (/\p{P}|\p{S}|\p{Z}/u.test(char)) return true; // Unicode properties P, S, Z
        if (/\s/.test(char)) return true; // Catch-all for whitespace including \n, \r, \t which might not be in Z

        return false;
    }

    _isAcronymStart(text, index) {
        const n = text.length;
        if (index + 1 >= n) return false;

        const code = text[index].charCodeAt(0);
        if (!(code >= 0x1780 && code <= 0x17B3)) return false;

        const clusterLen = this._getKhmerClusterLength(text, index);
        if (clusterLen === 0) return false;

        const dotIndex = index + clusterLen;
        if (dotIndex < n && text[dotIndex] === '.') return true;

        return false;
    }

    _getAcronymLength(text, startIndex) {
        const n = text.length;
        let i = startIndex;

        while (i < n) {
            if (i < n) {
                const code = text[i].charCodeAt(0);
                if (!(code >= 0x1780 && code <= 0x17B3)) break;
            }

            const clusterLen = this._getKhmerClusterLength(text, i);
            if (clusterLen > 0) {
                const dotIndex = i + clusterLen;
                if (dotIndex < n && text[dotIndex] === '.') {
                    i = dotIndex + 1;
                    continue;
                } else {
                    break;
                }
            } else {
                break;
            }
        }
        return i - startIndex;
    }

    segment(text, disablePostProcessing = false) {
        text = this.normalizer.normalize(text);
        const n = text.length;
        if (n === 0) return [];

        const dp = new Array(n + 1);
        for (let i = 0; i <= n; i++) dp[i] = [Infinity, -1];
        dp[0] = [0.0, -1];

        for (let i = 0; i < n; i++) {
            if (dp[i][0] === Infinity) continue;

            let forceRepair = false;

            // 1. Prev char was Coeng
            if (i > 0 && text[i - 1] === '\u17D2') {
                const charCode = text[i].charCodeAt(0);
                if (charCode >= 0x1780 && charCode <= 0x17A2) {
                    // Valid attached, we shouldn't be here, but if we are...
                    forceRepair = true;
                } else {
                    forceRepair = true;
                }
            }

            // 2. Current char is Dep Vowel
            const curCode = text[i].charCodeAt(0);
            if (curCode >= 0x17B6 && curCode <= 0x17C5) {
                forceRepair = true;
            }

            if (forceRepair) {
                const nextIdx = i + 1;
                const newCost = dp[i][0] + this.unknownCost + 50.0;
                if (nextIdx <= n && newCost < dp[nextIdx][0]) {
                    dp[nextIdx] = [newCost, i];
                }
                continue;
            }

            // 1. Number Grouping
            if (this._isDigit(text[i])) {
                const numLen = this._getNumberLength(text, i);
                const nextIdx = i + numLen;
                const stepCost = 1.0;
                if (dp[i][0] + stepCost < dp[nextIdx][0]) {
                    dp[nextIdx] = [dp[i][0] + stepCost, i];
                }
            }
            // 2. Separators
            else if (this._isSeparator(text[i])) {
                const nextIdx = i + 1;
                const stepCost = 0.1;
                if (dp[i][0] + stepCost < dp[nextIdx][0]) {
                    dp[nextIdx] = [dp[i][0] + stepCost, i];
                }
            }
            // 3. Acronyms
            if (this._isAcronymStart(text, i)) {
                const acrLen = this._getAcronymLength(text, i);
                const nextIdx = i + acrLen;
                const stepCost = this.defaultCost;
                if (dp[i][0] + stepCost < dp[nextIdx][0]) {
                    dp[nextIdx] = [dp[i][0] + stepCost, i];
                }
            }

            // 3. Dictionary Match
            const endLimit = Math.min(n, i + this.maxWordLength);
            for (let j = i + 1; j <= endLimit; j++) {
                const word = text.slice(i, j);
                if (this.words.has(word)) {
                    const wordCost = this.getWordCost(word);
                    const newCost = dp[i][0] + wordCost;
                    if (newCost < dp[j][0]) {
                        dp[j] = [newCost, i];
                    }
                }
            }

            // 4. Unknown Fallback
            if (this._isKhmerChar(text[i])) {
                const clusterLen = this._getKhmerClusterLength(text, i);
                let stepCost = this.unknownCost;

                if (clusterLen === 1) {
                    if (!this._isValidSingleBaseChar(text[i])) {
                        stepCost += 10.0;
                    }
                }
                const nextIdx = i + clusterLen;
                if (nextIdx <= n) {
                    if (dp[i][0] + stepCost < dp[nextIdx][0]) {
                        dp[nextIdx] = [dp[i][0] + stepCost, i];
                    }
                }
            } else {
                const clusterLen = 1;
                const stepCost = this.unknownCost;
                const nextIdx = i + clusterLen;
                if (nextIdx <= n) {
                    if (dp[i][0] + stepCost < dp[nextIdx][0]) {
                        dp[nextIdx] = [dp[i][0] + stepCost, i];
                    }
                }
            }
        }

        // Backtrack
        const segments = [];
        let curr = n;
        while (curr > 0) {
            const [cost, prev] = dp[curr];
            if (prev === -1) {
                // If stuck, just take 1 char... but prevent infinite loop
                // Fallback: This usually shouldn't happen if unknown fallback covers all
                // throw new Error(`Could not segment text. Stuck at index ${curr}`);
                // Silent recovery for UI
                segments.push(text.slice(curr - 1, curr));
                curr = curr - 1;
            } else {
                segments.push(text.slice(prev, curr));
                curr = prev;
            }
        }

        const rawSegments = segments.reverse();

        if (disablePostProcessing) return rawSegments;

        const pass2Segments = this.ruleEngine.applyRules(rawSegments);

        const finalSegments = [];
        let unknownBuffer = [];

        // Check unknown status for red underline - wait for UI logic??
        // The segmenter just returns segments. 
        // We will add a method or property to check if a word is unknown.
        // But for standard output, we just return the list.
        // We can create a method `segmentWithUnknowns` later if needed? -> Actually user wants red underline.
        // The request says "draw red underline for all the unknown words".
        // The current segmenter merges unknowns...

        // Let's modify logic:
        // Current logic:
        /*
        for (const seg of pass2Segments) {
            let isKnown = false;
             ... checks ...
            if (isKnown) {
                if (unknownBuffer.length > 0) {
                    finalSegments.push(unknownBuffer.join(""));
                    unknownBuffer = [];
                }
                finalSegments.push(seg);
            } else {
                unknownBuffer.push(seg);
            }
        }
        */
        // This merging DESTROYS the info of what was unknown if we merge them into one block.
        // But maybe that's what we want? "Unknown words" -> usually we group unknown chars into one "unknown word".
        // Yes. So if I return a list of words, I can check each word against the dictionary in the UI to decide to underline.
        // That requires the UI to have the dictionary too? Or I can return objects: { text: "...", method: "dict"|"unknown" }
        // The current `segment` return array of strings.
        // I will keep it returning array of strings, and add `isUnknown(word)` method to the class for the UI to use.

        for (const seg of pass2Segments) {
            let isKnown = false;
            // Check known status
            if (this._isDigit(seg[0])) isKnown = true;
            else if (this.words.has(seg)) isKnown = true;
            else if (seg.length === 1 && this._isValidSingleBaseChar(seg)) isKnown = true;
            else if (this._isSeparator(seg)) isKnown = true;
            else if (seg.includes('.') && seg.length >= 2) isKnown = true; // Acronym assumption

            if (isKnown) {
                if (unknownBuffer.length > 0) {
                    finalSegments.push(unknownBuffer.join(""));
                    unknownBuffer = [];
                }
                finalSegments.push(seg);
            } else {
                if (unknownBuffer.length > 0) {
                    const lastChar = unknownBuffer[unknownBuffer.length - 1][0];
                    const currChar = seg[0];
                    const isLastKhmer = this._isKhmerChar(lastChar);
                    const isCurrKhmer = this._isKhmerChar(currChar);

                    if (isLastKhmer !== isCurrKhmer) {
                        finalSegments.push(unknownBuffer.join(""));
                        unknownBuffer = [];
                    }
                }
                unknownBuffer.push(seg);
            }
        }

        if (unknownBuffer.length > 0) {
            finalSegments.push(unknownBuffer.join(""));
        }

        return finalSegments;
    }

    // Helper for UI
    isUnknown(word) {
        if (!word) return false;
        if (this.words.has(word)) return false;
        if (this._isDigit(word[0])) return false;
        if (this._isSeparator(word)) return false;
        if (word.length === 1 && this._isValidSingleBaseChar(word)) return false;
        if (word.includes('.') && word.length >= 2) return false;
        /*
          NOTE: If we merged multiple unknown segments into one (e.g. "ABC"), the combined "ABC" is definitely unknown.
        */
        return true;
    }
}
