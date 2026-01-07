const workerCount = 4;
const workers = [];
const workerStatus = Array(workerCount).fill(false); // true if ready
let nextWorkerIndex = 0;
const statusIndicator = document.getElementById('status-indicator');
const editor = document.getElementById('editor');
const btnDownload = document.getElementById('btn-download');
const wordCount = document.getElementById('word-count');
const unknownCount = document.getElementById('unknown-count');

// Initialize Workers
for (let i = 0; i < workerCount; i++) {
    const worker = new Worker('worker.js', { type: 'module' });

    worker.onmessage = (e) => {
        const { type, id, result } = e.data;

        if (type === 'ready') {
            workerStatus[i] = true;
            checkAllReady();
        } else if (type === 'result') {
            handleWorkerResult(id, result);
        } else if (type === 'error') {
            console.error(`Worker ${i} error:`, e.data.error);
        }
    };

    workers.push(worker);
}

function checkAllReady() {
    if (workerStatus.every(s => s)) {
        statusIndicator.textContent = "រួចរាល់";
        statusIndicator.classList.remove("processing");
    } else {
        statusIndicator.textContent = `កំពុងផ្ទុក... (${workerStatus.filter(s => s).length}/${workerCount})`;
        statusIndicator.classList.add("processing");
    }
}

// Segmentation State
let activeRequestId = 0;
let isViewMode = false;
let currentWords = []; // Cache for re-rendering

// History Manager for Undo/Redo
const historyManager = {
    stack: [],
    currentIndex: -1,
    maxSize: 50,

    push(state) {
        // Remove redo history if we are in middle of stack
        if (this.currentIndex < this.stack.length - 1) {
            this.stack = this.stack.slice(0, this.currentIndex + 1);
        }

        // Don't push identical states (simple check)
        const current = this.stack[this.currentIndex];
        if (current && current.html === state.html) return;

        this.stack.push(state);
        if (this.stack.length > this.maxSize) {
            this.stack.shift();
        } else {
            this.currentIndex++;
        }
    },

    undo() {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            return this.stack[this.currentIndex];
        }
        return null;
    },

    redo() {
        if (this.currentIndex < this.stack.length - 1) {
            this.currentIndex++;
            return this.stack[this.currentIndex];
        }
        return null;
    },

    getCurrentState() {
        // Capture HTML and caret
        return {
            html: editor.innerHTML,
            caret: getCaretCharacterOffsetWithin(editor),
            words: currentWords // Cache words to avoid re-segmentation if possible
        };
    }
};

// Initial state
historyManager.push(historyManager.getCurrentState());

// Helper to get next worker
function getNextWorker() {
    const w = workers[nextWorkerIndex];
    nextWorkerIndex = (nextWorkerIndex + 1) % workerCount;
    return w;
}

// Handle Editor Input (Debounce for Real-time, Immediate for Paste)
let typingTimer;
const doneTypingInterval = 100; // 0.1s debounce for history checkpoints

