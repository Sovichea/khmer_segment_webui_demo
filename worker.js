import { KhmerSegmenter } from './segmenter_browser.js';

let segmenter = null;

async function init() {
    try {
        const [dictRes, freqRes, rulesRes] = await Promise.all([
            fetch('./data/khmer_dictionary_words.txt'),
            fetch('./data/khmer_word_frequencies.json'),
            fetch('./rules.json')
        ]);

        if (!dictRes.ok) throw new Error("Failed to load dictionary");
        // if (!freqRes.ok) throw new Error("Failed to load frequencies"); // Freq is optional
        if (!rulesRes.ok) throw new Error("Failed to load rules");

        const dictText = await dictRes.text();
        const freqText = freqRes.ok ? await freqRes.json() : {};
        const rulesData = await rulesRes.json();

        segmenter = new KhmerSegmenter(dictText, freqText, rulesData);
        postMessage({ type: 'ready' });

    } catch (e) {
        postMessage({ type: 'error', error: e.message });
    }
}

init();

self.onmessage = (e) => {
    if (!segmenter) return;

    const { type, text, id } = e.data;

    if (type === 'segment') {
        try {
            const result = segmenter.segment(text);

            // Map results to include unknown status for UI
            const annotated = result.map(word => ({
                word: word,
                isUnknown: segmenter.isUnknown(word)
            }));

            postMessage({ type: 'result', id, result: annotated });
        } catch (err) {
            postMessage({ type: 'error', id, error: err.message });
        }
    }
};
