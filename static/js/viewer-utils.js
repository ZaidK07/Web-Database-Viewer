/**
 * Shared Utilities for Web Database Viewer (MySQL & SQLite)
 */

window.isInspectable = function(val) {
    if (val === null || val === undefined) return false;
    if (typeof val === 'object') return true;
    const str = String(val).trim();
    if (str.length > 35) return true;
    if ((str.startsWith('{') && str.endsWith('}')) || (str.startsWith('[') && str.endsWith(']'))) return true;
    return false;
};

window.highlightJson = function(jsonStr) {
    if (!jsonStr) return '';
    const escaped = jsonStr
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    return escaped.replace(
        /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
        function(match) {
            let cls = 'text-amber-400';
            if (/^"/.test(match)) {
                if (/:$/.test(match)) {
                    cls = 'text-sky-400 font-semibold';
                } else {
                    cls = 'text-emerald-400';
                }
            } else if (/true|false/.test(match)) {
                cls = 'text-indigo-400 font-bold';
            } else if (/null/.test(match)) {
                cls = 'text-rose-400 italic';
            }
            return '<span class="' + cls + '">' + match + '</span>';
        }
    );
};

window.createInspectorModule = function(Vue, getIsPk, onEdit) {
    const inspectorModal = Vue.ref({
        open: false,
        colField: '',
        rowIndex: -1,
        originalValue: null,
        rawText: '',
        isJson: false,
        viewMode: 'formatted',
        highlightedHtml: '',
        lineCount: 1,
        copied: false
    });

    const isColumnPrimaryKey = function(colField) {
        if (typeof getIsPk === 'function') return getIsPk(colField);
        return false;
    };

    const openInspector = function(val, colField, rowIndex = -1) {
        let raw = '';
        let isJson = false;
        let formatted = '';

        if (val === null || val === undefined) {
            raw = '';
        } else if (typeof val === 'object') {
            isJson = true;
            try {
                raw = JSON.stringify(val);
                formatted = JSON.stringify(val, null, 2);
            } catch (e) {
                raw = String(val);
                formatted = raw;
            }
        } else {
            raw = String(val);
            const trimmed = raw.trim();
            if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
                try {
                    const parsed = JSON.parse(trimmed);
                    isJson = true;
                    formatted = JSON.stringify(parsed, null, 2);
                } catch (e) {
                    isJson = false;
                    formatted = raw;
                }
            } else {
                formatted = raw;
            }
        }

        const displayText = isJson ? formatted : raw;
        const lines = displayText.split('\n').length;

        inspectorModal.value = {
            open: true,
            colField: colField,
            rowIndex: rowIndex,
            originalValue: val,
            rawText: displayText,
            isJson: isJson,
            viewMode: isJson ? 'formatted' : 'raw',
            highlightedHtml: isJson ? window.highlightJson(formatted) : '',
            lineCount: lines,
            copied: false
        };
    };

    const closeInspector = function() {
        inspectorModal.value.open = false;
        inspectorModal.value.copied = false;
    };

    const copyInspectorContent = async function(showToast) {
        try {
            await navigator.clipboard.writeText(inspectorModal.value.rawText);
            inspectorModal.value.copied = true;
            setTimeout(() => {
                inspectorModal.value.copied = false;
            }, 2000);
        } catch (e) {
            if (typeof showToast === 'function') showToast('Failed to copy to clipboard', 'error');
        }
    };

    const editFromInspector = function() {
        const { rowIndex, colField, originalValue } = inspectorModal.value;
        closeInspector();
        if (typeof onEdit === 'function' && rowIndex !== -1 && colField) {
            onEdit(rowIndex, colField, originalValue);
        }
    };

    return {
        inspectorModal,
        isInspectable: window.isInspectable,
        highlightJson: window.highlightJson,
        openInspector,
        closeInspector,
        copyInspectorContent,
        editFromInspector,
        isColumnPrimaryKey
    };
};