editor.addEventListener('input', (e) => {
    // Basic stats
    const text = editor.innerText;
    // unknownCount.textContent = `...`; // Updated after segmentation
    // Word count is approx until segmented

    // Identify typing vs paste (simple heuristic or use inputType)
    // If inputType is 'insertFromPaste', we might want to trigger full re-segmentation
    // But for 'insertText', we segement current sentence.

    // For simplicity:
    // If text ends with '។', segment the last sentence immediately?
    // "when user start typing, run the sequential segmentatioin in real-time in the current sentence. Use ។ to identify the length of the sentence to process."

    // Limitation: ContentEditable HTML structure is messy. Resetting innerHTML ruins cursor position.
    // Solution: 
    // 1. We only modify the DOM if we are confident.
    // 2. Or we just show results in a separate view? 
    // Request says: "Tex editor have a definite width... draw red underline for all the unknown words"
    // So we must modify the editor content.
    // Preserving caret in ContentEditable while modifying HTML is HARD.

    // Strategy:
    // Only re-render when user pauses typing OR when they finish a sentence (space/punctuation).
    // Or, use a library? No external libs requested.

    // Let's implement full re-segmentation on PASTE (batch).
    // Let's implement sentence segmentation on Typing (Real-time).

    // Actually, replacing just the current sentence is tricky without robust DOM diffing.
    // Simple approach:
    // On Paste: Block UI, segment all, replace all content.
    // On Typing: Wait for debounce, then segment.

    // The requirement "Use ។ to identify the length of the sentence to process" implies we should only look at the current sentence.

    clearTimeout(typingTimer);
    if (e.inputType === 'insertFromPaste') {
        // Paste event handled separately?
        // Actually 'paste' event fires before 'input'. 
        // We can handle 'paste' specifically.
    } else {
        // Save state for undo (debounce?)
        // Ideally we save state BEFORE the input happens? 
        // But `input` is after. 
        // We should save state on `beforeinput` or `keydown`?
        // Or just save snapshots periodically. 
        // Simple: Save snapshot debounced or on space/enter?
        // For now, let's save on debounce with typing? 

        // Actually, for "undo", we want the state *result*.
        // If I type "a", then "undo", I want empty.
        // If I use `historyManager`, I need to push *new* state.

        // Strategy:
        // 1. We are modifying DOM programmatically in `renderResult`. This is where we break history.
        // 2. So we must push to history BEFORE `renderResult` modifies it? 
        // 3. Or push to history on every `input` event?

        // Let's push to history on debounce of input?
        // This might miss some chars.

        // Re-think: "Cannot Ctrl-Z when editing".
        // The programmatic update happens in `renderResult`. 
        // We should save state there.

        typingTimer = setTimeout(() => {
            // Save current state to history before segmentation modifies it
            historyManager.push({
                html: editor.innerHTML,
                caret: getCaretCharacterOffsetWithin(editor),
                words: currentWords
            });

            // Segmentation disabled in edit mode - only enabled in View mode
            performRealTimeSegmentation();
        }, doneTypingInterval);
    }
});

editor.addEventListener('keydown', (e) => {
    // Undo: Ctrl+Z
    // Redo: Ctrl+Y or Ctrl+Shift+Z
    if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z') {
            e.preventDefault();
            if (e.shiftKey) {
                // Redo
                const state = historyManager.redo();
                if (state) restoreState(state);
            } else {
                // Undo
                const state = historyManager.undo();
                if (state) restoreState(state);
            }
        } else if (e.key === 'y') {
            e.preventDefault();
            // Redo
            const state = historyManager.redo();
            if (state) restoreState(state);
        }
    }
});

function restoreState(state) {
    // Restore HTML
    editor.innerHTML = state.html;
    // Restore Words (for stats/nav)
    currentWords = state.words || [];

    // Restore Caret and Focus synchronously
    setCaretPosition(editor, state.caret);

    // Ensure focus after setting caret
    // Use requestAnimationFrame to ensure it happens after browser processes the caret change
    requestAnimationFrame(() => {
        editor.focus();
    });

    // Update Stats
    updateStats(currentWords);
    updateUnknownNavigation();
}

editor.addEventListener('paste', (e) => {
    // Let browser handle paste naturally in edit mode
    // e.preventDefault();
    const pastedText = (e.clipboardData || window.clipboardData).getData('text');

    // Get current text and cursor position
    const currentText = editor.innerText;
    const caretOffset = getCaretCharacterOffsetWithin(editor);

    // Build combined text: before cursor + pasted text + after cursor
    // This handles both: pasting into middle of text, and pasting when there's a selection
    // (getCaretCharacterOffsetWithin returns end of selection if text is selected)

    // We need to handle selection properly
    const selection = window.getSelection();
    let insertPosition = caretOffset;
    let deleteLength = 0;

    if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        if (!range.collapsed) {
            // There's a selection - we need to replace it
            const preCaretRange = range.cloneRange();
            preCaretRange.selectNodeContents(editor);
            preCaretRange.setEnd(range.startContainer, range.startOffset);
            insertPosition = preCaretRange.toString().length;
            deleteLength = range.toString().length;
        }
    }

    // Build the new combined text
    const beforeCursor = currentText.substring(0, insertPosition);
    const afterCursor = currentText.substring(insertPosition + deleteLength);
    const newText = beforeCursor + pastedText + afterCursor;

    // Calculate where cursor should be after paste (at end of pasted text)
    const targetCaretPosition = insertPosition + pastedText.length;

    // Process the combined text and pass the target caret position
    handlePaste(newText, false, true, targetCaretPosition); // silent=false, fromPaste=true, targetCaret
});

