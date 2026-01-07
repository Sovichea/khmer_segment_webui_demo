
// State
const state = {
    editText: '', // Content in Edit Mode
    segmentedResult: [], // Array of word objects {word, isUnknown}
    isSegmenting: false,
    unknownWords: [], // Array of indices in segmentedResult
    currentUnknownIndex: -1,
    mode: 'edit', // 'edit' or 'view'
    lastSegmentedText: '' // specific snapshot that was segmented
};

// UI Elements
const els = {
    editor: document.getElementById('editor'),
    modeToggle: document.getElementById('mode-toggle'),
    statusIndicator: document.getElementById('status-indicator'),
    wordCount: document.getElementById('word-count'),
    unknownCount: document.getElementById('unknown-count'),
    navControls: document.getElementById('nav-controls'),
    navStatus: document.getElementById('nav-status'),
    btnPrev: document.getElementById('btn-prev-unknown'),
    btnNext: document.getElementById('btn-next-unknown'),
    btnDownload: document.getElementById('btn-download')
};


// Worker Pool
class WorkerPool {
    constructor(size = 4) {
        this.size = size;
        this.workers = [];
        this.queue = [];
        this.ready = false;
        this.init();
    }

    init() {
        let loadedCount = 0;
        for (let i = 0; i < this.size; i++) {
            const worker = new Worker('worker.js', { type: 'module' });
            worker.onmessage = (e) => {
                const { type } = e.data;
                if (type === 'ready') {
                    loadedCount++;
                    if (loadedCount === this.size) {
                        this.ready = true;
                        updateStatus('រួចរាល់', 'success');
                    }
                }
            };
            this.workers.push(worker);
        }
    }

    async segment(text) {
        if (!this.ready) return [];
        // Split text by newlines to preserve structure and parallelize
        // We use a regex dealing with various newline formats
        const lines = text.split(/(\r\n|\r|\n)/g);
        // split with capture enables us to keep the delimiters, so we can reassemble perfectly.

        const promises = lines.map((line) => {
            // We only process actual content, but we need to preserve the separators too.
            // However, our worker splits words. A newline is effectively a separator.
            // So we dispatch "content" lines to workers, and wrap separators as "words" directly.

            if (/^(\r\n|\r|\n)$/.test(line)) {
                // It's a newline
                return Promise.resolve([{ word: line, isUnknown: false }]);
            }
            if (!line) return Promise.resolve([]);
            return this._runWorker(line);
        });

        const results = await Promise.all(promises);
        return results.flat();
    }

    _runWorker(text) {
        return new Promise((resolve, reject) => {
            const worker = this.workers[Math.floor(Math.random() * this.workers.length)];
            const id = Math.random().toString(36).substr(2, 9);

            const handler = (e) => {
                const { type, id: msgId, result, error } = e.data;
                if (msgId !== id) return; // Not our message

                worker.removeEventListener('message', handler);

                if (type === 'result') resolve(result);
                else reject(error);
            };

            worker.addEventListener('message', handler);
            worker.postMessage({ type: 'segment', text, id });
        });
    }
}

const pool = new WorkerPool(4);

// Debounce
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}

function updateStatus(text, type = 'normal') {
    els.statusIndicator.textContent = text;
    els.statusIndicator.className = 'status-indicator ' + type;
}

// ----------------------------------------------------
// CORE LOGIC with Highlight API
// ----------------------------------------------------

const runSegmentation = async () => {
    // Current text in editor
    const text = els.editor.innerText;

    if (text === state.lastSegmentedText && state.segmentedResult.length > 0 && state.mode === 'edit') {
        // Just re-hightlight incase DOM changed but text didn't? 
        // Or return. Ideally return.
        // But if we just switched modes, we might need to re-apply highlights?
    }

    state.isSegmenting = true;
    updateStatus('កំពុងដំណើរការ...', 'warning');

    const startTime = performance.now();

    try {
        const results = await pool.segment(text);
        const endTime = performance.now();
        const durationSec = (endTime - startTime) / 1000;

        state.segmentedResult = results;
        state.lastSegmentedText = text;
        state.isSegmenting = false;

        // Analyze
        state.unknownWords = [];
        let wordCount = 0;
        let unknownCount = 0;

        results.forEach((item, index) => {
            if (!item.word) return;
            // Trim check for word count? Or count all tokens? Usually word count ignores whitespace.
            // Let's count non-whitespace tokens as words.
            if (!/^[\s\n\r]*$/.test(item.word)) {
                wordCount++;
            }
            if (item.isUnknown) {
                unknownCount++;
                state.unknownWords.push(index);
            }
        });

        // Benchmark
        if (durationSec > 0 && wordCount > 0) {
            const kWordsPerSec = (wordCount / 1000) / durationSec;
            let benchText = `${kWordsPerSec.toFixed(2)} KWords/sec`;

            // Memory (Chrome/Edge only)
            if (performance.memory) {
                const usedMem = performance.memory.usedJSHeapSize / (1024 * 1024);
                benchText += ` | ${usedMem.toFixed(1)} MB`;
            }

            const benchEl = document.getElementById('benchmark-display');
            if (benchEl) {
                benchEl.textContent = benchText;
            }
        }



        els.wordCount.textContent = `${wordCount} ពាក្យ`;
        els.unknownCount.textContent = `${unknownCount} ពាក្យមិនស្គាល់`;

        // Nav Controls
        if (unknownCount > 0) {
            els.navControls.style.visibility = 'visible';
            els.navControls.style.opacity = '1';
        } else {
            els.navControls.style.visibility = 'hidden';
            els.navControls.style.opacity = '0';
        }

        if (state.mode === 'edit') {
            applyHighlights();
        }

        state.currentUnknownIndex = -1;
        updateNavStatus();
        updateStatus('រួចរាល់', 'success');

    } catch (e) {
        console.error(e);
        state.isSegmenting = false;
        updateStatus('Error', 'error');
    }
};

