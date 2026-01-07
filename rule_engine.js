export class RuleBasedEngine {
    constructor(checkInvalidSingleFunc, isSeparatorFunc, rulesData) {
        this.checkInvalidSingle = checkInvalidSingleFunc;
        this.isSeparator = isSeparatorFunc;
        this.rules = this._compileRules(rulesData);
    }

    _compileRules(rules) {
        try {
            // Sort by priority desc
            rules.sort((a, b) => (b.priority || 0) - (a.priority || 0));

            const compiledRules = [];
            for (const rule of rules) {
                const trigger = rule.trigger;
                if (trigger.type === "regex") {
                    try {
                        let pattern = trigger.value;
                        if (!pattern.startsWith('^')) {
                            pattern = '^' + pattern;
                        }
                        trigger.regexObj = new RegExp(pattern);
                    } catch (e) {
                        console.error(`Error compiling trigger regex for rule '${rule.name}': ${e}`);
                        continue;
                    }
                }
                compiledRules.push(rule);
            }
            return compiledRules;

        } catch (e) {
            console.error(`Error loading rules: ${e}`);
            return [];
        }
    }

    applyRules(segments) {
        let i = 0;
        while (i < segments.length) {
            const seg = segments[i];
            let ruleApplied = false;

            for (const rule of this.rules) {
                // 1. Check Trigger
                const trigger = rule.trigger;
                const tType = trigger.type;
                let match = false;

                if (tType === "exact_match") {
                    if (seg === trigger.value) {
                        match = true;
                    }
                } else if (tType === "regex") {
                    if (trigger.regexObj && trigger.regexObj.test(seg)) {
                        match = true;
                    }
                } else if (tType === "complexity_check") {
                    if (trigger.value === "is_invalid_single") {
                        if (this.checkInvalidSingle(seg)) {
                            match = true;
                        }
                    }
                }

                if (!match) continue;

                // 2. Check Conditions
                let conditionsMet = true;
                const checks = rule.checks || [];

                if (checks.length > 0) {
                    for (const check of checks) {
                        const target = check.target;
                        let targetSeg = null;

                        // Resolve target
                        if (target === "prev") {
                            if (i > 0) targetSeg = segments[i - 1];
                        } else if (target === "next") {
                            if (i + 1 < segments.length) targetSeg = segments[i + 1];
                        } else if (target === "context" || target === "current") {
                            targetSeg = segments[i];
                        }

                        // Check existence
                        const mustExist = check.exists || false;
                        if (mustExist && targetSeg === null) {
                            conditionsMet = false;
                            break;
                        }

                        if (targetSeg === null) {
                            if (check.check || check.value) {
                                conditionsMet = false;
                                break;
                            }
                            continue;
                        }

                        // Value checks
                        const cType = check.check;
                        const expected = check.value;

                        if (cType === "is_separator") {
                            if (this.isSeparator(targetSeg) !== expected) {
                                conditionsMet = false;
                                break;
                            }
                        } else if (cType === "is_isolated") {
                            let prevSep = true;
                            if (i > 0) prevSep = this.isSeparator(segments[i - 1]);

                            let nextSep = true;
                            if (i + 1 < segments.length) nextSep = this.isSeparator(segments[i + 1]);

                            const isIso = prevSep && nextSep;
                            if (isIso !== expected) {
                                conditionsMet = false;
                                break;
                            }
                        }
                    }

                    if (!conditionsMet) continue;
                }

                // 3. Apply Action
                const action = rule.action;
                if (action === "merge_next") {
                    if (i + 1 < segments.length) {
                        segments[i] = seg + segments[i + 1];
                        segments.splice(i + 1, 1);
                        ruleApplied = true;
                        break; // Break rule loop, restart at SAME index 'i'
                    }
                } else if (action === "merge_prev") {
                    if (i > 0) {
                        segments[i - 1] = segments[i - 1] + seg;
                        segments.splice(i, 1);
                        i--; // Shift back to re-evaluate merged content at i-1
                        ruleApplied = true;
                        break;
                    }
                } else if (action === "keep") {
                    i++;
                    ruleApplied = true;
                    break; // Break rule loop, move to next
                }
            }

            if (!ruleApplied) {
                i++;
            }
        }
        return segments;
    }
}