async function handlePaste(text, silent = false, fromPaste = false, targetCaretPosition = null) {
    if (!silent) {
        statusIndicator.textContent = "កំពុងដំណើរការ...";
        statusIndicator.classList.add("processing");
    }
    // editor.innerHTML = ""; // Don't clear! renderResult replaces.

    const lines = text.split('\n');
    // Distribute lines to workers

    const chunkSize = Math.ceil(lines.length / workerCount);
    const promises = [];

    for (let i = 0; i < workerCount; i++) {
        const chunk = lines.slice(i * chunkSize, (i + 1) * chunkSize);
        // Even empty chunks should be processed to keep order? 
        // Logic below handles promises.
        if (chunk.length === 0) continue;

        const chunkText = chunk.join('\n');

        promises.push(new Promise(resolve => {
            const id = activeRequestId++;
            const worker = workers[i];

            const handler = (e) => {
                if (e.data.id === id) {
                    worker.removeEventListener('message', handler);
                    resolve(e.data.result);
                }
            };

            pendingRequests.set(id, resolve);
            worker.postMessage({ type: 'segment', text: chunkText, id });
        }));
    }

    const results = await Promise.all(promises);
    // results is array of arrays of word-objects

    // Merge
    const allWords = results.flat();

    // Check if the content has changed since we started processing
    // BUT: Skip this check for paste operations, because the text isn't in the editor yet
    // (we prevented default paste, so editor.innerText is old content, not the pasted text)
    if (!fromPaste && editor.innerText !== text) {
        console.log("Content changed during segmentation, skipping render.");
        // Ensure we reset status even if skipping!
        if (!silent) {
            statusIndicator.textContent = "រួចរាល់";
            statusIndicator.classList.remove("processing");
        }
        return;
    }

    renderResult(allWords, false, targetCaretPosition);

    if (!silent) {
        statusIndicator.textContent = "រួចរាល់";
        statusIndicator.classList.remove("processing");
    }

    // If this was a paste operation, save the result to history
    // This creates a checkpoint so typing after paste can be undone separately
    if (fromPaste) {
        historyManager.push({
            html: editor.innerHTML,
            caret: targetCaretPosition !== null ? targetCaretPosition : getCaretCharacterOffsetWithin(editor),
            words: allWords
        });
    }
}

/* 
   Pending Request Map
   ID -> Resolve Function
*/
const pendingRequests = new Map();

function handleWorkerResult(id, result) {
    if (pendingRequests.has(id)) {
        const resolve = pendingRequests.get(id);
        pendingRequests.delete(id);
        resolve(result);
    }
}

const modeToggle = document.getElementById('mode-toggle');

// Toggle Mode
modeToggle.addEventListener('change', (e) => {
    isViewMode = e.target.checked;

    if (isViewMode) {
        editor.contentEditable = "false";
        editor.contentEditable = "false";
        editor.classList.add("view-mode");
        // Ensure we segment fresh content when entering view mode
        performRealTimeSegmentation();
    } else {
        editor.contentEditable = "true";
        editor.classList.remove("view-mode");
    }

    // Re-render with new style
    renderResult(currentWords, true); // Force update
});

// Force reset to Editable Mode on load (User Request)
modeToggle.checked = false;
isViewMode = false;
editor.contentEditable = "true";
editor.classList.remove("view-mode");