const debouncedSegmentation = debounce(runSegmentation, 500);

// Helper: Map abstract text offsets to DOM Ranges
// This is the tricky part. We must traverse Text Nodes matching the innerText logic.
function getAllTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
}

function getRangesForUnknowns(root, segments, unknownIndices) {
    const ranges = [];
    if (unknownIndices.length === 0) return ranges;

    const textNodes = getAllTextNodes(root);
    if (textNodes.length === 0) return ranges;

    let nodeIdx = 0;
    let charIdx = 0; // Index within the current node

    // We must walk through every segment to keep sync
    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const segWord = segment.word;
        if (!segWord) continue;

        // Remove the previous "skip newline segment" block. 
        // We handle it char-by-char now.

        let segCharIdx = 0;
        let startNode = null;
        let startOffset = -1;
        const isTarget = segment.isUnknown;

        // Console debug for first few and last few segments or purely on mismatch?
        // Let's log if we have a mismatch to capture the issue.

        while (segCharIdx < segWord.length) {
            if (nodeIdx >= textNodes.length) {
                // Run out of DOM text?
                // If we have remaining segment chars that are just newlines, we can ignore them.
                // If real content, then we have a problem.
                break;
            }

            const node = textNodes[nodeIdx];
            const nodeVal = node.nodeValue;

            if (charIdx >= nodeVal.length) {
                // Move to next node
                nodeIdx++;
                charIdx = 0;
                continue;
            }

            const domChar = nodeVal[charIdx];
            const segChar = segWord[segCharIdx];
            const domCC = domChar.charCodeAt(0);
            const segCC = segChar.charCodeAt(0);

            // 1. Strict Match
            if (domChar === segChar) {
                if (isTarget && startNode === null) {
                    startNode = node;
                    startOffset = charIdx;
                }
                charIdx++;
                segCharIdx++;
            }
            // 2. DOM has invisible junk (ZWSP, or sometimes a newline that segment doesn't have?)
            // Actually, if segment has newline, and DOM has newline, it matches #1.
            // If DOM has ZWSP, segment doesn't (normalized).
            else if (/[\u200b\u200c\u200d]/.test(domChar)) {
                charIdx++;
            }
            // 3. Segment has newline, DOM doesn't (likely <br> or block bound)
            else if (/[\r\n]/.test(segChar)) {
                segCharIdx++;
            }
            // 4. Mismatch
            else {
                // Try to skip DOM char to resync?
                // This usually implies DOM has extra stuff we dind't expect.
                // console.warn(`Mismatch: DOM '${domChar.charCodeAt(0)}' vs Seg '${segChar.charCodeAt(0)}'`);
                charIdx++;
            }
        }

        // Close range
        if (isTarget && startNode) {
            const range = new Range();
            range.setStart(startNode, startOffset);
            range.setEnd(textNodes[nodeIdx], charIdx);
            ranges.push({ range, index: i });
        }
    }

    return ranges;
}

function applyHighlights() {
    if (!window.CSS || !CSS.highlights) {
        console.error("CSS Custom Highlight API not supported.");
        return;
    }

    const ranges = getRangesForUnknowns(els.editor, state.segmentedResult, state.unknownWords);

    // Create Highlight for ALL unknowns
    const unknownRanges = ranges.map(r => r.range);
    const unknownHighlight = new Highlight(...unknownRanges);
    CSS.highlights.set('unknown-word', unknownHighlight);

    // Current Nav Highlight
    if (state.currentUnknownIndex !== -1) {
        // Find the range that corresponds to this index
        const match = ranges.find(r => r.index === state.currentUnknownIndex);
        if (match) {
            const navHighlight = new Highlight(match.range);
            CSS.highlights.set('current-nav', navHighlight);
        } else {
            CSS.highlights.delete('current-nav');
        }
    } else {
        CSS.highlights.delete('current-nav');
    }
}


