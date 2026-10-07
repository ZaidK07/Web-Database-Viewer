/*
 * SqlEditor — thin wrapper around CodeMirror 5 for the Raw SQL console.
 *
 * Features:
 *  - SQL syntax highlighting per dialect (mysql / postgresql / sqlite)
 *  - Schema-aware autocomplete: tables, views, columns (incl. columns of tables
 *    referenced in the current statement, `alias.` / `table.` completion),
 *    keywords and common functions, ranked by context (after FROM -> tables, etc.)
 *  - Dialect-correct identifier quoting (backticks for MySQL, double quotes otherwise)
 *  - Terminal-style history recall with Up/Down when the editor is empty
 *  - Ctrl/Cmd+Enter to run, Ctrl+Space to suggest, Ctrl/Cmd+/ to toggle comments
 */
(function () {
    'use strict';

    if (!window.CodeMirror) {
        console.warn('SqlEditor: CodeMirror is not loaded');
        return;
    }
    const CM = window.CodeMirror;

    const MIME = {
        mysql: 'text/x-mysql',
        postgresql: 'text/x-pgsql',
        sqlite: 'text/x-sqlite',
    };

    const KEYWORDS = [
        'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'IS NULL', 'IS NOT NULL',
        'LIKE', 'BETWEEN', 'EXISTS', 'AS', 'DISTINCT', 'ALL', 'ANY',
        'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL OUTER JOIN', 'CROSS JOIN', 'ON', 'USING',
        'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET', 'ASC', 'DESC', 'UNION', 'UNION ALL',
        'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
        'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM',
        'CREATE TABLE', 'CREATE INDEX', 'CREATE VIEW', 'ALTER TABLE', 'ADD COLUMN', 'DROP TABLE',
        'DROP COLUMN', 'TRUNCATE TABLE', 'PRIMARY KEY', 'FOREIGN KEY', 'REFERENCES', 'DEFAULT',
        'UNIQUE', 'INDEX', 'CONSTRAINT', 'WITH', 'TRUE', 'FALSE', 'EXPLAIN',
        'BEGIN', 'COMMIT', 'ROLLBACK',
    ];
    const DIALECT_KEYWORDS = {
        mysql: ['SHOW TABLES', 'SHOW DATABASES', 'SHOW COLUMNS FROM', 'DESCRIBE', 'USE', 'AUTO_INCREMENT',
            'INTERVAL', 'REGEXP', 'ON DUPLICATE KEY UPDATE'],
        postgresql: ['ILIKE', 'RETURNING', 'INTERVAL', 'SERIAL', 'ON CONFLICT', 'DO NOTHING', 'NULLS FIRST',
            'NULLS LAST', 'CURRENT_DATE', 'CURRENT_TIMESTAMP'],
        sqlite: ['PRAGMA', 'AUTOINCREMENT', 'GLOB', 'VACUUM', 'CURRENT_DATE', 'CURRENT_TIMESTAMP'],
    };
    const FUNCTIONS = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'NULLIF', 'CAST', 'LOWER', 'UPPER',
        'LENGTH', 'TRIM', 'SUBSTRING', 'REPLACE', 'ROUND', 'ABS', 'CONCAT'];
    const DIALECT_FUNCTIONS = {
        mysql: ['NOW', 'CURDATE', 'DATE', 'DATE_FORMAT', 'DATE_ADD', 'DATE_SUB', 'DATEDIFF', 'IFNULL', 'IF',
            'GROUP_CONCAT', 'YEAR', 'MONTH', 'DAY', 'JSON_EXTRACT', 'CHAR_LENGTH'],
        postgresql: ['NOW', 'DATE_TRUNC', 'EXTRACT', 'TO_CHAR', 'AGE', 'STRING_AGG', 'ARRAY_AGG', 'JSON_AGG',
            'JSONB_AGG', 'GENERATE_SERIES', 'ROW_NUMBER', 'RANK'],
        sqlite: ['DATE', 'DATETIME', 'STRFTIME', 'JULIANDAY', 'IFNULL', 'GROUP_CONCAT', 'JSON_EXTRACT',
            'TYPEOF', 'ROW_NUMBER'],
    };

    // Keywords that decide what kind of identifier is expected next
    const TABLE_CONTEXT = new Set(['FROM', 'JOIN', 'UPDATE', 'INTO', 'TABLE', 'DESCRIBE', 'TRUNCATE']);
    const COLUMN_CONTEXT = new Set(['SELECT', 'WHERE', 'ON', 'BY', 'SET', 'AND', 'OR', 'HAVING', 'DISTINCT',
        'WHEN', 'THEN', 'ELSE', 'CASE', 'NOT', 'USING', 'RETURNING']);
    const CONTEXT_WORDS = new Set([...TABLE_CONTEXT, ...COLUMN_CONTEXT, 'VALUES', 'LIMIT', 'OFFSET', 'AS']);

    // Words that can never be a table alias
    const NON_ALIAS = new Set(['WHERE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'OUTER', 'ON',
        'USING', 'SET', 'GROUP', 'ORDER', 'LIMIT', 'OFFSET', 'HAVING', 'UNION', 'VALUES', 'SELECT', 'AS',
        'NATURAL', 'WINDOW', 'RETURNING', 'DEFAULT', 'FROM']);

    const RESERVED = new Set(['SELECT', 'FROM', 'WHERE', 'ORDER', 'GROUP', 'BY', 'USER', 'TABLE', 'KEY',
        'INDEX', 'LIMIT', 'OFFSET', 'JOIN', 'ON', 'AS', 'AND', 'OR', 'NOT', 'NULL', 'DEFAULT', 'CHECK',
        'COLUMN', 'DESC', 'ASC', 'IN', 'IS', 'LIKE', 'TO', 'UNION', 'UPDATE', 'DELETE', 'INSERT', 'VALUES',
        'SET', 'CREATE', 'DROP', 'ALTER', 'PRIMARY', 'FOREIGN', 'REFERENCES', 'UNIQUE', 'CASE', 'WHEN',
        'THEN', 'ELSE', 'END', 'ALL', 'DISTINCT', 'HAVING', 'INTO', 'GRANT', 'RANGE', 'ROWS', 'LEFT',
        'RIGHT', 'INNER', 'OUTER', 'CROSS', 'NATURAL', 'TRUE', 'FALSE', 'WITH', 'WINDOW']);

    const KIND_BADGE = { table: 'T', view: 'V', column: 'C', keyword: 'K', function: 'ƒ' };

    function levenshtein(a, b) {
        if (!a) return (b || '').length;
        if (!b) return a.length;
        const matrix = [];
        for (let i = 0; i <= b.length; i++) matrix[i] = [i];
        for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }
        return matrix[b.length][a.length];
    }

    function lintSQL(sql, dialect, tables) {
        const diagnostics = [];
        if (!sql || !sql.trim()) return diagnostics;

        const lines = sql.split('\n');

        function posFromIndex(idx) {
            let cur = 0;
            for (let l = 0; l < lines.length; l++) {
                const len = lines[l].length + 1;
                if (cur + len > idx) {
                    return { line: l, ch: Math.max(0, idx - cur) };
                }
                cur += len;
            }
            const lastLine = Math.max(0, lines.length - 1);
            return { line: lastLine, ch: lines[lastLine].length };
        }

        // 1. Empty aggregate & common functions: count(), sum(), avg(), min(), max(), coalesce(), concat()
        const emptyFuncRegex = /\b(COUNT|SUM|AVG|MIN|MAX|COALESCE|NULLIF|CONCAT|GROUP_CONCAT|STRING_AGG)\s*\(\s*\)/gi;
        let match;
        while ((match = emptyFuncRegex.exec(sql)) !== null) {
            const fnName = match[1].toUpperCase();
            const startIdx = match.index;
            const endIdx = startIdx + match[0].length;
            const from = posFromIndex(startIdx);
            const to = posFromIndex(endIdx);

            if (fnName === 'COUNT') {
                const isLower = match[0].startsWith('count');
                const rep = isLower ? 'count(*)' : 'COUNT(*)';
                diagnostics.push({
                    severity: 'error',
                    from,
                    to,
                    message: '`COUNT()` requires an argument (e.g., `COUNT(*)` or `COUNT(column)`)',
                    quickFix: {
                        label: rep,
                        from,
                        to,
                        text: rep,
                    },
                });
            } else if (['SUM', 'AVG', 'MIN', 'MAX'].includes(fnName)) {
                diagnostics.push({
                    severity: 'error',
                    from,
                    to,
                    message: `\`${fnName}()\` requires an expression (e.g., \`${fnName}(column)\`)`,
                });
            } else {
                diagnostics.push({
                    severity: 'error',
                    from,
                    to,
                    message: `\`${fnName}()\` requires arguments`,
                });
            }
        }

        // 2. Trailing commas before SQL keywords or closing parentheses
        const trailingCommaRegex = /,\s*(?=(FROM|WHERE|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|OFFSET|JOIN|INNER\s+JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|SET|VALUES|\)))/gi;
        while ((match = trailingCommaRegex.exec(sql)) !== null) {
            const commaIdx = match.index;
            const from = posFromIndex(commaIdx);
            const to = posFromIndex(commaIdx + match[0].length);
            diagnostics.push({
                severity: 'error',
                from,
                to,
                message: `Unexpected trailing comma before \`${match[1].trim()}\``,
                quickFix: {
                    label: 'Remove comma',
                    from,
                    to,
                    text: ' ',
                },
            });
        }

        // 3. Unclosed quotes
        let inQuote = null;
        let quoteStart = null;
        for (let i = 0; i < sql.length; i++) {
            const c = sql[i];
            if (inQuote) {
                if (c === '\\') {
                    i++;
                } else if (c === inQuote) {
                    if (sql[i + 1] === inQuote) {
                        i++;
                    } else {
                        inQuote = null;
                        quoteStart = null;
                    }
                }
            } else {
                if (c === "'" || c === '"' || (c === '`' && dialect === 'mysql')) {
                    inQuote = c;
                    quoteStart = i;
                }
            }
        }
        if (inQuote !== null && quoteStart !== null) {
            const from = posFromIndex(quoteStart);
            const to = posFromIndex(sql.length);
            diagnostics.push({
                severity: 'error',
                from,
                to,
                message: `Unclosed ${inQuote === "'" ? 'string literal' : 'quote'} (${inQuote})`,
                quickFix: {
                    label: `Close quote (${inQuote})`,
                    from: to,
                    to: to,
                    text: inQuote,
                },
            });
        }

        // 4. Unmatched / unclosed parentheses
        const parenStack = [];
        let inStr = false;
        let strChar = '';
        for (let i = 0; i < sql.length; i++) {
            const c = sql[i];
            if (inStr) {
                if (c === '\\') i++;
                else if (c === strChar) inStr = false;
            } else {
                if (c === "'" || c === '"' || (c === '`' && dialect === 'mysql')) {
                    inStr = true;
                    strChar = c;
                } else if (c === '(') {
                    parenStack.push(i);
                } else if (c === ')') {
                    if (parenStack.length === 0) {
                        const from = posFromIndex(i);
                        const to = posFromIndex(i + 1);
                        diagnostics.push({
                            severity: 'error',
                            from,
                            to,
                            message: 'Unmatched closing parenthesis `)`',
                            quickFix: {
                                label: 'Remove `)`',
                                from,
                                to,
                                text: '',
                            },
                        });
                    } else {
                        parenStack.pop();
                    }
                }
            }
        }
        while (parenStack.length > 0) {
            const openIdx = parenStack.pop();
            const from = posFromIndex(openIdx);
            const to = posFromIndex(openIdx + 1);
            diagnostics.push({
                severity: 'error',
                from,
                to,
                message: 'Unclosed opening parenthesis `(`',
                quickFix: {
                    label: 'Add `)`',
                    from: posFromIndex(sql.length),
                    to: posFromIndex(sql.length),
                    text: ')',
                },
            });
        }

        // 5. Misplaced SQL Clauses (e.g. WHERE after ORDER BY / GROUP BY / LIMIT)
        const clausesToTrack = [
            { name: 'SELECT', rank: 1 },
            { name: 'FROM', rank: 2 },
            { name: 'WHERE', rank: 3 },
            { name: 'GROUP BY', rank: 4 },
            { name: 'HAVING', rank: 5 },
            { name: 'ORDER BY', rank: 6 },
            { name: 'LIMIT', rank: 7 },
        ];
        const tokenRegex = /\b(SELECT|FROM|WHERE|GROUP\s+BY|HAVING|ORDER\s+BY|LIMIT)\b/gi;
        const clausePositions = [];
        let clauseMatch;
        while ((clauseMatch = tokenRegex.exec(sql)) !== null) {
            const idx = clauseMatch.index;
            let openP = 0;
            let inS = false;
            let sc = '';
            for (let j = 0; j < idx; j++) {
                const ch = sql[j];
                if (inS) {
                    if (ch === '\\') j++;
                    else if (ch === sc) inS = false;
                } else {
                    if (ch === "'" || ch === '"' || ch === '`') { inS = true; sc = ch; }
                    else if (ch === '(') openP++;
                    else if (ch === ')') openP--;
                }
            }
            if (openP === 0 && !inS) {
                const matchedName = clauseMatch[0].replace(/\s+/g, ' ').toUpperCase();
                const tracked = clausesToTrack.find((c) => c.name === matchedName);
                if (tracked) {
                    clausePositions.push({ ...tracked, index: idx, length: clauseMatch[0].length });
                }
            }
        }
        for (let i = 1; i < clausePositions.length; i++) {
            const prev = clausePositions[i - 1];
            const curr = clausePositions[i];
            if (curr.rank < prev.rank) {
                const from = posFromIndex(curr.index);
                const to = posFromIndex(curr.index + curr.length);
                diagnostics.push({
                    severity: 'error',
                    from,
                    to,
                    message: `\`${curr.name}\` cannot follow \`${prev.name}\` in standard SQL clause order`,
                });
            }
        }

        // 6. Schema-Aware Diagnostics: Unknown tables & closest match suggestion
        if (tables && Object.keys(tables).length > 0) {
            const knownTableNames = Object.keys(tables);
            const tableRefRegex = /\b(FROM|JOIN|UPDATE|INTO)\s+([`"\[]?([a-zA-Z0-9_$]+)[`"\]]?)/gi;
            let tMatch;
            while ((tMatch = tableRefRegex.exec(sql)) !== null) {
                const rawTable = tMatch[3];
                const lowerTable = rawTable.toLowerCase();
                if (['select', 'dual', 'where', 'set', 'values'].includes(lowerTable)) continue;

                if (!tables[lowerTable]) {
                    const tableStartIdx = tMatch.index + tMatch[0].lastIndexOf(rawTable);
                    const from = posFromIndex(tableStartIdx);
                    const to = posFromIndex(tableStartIdx + rawTable.length);

                    let bestMatch = null;
                    let bestScore = 999;
                    for (const known of knownTableNames) {
                        const origName = tables[known].name;
                        if (known.includes(lowerTable) || lowerTable.includes(known)) {
                            bestMatch = origName;
                            break;
                        }
                        const dist = levenshtein(lowerTable, known);
                        if (dist < bestScore && dist <= 3) {
                            bestScore = dist;
                            bestMatch = origName;
                        }
                    }

                    if (bestMatch) {
                        diagnostics.push({
                            severity: 'warning',
                            from,
                            to,
                            message: `Table "${rawTable}" not found in schema. Did you mean "${bestMatch}"?`,
                            quickFix: {
                                label: bestMatch,
                                from,
                                to,
                                text: bestMatch,
                            },
                        });
                    } else {
                        diagnostics.push({
                            severity: 'warning',
                            from,
                            to,
                            message: `Table "${rawTable}" does not exist in the active database schema`,
                        });
                    }
                }
            }
        }

        // 7. Safety Warning for DELETE / UPDATE without WHERE
        if (/^\s*DELETE\s+FROM\b/i.test(sql) && !/\bWHERE\b/i.test(sql)) {
            diagnostics.push({
                severity: 'warning',
                from: { line: 0, ch: 0 },
                to: posFromIndex(Math.min(11, sql.length)),
                message: '⚠️ Missing `WHERE` clause: query will delete ALL rows in the table',
            });
        } else if (/^\s*UPDATE\b/i.test(sql) && !/\bWHERE\b/i.test(sql)) {
            diagnostics.push({
                severity: 'warning',
                from: { line: 0, ch: 0 },
                to: posFromIndex(Math.min(6, sql.length)),
                message: '⚠️ Missing `WHERE` clause: query will update ALL rows in the table',
            });
        }

        return diagnostics;
    }

    function create(host, opts) {
        opts = opts || {};
        let dialect = MIME[opts.dialect] ? opts.dialect : 'mysql';
        let tables = {};          // lowerName -> { name, kind, columns: [{name, type, pk, fk}] }
        let defaultTable = null;  // name of the table currently open in the UI
        let history = [];         // queries, newest first
        let histIdx = -1;
        let histDraft = '';
        let applying = false;
        let activeMarkers = [];
        let activeErrorLines = [];
        let lintTimer = null;
        let currentDiagnostics = [];
        let activeLine = null;

        const cm = CM(host, {
            value: opts.value || '',
            mode: MIME[dialect],
            lineNumbers: true,
            gutters: ['CodeMirror-linenumbers'],
            lineWrapping: true,
            indentWithTabs: false,
            tabSize: 2,
            indentUnit: 2,
            smartIndent: true,
            matchBrackets: true,
            autoCloseBrackets: true,
            placeholder: opts.placeholder || '',
            extraKeys: {
                'Ctrl-Enter': () => opts.onRun && opts.onRun(),
                'Cmd-Enter': () => opts.onRun && opts.onRun(),
                'Ctrl-Space': () => showHint(true),
                'Tab': (ed) => {
                    if (ed.somethingSelected()) ed.indentSelection('add');
                    else ed.replaceSelection('  ', 'end');
                },
                'Shift-Tab': (ed) => ed.indentSelection('subtract'),
                'Cmd-/': toggleComment,
                'Ctrl-/': toggleComment,
                'Up': (ed) => historyStep(ed, 1),
                'Down': (ed) => historyStep(ed, -1),
            },
        });
        cm.setSize('100%', '100%');

        function updateActiveLine() {
            const cur = cm.getCursor().line;
            if (activeLine !== cur) {
                if (activeLine !== null && activeLine < cm.lineCount()) {
                    cm.removeLineClass(activeLine, 'background', 'CodeMirror-activeline-background');
                    cm.removeLineClass(activeLine, 'gutter', 'CodeMirror-activeline-gutter');
                }
                activeLine = cur;
                if (activeLine < cm.lineCount()) {
                    cm.addLineClass(activeLine, 'background', 'CodeMirror-activeline-background');
                    cm.addLineClass(activeLine, 'gutter', 'CodeMirror-activeline-gutter');
                }
            }
        }
        cm.on('cursorActivity', updateActiveLine);
        updateActiveLine();

        cm.on('change', (ed) => {
            if (!applying) histIdx = -1;
            if (opts.onChange) opts.onChange(ed.getValue());
            runLinter();
        });

        cm.on('inputRead', (ed, change) => {
            if (ed.state.completionActive) return;
            const typed = (change.text || []).join('');
            if (!/[A-Za-z_.`"]$/.test(typed)) return;
            const tok = ed.getTokenAt(ed.getCursor());
            if (tok.type && /string|comment/.test(tok.type) && !/^[`"]/.test(tok.string)) return;
            showHint(false);
        });

        // ---------- Linter & Real-time Diagnostics ----------
        function runLinter() {
            clearTimeout(lintTimer);
            lintTimer = setTimeout(() => {
                activeMarkers.forEach((m) => m.clear());
                activeMarkers = [];
                activeErrorLines.forEach((l) => {
                    if (l < cm.lineCount()) {
                        cm.removeLineClass(l, 'gutter', 'wdv-line-error-gutter');
                        cm.removeLineClass(l, 'gutter', 'wdv-line-warning-gutter');
                        cm.removeLineClass(l, 'background', 'wdv-line-error-bg');
                        cm.removeLineClass(l, 'background', 'wdv-line-warning-bg');
                    }
                });
                activeErrorLines = [];

                const text = cm.getValue();
                currentDiagnostics = lintSQL(text, dialect, tables);

                const lineErrors = {};

                currentDiagnostics.forEach((d) => {
                    const mark = cm.markText(d.from, d.to, {
                        className: d.severity === 'error' ? 'wdv-lint-error' : 'wdv-lint-warning',
                        title: d.message,
                    });
                    activeMarkers.push(mark);

                    const line = d.from.line;
                    if (!lineErrors[line] || d.severity === 'error') {
                        lineErrors[line] = d.severity;
                    }
                });

                Object.entries(lineErrors).forEach(([lineStr, severity]) => {
                    const line = parseInt(lineStr, 10);
                    if (line < cm.lineCount()) {
                        cm.addLineClass(line, 'gutter', severity === 'error' ? 'wdv-line-error-gutter' : 'wdv-line-warning-gutter');
                        cm.addLineClass(line, 'background', severity === 'error' ? 'wdv-line-error-bg' : 'wdv-line-warning-bg');
                        activeErrorLines.push(line);
                    }
                });

                if (opts.onDiagnostics) {
                    opts.onDiagnostics(currentDiagnostics);
                }
            }, 100);
        }

        // ---------- History (terminal-style) ----------
        function historyStep(ed, dir) {
            if (ed.state.completionActive) return CM.Pass;
            const browsing = histIdx >= 0;
            if (!browsing && (dir < 0 || ed.getValue().trim() !== '' || !history.length)) return CM.Pass;
            const next = histIdx + dir;
            if (next >= history.length) return; // oldest reached: swallow key
            if (!browsing) histDraft = ed.getValue();
            histIdx = next;
            applying = true;
            ed.setValue(histIdx === -1 ? histDraft : history[histIdx]);
            applying = false;
            ed.setCursor(ed.lineCount(), 0);
        }

        function toggleComment(ed) {
            const ranges = ed.listSelections();
            ed.operation(() => {
                ranges.forEach((r) => {
                    const from = Math.min(r.anchor.line, r.head.line);
                    const to = Math.max(r.anchor.line, r.head.line);
                    let allCommented = true;
                    for (let l = from; l <= to; l++) {
                        const text = ed.getLine(l);
                        if (text.trim() && !/^\s*--/.test(text)) allCommented = false;
                    }
                    for (let l = from; l <= to; l++) {
                        const text = ed.getLine(l);
                        if (allCommented) {
                            const m = /^(\s*)-- ?/.exec(text);
                            if (m) ed.replaceRange(m[1], CM.Pos(l, 0), CM.Pos(l, m[0].length));
                        } else if (text.trim()) {
                            const indent = /^\s*/.exec(text)[0].length;
                            ed.replaceRange('-- ', CM.Pos(l, indent));
                        }
                    }
                });
            });
        }

        // ---------- Completion ----------
        function quoteChar() { return dialect === 'mysql' ? '`' : '"'; }

        function needsQuote(name) {
            const plain = dialect === 'postgresql' ? /^[a-z_][a-z0-9_$]*$/ : /^[A-Za-z_][A-Za-z0-9_$]*$/;
            return !plain.test(name) || RESERVED.has(name.toUpperCase());
        }

        function quoteIdent(name, force) {
            const q = quoteChar();
            if (!force && !needsQuote(name)) return name;
            return q + name.split(q).join(q + q) + q;
        }

        function stripQuotes(str) {
            if (!str) return '';
            return str.replace(/^[`"\[]|[`"\]]$/g, '');
        }

        function lookupTable(rawName) {
            const name = stripQuotes(rawName);
            const last = name.includes('.') ? name.split('.').pop() : name;
            return tables[name.toLowerCase()] || tables[stripQuotes(last).toLowerCase()] || null;
        }

        // Statement around the cursor (split on ';')
        function currentStatement(ed) {
            const text = ed.getValue();
            const idx = ed.indexFromPos(ed.getCursor());
            const start = text.lastIndexOf(';', idx - 1) + 1;
            let end = text.indexOf(';', idx);
            if (end === -1) end = text.length;
            return { text: text.slice(start, end), before: text.slice(start, idx) };
        }

        // Tables referenced in a statement + alias map
        function referencedTables(sql) {
            const refs = [];
            const aliases = {};
            const add = (rawTable, rawAlias) => {
                const t = lookupTable(rawTable);
                if (!t) return;
                if (!refs.includes(t)) refs.push(t);
                if (rawAlias && !NON_ALIAS.has(rawAlias.toUpperCase())) aliases[rawAlias.toLowerCase()] = t;
            };
            const ident = '([`"\\[]?[\\w$]+[`"\\]]?(?:\\.[`"\\[]?[\\w$]+[`"\\]]?)?)';
            const re = new RegExp('\\b(?:FROM|JOIN|UPDATE|INTO|TABLE)\\s+' + ident + '(?:\\s+(?:AS\\s+)?([A-Za-z_][\\w$]*))?', 'gi');
            let m;
            while ((m = re.exec(sql))) add(m[1], m[2]);
            // Comma-separated FROM lists: FROM a x, b y
            const fromList = /\bFROM\s+([\s\S]*?)(?=\b(?:WHERE|GROUP|ORDER|LIMIT|HAVING|JOIN|INNER|LEFT|RIGHT|FULL|CROSS|UNION|WINDOW)\b|$)/gi;
            while ((m = fromList.exec(sql))) {
                m[1].split(',').slice(1).forEach((part) => {
                    const bits = part.trim().split(/\s+/).filter((b) => b.toUpperCase() !== 'AS');
                    if (bits[0]) add(bits[0], bits[1]);
                });
            }
            return { refs, aliases };
        }

        function lastContextWord(before) {
            const words = before.toUpperCase().match(/[A-Z_]+/g) || [];
            for (let i = words.length - 1; i >= 0; i--) {
                if (CONTEXT_WORDS.has(words[i])) return words[i];
            }
            return null;
        }

        function matchScore(label, prefix) {
            if (!prefix) return 1;
            const l = label.toLowerCase();
            const p = prefix.toLowerCase();
            if (l.startsWith(p)) return 1000 - Math.min(label.length, 200);
            if (p.length >= 2 && l.includes(p)) return 500 - Math.min(label.length, 200);
            return 0;
        }

        function columnItem(col, table, force) {
            return {
                text: quoteIdent(col.name, force),
                label: col.name,
                kind: 'column',
                detail: (col.pk ? 'pk · ' : '') + (col.type ? col.type.toLowerCase() : '') + (table ? ' · ' + table.name : ''),
            };
        }

        function tableItem(t, force) {
            return {
                text: quoteIdent(t.name, force),
                label: t.name,
                kind: t.kind,
                detail: t.columns.length + ' col' + (t.columns.length === 1 ? '' : 's'),
            };
        }

        function keywordItems(prefix) {
            const lower = prefix && prefix === prefix.toLowerCase() && /[a-z]/.test(prefix);
            const kws = KEYWORDS.concat(DIALECT_KEYWORDS[dialect] || []);
            const fns = FUNCTIONS.concat(DIALECT_FUNCTIONS[dialect] || []);
            return {
                keywords: kws.map((k) => ({ text: lower ? k.toLowerCase() : k, label: k, kind: 'keyword', detail: '' })),
                functions: fns.map((f) => ({
                    text: (lower ? f.toLowerCase() : f) + '()',
                    label: f + '()',
                    kind: 'function',
                    detail: 'function',
                    hint: (ed, data, completion) => {
                        ed.replaceRange(completion.text, data.from, data.to, 'complete');
                        const c = ed.getCursor();
                        ed.setCursor(CM.Pos(c.line, c.ch - 1));
                    },
                })),
            };
        }

        function render(el, self, data) {
            el.classList.add('wdv-hint', 'wdv-hint-' + data.kind);
            const badge = document.createElement('span');
            badge.className = 'wdv-hint-badge';
            badge.textContent = KIND_BADGE[data.kind] || '·';
            const label = document.createElement('span');
            label.className = 'wdv-hint-label';
            label.textContent = data.label;
            el.appendChild(badge);
            el.appendChild(label);
            if (data.detail) {
                const detail = document.createElement('span');
                detail.className = 'wdv-hint-detail';
                detail.textContent = data.detail;
                el.appendChild(detail);
            }
        }

        function hint(ed) {
            const cur = ed.getCursor();
            const lineBefore = ed.getLine(cur.line).slice(0, cur.ch);
            const tok = ed.getTokenAt(cur);
            if (tok.type && /comment/.test(tok.type)) return null;
            if (tok.type && /string/.test(tok.type) && !/^[`"]/.test(tok.string)) return null;

            const stmt = currentStatement(ed);
            const { refs, aliases } = referencedTables(stmt.text);
            const items = [];

            // `qualifier.prefix` -> columns of that table / alias
            const qual = /([`"]?)([\w$]+)\1\.([`"]?)([\w$]*)$/.exec(lineBefore);
            if (qual) {
                const forced = !!qual[3];
                const prefix = qual[4];
                const table = aliases[qual[2].toLowerCase()] || lookupTable(qual[2]);
                if (!table) return null;
                table.columns.forEach((c) => {
                    const score = matchScore(c.name, prefix);
                    if (score) items.push(Object.assign(columnItem(c, null, forced), { score }));
                });
                return finish(items, CM.Pos(cur.line, cur.ch - prefix.length - qual[3].length), cur);
            }

            const wordMatch = /([`"]?)([\w$]*)$/.exec(lineBefore);
            const forced = !!wordMatch[1];
            const prefix = wordMatch[2];
            const from = CM.Pos(cur.line, cur.ch - wordMatch[0].length);
            const ctxWord = lastContextWord(stmt.before.slice(0, stmt.before.length - wordMatch[0].length));
            const ctx = TABLE_CONTEXT.has(ctxWord) ? 'table' : (COLUMN_CONTEXT.has(ctxWord) ? 'column' : 'start');

            const weights = {
                table: { table: 300, column: 80, keyword: 60, function: 0 },
                column: { table: 100, column: 300, keyword: 150, function: 200 },
                start: { table: 150, column: 120, keyword: 300, function: 50 },
            }[ctx];

            const push = (item) => {
                const s = matchScore(item.label, prefix);
                if (!s) return;
                item.score = s + (weights[item.kind === 'view' ? 'table' : item.kind] || 0);
                items.push(item);
            };

            Object.values(tables).forEach((t) => push(tableItem(t, forced)));

            // Columns: from referenced tables, else the open table, else (with a prefix) everything
            let colTables = refs.slice();
            if (!colTables.length && defaultTable && lookupTable(defaultTable)) colTables = [lookupTable(defaultTable)];
            if (!colTables.length && prefix) colTables = Object.values(tables);
            const seen = new Set();
            colTables.forEach((t) => t.columns.forEach((c) => {
                const key = c.name.toLowerCase() + '|' + (colTables.length > 1 ? t.name : '');
                if (seen.has(key)) return;
                seen.add(key);
                push(columnItem(c, colTables.length > 1 ? t : null, forced));
            }));

            if (!forced) {
                const { keywords, functions } = keywordItems(prefix);
                keywords.forEach(push);
                functions.forEach(push);
            }

            // Don't pop up just to repeat exactly what was typed
            if (items.length === 1 && items[0].label.toLowerCase() === prefix.toLowerCase()) return null;
            return finish(items, from, cur);
        }

        function finish(items, from, to) {
            items.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
            const list = items.slice(0, 60).map((i) => Object.assign(i, { displayText: i.label, render }));
            if (!list.length) return null;
            return { list, from, to };
        }

        function showHint(manual) {
            cm.showHint({
                hint,
                completeSingle: false,
                closeCharacters: /[\s()\[\]{};:>,=]/,
                alignWithWord: true,
                closeOnUnfocus: true,
            });
        }

        function applyQuickFix(fix) {
            if (!fix || !fix.from || !fix.to) return;
            cm.replaceRange(fix.text !== undefined ? fix.text : '', fix.from, fix.to);
            cm.focus();
            runLinter();
        }

        // ---------- Public API ----------
        return {
            cm,
            getValue: () => cm.getValue(),
            getSelection: () => cm.getSelection(),
            setValue(value) {
                value = value || '';
                if (cm.getValue() === value) return;
                histIdx = -1;
                cm.setValue(value);
                cm.setCursor(cm.lineCount(), 0);
                runLinter();
            },
            setDialect(next) {
                if (!MIME[next] || next === dialect) return;
                dialect = next;
                cm.setOption('mode', MIME[dialect]);
                runLinter();
            },
            setSchema(schema, views) {
                const viewSet = new Set(views || []);
                const next = {};
                Object.entries(schema || {}).forEach(([name, info]) => {
                    const pks = new Set((info && info.primary_keys) || []);
                    const fks = (info && info.foreign_keys) || {};
                    next[name.toLowerCase()] = {
                        name,
                        kind: viewSet.has(name) ? 'view' : 'table',
                        columns: ((info && info.columns) || []).map((c) => ({
                            name: c.Field,
                            type: c.Type || '',
                            pk: pks.has(c.Field) || c.Key === 'PRI',
                            fk: fks[c.Field] || null,
                        })),
                    };
                });
                tables = next;
                runLinter();
            },
            setDefaultTable(name) {
                defaultTable = name || null;
                runLinter();
            },
            setHistory(queries) {
                history = (queries || []).filter((q, i, arr) => q && arr.indexOf(q) === i);
                histIdx = -1;
            },
            getDiagnostics: () => currentDiagnostics,
            applyQuickFix,
            runLinter,
            refresh: () => cm.refresh(),
            focus: () => cm.focus(),
        };
    }

    window.SqlEditor = { create, lintSQL, levenshtein };
})();