function renderResult(words, force = false, targetCaretPosition = null) {
    currentWords = words; // Update cache

    // Convert words to HTML spans
    const html = words.map(w => {
        // Handle newlines - strictly check for newline characters
        if (/^[\r\n]+$/.test(w.word)) return '<br>';

        let spanClass = '';
        // Only mark as unknown if it has non-whitespace content
        const isUnknown = w.isUnknown && w.word.trim().length > 0;

        if (isViewMode) {
            spanClass = 'segment-box';
            if (isUnknown) spanClass += ' unknown-box';
        } else {
            if (isUnknown) spanClass = 'unknown-word';
        }

        if (spanClass) {
            return `<span class="${spanClass}">${escapeHtml(w.word)}</span>`;
        } else {
            return `<span>${escapeHtml(w.word)}</span>`;
        }
    }).join('');

    // Only update if changed or forced
    if (editor.innerHTML !== html || force) {
        // If switching to View Mode, we don't need to save caret (not editable)
        // If switching to Edit Mode, we place caret at end or try to restore?

        if (!isViewMode && !force) {
            // If we have a target caret position (from paste), use it
            // Otherwise, save and restore current position
            const savedCaret = targetCaretPosition !== null ? targetCaretPosition : getCaretCharacterOffsetWithin(editor);

            // Fix for placeholder: contenteditable often has a phantom <br> or \n when "empty".
            // If the result is a single <br>, clear it to "" so CSS :empty works.
            // Note: If user types "Enter", we usually get multiple newlines or diff structure, so this shouldn't prevent typing newlines.
            if (html === '<br>') {
                editor.innerHTML = '';
            } else {
                editor.innerHTML = html;
            }

            setCaretPosition(editor, savedCaret);

            // Don't push to history here - we push before segmentation in the input handler
            // This prevents creating history entries when segmentation completes after user has already undone
        } else {
            if (html === '<br>') {
                editor.innerHTML = '';
            } else {
                editor.innerHTML = html;
            }
            if (!isViewMode) {
                placeCaretAtEnd(editor);
            }
        }
    }

    updateStats(words);
    updateUnknownNavigation();
}

// Unknown Word Navigation
const btnPrevUnknown = document.getElementById('btn-prev-unknown');
const btnNextUnknown = document.getElementById('btn-next-unknown');
const navControls = document.getElementById('nav-controls');
const navStatus = document.getElementById('nav-status');

let currentUnknownIndex = -1;
let unknownElements = [];

function updateUnknownNavigation() {
    // Find all unknown elements
    unknownElements = Array.from(editor.querySelectorAll('.unknown-word, .unknown-box'));

    if (unknownElements.length > 0) {
        navControls.style.visibility = 'visible';
        navControls.style.opacity = '1';
        btnPrevUnknown.disabled = false;
        btnNextUnknown.disabled = false;

        // Reset index if out of bounds or invalid
        if (currentUnknownIndex >= unknownElements.length || currentUnknownIndex < 0) {
            currentUnknownIndex = -1;
            navStatus.textContent = `${0}/${unknownElements.length}`;
        } else {
            // Keep current index, update status
            navStatus.textContent = `${currentUnknownIndex + 1}/${unknownElements.length}`;
            highlightCurrentUnknown();
        }
    } else {
        navControls.style.visibility = 'hidden';
        navControls.style.opacity = '0';
        currentUnknownIndex = -1;
    }
}

function jumpToUnknown(direction) {
    if (unknownElements.length === 0) return;

    if (direction === 'next') {
        currentUnknownIndex++;
        if (currentUnknownIndex >= unknownElements.length) currentUnknownIndex = 0; // Cycle
    } else {
        currentUnknownIndex--;
        if (currentUnknownIndex < 0) currentUnknownIndex = unknownElements.length - 1; // Cycle
    }

    highlightCurrentUnknown();
    navStatus.textContent = `${currentUnknownIndex + 1}/${unknownElements.length}`;
}