// Handlers
els.editor.addEventListener('input', () => {
    if (state.mode === 'edit') {
        debouncedSegmentation();
    }
});

els.editor.addEventListener('paste', (e) => {
    if (state.mode === 'edit') {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text');
        document.execCommand('insertText', false, text);
    }
});

// Sync paragraph separator
document.execCommand('defaultParagraphSeparator', false, 'br');

els.modeToggle.addEventListener('change', (e) => {
    const isViewMode = e.target.checked;
    state.mode = isViewMode ? 'view' : 'edit';

    if (state.mode === 'view') {
        // Clear Highlights in view mode (optional, but good practice)
        CSS.highlights.clear();

        if (els.editor.innerText !== state.lastSegmentedText) {
            updateStatus('Finalizing...', 'warning');
            runSegmentation().then(renderViewMode);
        } else {
            renderViewMode();
        }
    } else {
        renderEditMode();
    }
});

function renderViewMode() {
    els.editor.contentEditable = false;
    els.editor.classList.add('view-mode');

    let html = '';
    state.segmentedResult.forEach((item, index) => {
        const cls = item.isUnknown ? 'segment-box unknown-box' : 'segment-box';
        const safeWord = item.word.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        html += `<span class="${cls}" data-index="${index}">${safeWord}</span>`;
    });
    els.editor.innerHTML = html;
}

function renderEditMode() {
    els.editor.contentEditable = true;
    els.editor.classList.remove('view-mode');
    els.editor.innerText = state.lastSegmentedText;
    applyHighlights();
}

// Nav
function updateNavStatus() {
    const total = state.unknownWords.length;
    let current = 0;
    if (state.currentUnknownIndex !== -1) {
        const idx = state.unknownWords.indexOf(state.currentUnknownIndex);
        if (idx !== -1) current = idx + 1;
    }
    els.navStatus.textContent = `${current}/${total}`;
}

function scrollToUnknown(direction) {
    if (state.unknownWords.length === 0) return;

    let currentArrayIdx = state.unknownWords.indexOf(state.currentUnknownIndex);

    if (direction === 'next') {
        currentArrayIdx++;
        if (currentArrayIdx >= state.unknownWords.length) currentArrayIdx = 0;
    } else {
        currentArrayIdx--;
        if (currentArrayIdx < 0) currentArrayIdx = state.unknownWords.length - 1;
    }

    const resultIndex = state.unknownWords[currentArrayIdx];
    state.currentUnknownIndex = resultIndex;

    if (state.mode === 'view') {
        const span = els.editor.querySelector(`span[data-index="${resultIndex}"]`);
        if (span) {
            // span.scrollIntoView({ behavior: 'smooth', block: 'center' }); // Causes whole page scroll

            // Manual scroll calculation for View Mode
            const spanRect = span.getBoundingClientRect();
            const editorRect = els.editor.getBoundingClientRect();

            const relativeTop = spanRect.top - editorRect.top + els.editor.scrollTop;
            const containerHeight = els.editor.clientHeight;

            els.editor.scrollTo({
                top: relativeTop - (containerHeight / 2) + (spanRect.height / 2),
                behavior: 'smooth'
            });

            document.querySelectorAll('.current-highlight').forEach(el => el.classList.remove('current-highlight'));
            span.classList.add('current-highlight');
        }
    } else {
        // Edit Mode Highlight API
        applyHighlights(); // Update 'current-nav' highlight

        // Scroll to range
        // We need to re-find the range object to get rect
        const ranges = getRangesForUnknowns(els.editor, state.segmentedResult, state.unknownWords);
        const match = ranges.find(r => r.index === resultIndex);

        if (match) {
            const rect = match.range.getBoundingClientRect();
            const editorRect = els.editor.getBoundingClientRect();

            // Absolute scroll calculation
            // scrollTop of editor = how much we scrolled down.
            // rect.top is relative to viewport.
            // We want element to be in middle of editor.

            const relativeTop = rect.top - editorRect.top + els.editor.scrollTop;
            const containerHeight = els.editor.clientHeight;

            els.editor.scrollTo({
                top: relativeTop - (containerHeight / 2) + (rect.height / 2),
                behavior: 'smooth'
            });
        }
    }
    updateNavStatus();
}

els.btnNext.addEventListener('click', () => scrollToUnknown('next'));
els.btnPrev.addEventListener('click', () => scrollToUnknown('prev'));

// Initial
state.editText = els.editor.innerText;

// Force BR for newlines to match backdrop pre-wrap behavior better than P/DIV
document.execCommand('defaultParagraphSeparator', false, 'br');

// Download Handler
els.btnDownload.addEventListener('click', () => {
    if (state.segmentedResult.length === 0) return;

    // Format: word1 | word 2 | word 3
    const textContent = state.segmentedResult
        .map(s => s.word)
        .filter(w => w && !/^[\s\r\n]*$/.test(w)) // Filter out whitespace-only segments
        .join(' | ');

    const blob = new Blob([textContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'segmentation_result.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