function highlightCurrentUnknown() {
    // Remove previous highlights
    unknownElements.forEach(el => el.classList.remove('current-highlight'));

    const el = unknownElements[currentUnknownIndex];
    if (el) {
        el.classList.add('current-highlight');

        // Manual scroll to avoid scrolling the whole page (browser window)
        const editorHeight = editor.clientHeight;
        const elTop = el.offsetTop;
        const elHeight = el.offsetHeight;

        editor.scrollTo({
            top: elTop - (editorHeight / 2) + (elHeight / 2),
            behavior: 'smooth'
        });

        // Don't select text in edit mode - it interferes with typing
        // In view mode, selection is fine since editor is not editable
        // Commenting out for now - the CSS highlight is sufficient
        /*
        if (!isViewMode) {
            const range = document.createRange();
            range.selectNodeContents(el);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        }
        */
    }
}

btnPrevUnknown.addEventListener('click', () => jumpToUnknown('prev'));
btnNextUnknown.addEventListener('click', () => jumpToUnknown('next'));

function updateStats(words) {
    const wCount = words.filter(w => w.word.trim().length > 0).length;
    const uCount = words.filter(w => w.isUnknown && w.word.trim().length > 0).length;
    wordCount.textContent = `${wCount} ពាក្យ`;
    unknownCount.textContent = `${uCount} ពាក្យមិនស្គាល់`;

    if (uCount > 0) {
        unknownCount.style.color = 'var(--danger)';
    } else {
        unknownCount.style.color = 'var(--text-secondary)';
    }
}

function escapeHtml(text) {
    return text.replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function getCaretCharacterOffsetWithin(element) {
    let caretOffset = 0;
    const doc = element.ownerDocument || element.document;
    const win = doc.defaultView || doc.parentWindow;
    const sel = win.getSelection();

    if (sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const preCaretRange = range.cloneRange();
        preCaretRange.selectNodeContents(element);
        preCaretRange.setEnd(range.endContainer, range.endOffset);
        caretOffset = preCaretRange.toString().length;
    }
    return caretOffset;
}

function setCaretPosition(element, offset) {
    const createRange = (node, chars, range) => {
        if (!range) {
            range = document.createRange();
            range.selectNode(node);
            range.setStart(node, 0);
        }

        if (chars.count === 0) {
            range.setEnd(node, chars.count);
        }

        if (node && chars.count > 0) {
            if (node.nodeType === Node.TEXT_NODE) {
                if (node.textContent.length < chars.count) {
                    chars.count -= node.textContent.length;
                } else {
                    range.setEnd(node, chars.count);
                    chars.count = 0;
                }
            } else {
                for (let lp = 0; lp < node.childNodes.length; lp++) {
                    range = createRange(node.childNodes[lp], chars, range);
                    if (chars.count === 0) {
                        break;
                    }
                }
            }
        }
        return range;
    };

    if (offset >= 0) {
        const selection = window.getSelection();
        const range = createRange(element, { count: offset });
        if (range) {
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);
        }
    }
}


// Real-time Segmentation
async function performRealTimeSegmentation() {
    // Real-time: use single worker only, NOT batch mode (which uses 4 workers)
    const fullText = editor.innerText;

    // Use a single worker for lighter processing
    const worker = getNextWorker();
    const id = activeRequestId++;

    const result = await new Promise(resolve => {
        pendingRequests.set(id, resolve);
        worker.postMessage({ type: 'segment', text: fullText, id });
    });

    // Check if content changed during segmentation (stale check)
    if (editor.innerText !== fullText) {
        return; // Skip render if user kept typing
    }

    renderResult(result);
}


// Download
btnDownload.addEventListener('click', () => {
    const text = editor.innerText; // Plain text
    // Or do they want the segmented result? 
    // "segmentation results as text" -> Usually delimited? 
    // Let's assume pipe delimited | or just spaces (Khmer uses space for separation in segmentation output usually).
    // Or just zero-width space?
    // Let's ask segmenter output.
    // The segmenter adds NO delimiters by default, it just returns array.
    // "Download segmentation results" -> user probably wants explicit visibility, e.g. separated by | or space.
    // I will use `|` as separator for visibility.

    // We need to re-segment to get the array if we only have DOM.
    // Actually we have the DOM `span`s.

    const spans = editor.querySelectorAll('span');
    const words = Array.from(spans).map(s => s.textContent);
    const content = words.join('|');

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'segmentation_result.txt';
    a.click();
    URL.revokeObjectURL(url);
});
