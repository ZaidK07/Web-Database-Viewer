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

window.createBatchSelectionModule = function(Vue, rowsRef, getPrimaryKeys, onDeleteSuccess, executeDelete) {
    const batchMode = Vue.ref(false);
    const selectedRows = Vue.ref([]);
    const isBatchDeleting = Vue.ref(false);

    const toggleBatchMode = function() {
        batchMode.value = !batchMode.value;
        if (!batchMode.value) {
            selectedRows.value = [];
        }
    };

    const clearSelection = function() {
        selectedRows.value = [];
    };

    const isRowSelected = function(index) {
        return selectedRows.value.includes(index);
    };

    const toggleRowSelection = function(index) {
        const pos = selectedRows.value.indexOf(index);
        if (pos > -1) {
            selectedRows.value.splice(pos, 1);
        } else {
            selectedRows.value.push(index);
        }
    };

    const isAllSelected = Vue.computed(function() {
        const r = rowsRef.value;
        if (!r || r.length === 0) return false;
        return r.every((_, idx) => selectedRows.value.includes(idx));
    });

    const toggleSelectAll = function() {
        const r = rowsRef.value;
        if (!r || r.length === 0) return;
        if (isAllSelected.value) {
            selectedRows.value = [];
        } else {
            selectedRows.value = r.map((_, idx) => idx);
        }
    };

    const deleteSelectedRows = async function(customConfirm, showToast) {
        if (!selectedRows.value.length) return;
        const count = selectedRows.value.length;
        const pks = getPrimaryKeys();

        if (!pks || !pks.length) {
            if (typeof showToast === 'function') {
                showToast('Cannot delete rows: Table has no Primary Key defined.', 'error');
            }
            return;
        }

        let confirmed = true;
        if (typeof customConfirm === 'function') {
            confirmed = await customConfirm(
                'Delete Selected Records',
                `Are you sure you want to permanently delete ${count} selected records? This action cannot be undone.`,
                true
            );
        }

        if (!confirmed) return;

        const currentRows = rowsRef.value;
        const pkList = selectedRows.value.map(idx => {
            const rowData = currentRows[idx];
            const rowPk = {};
            pks.forEach(pk => { rowPk[pk] = rowData[pk]; });
            return rowPk;
        });

        isBatchDeleting.value = true;
        try {
            const res = await executeDelete(pkList);
            if (res && res.error) {
                if (typeof showToast === 'function') showToast(res.error, 'error');
            } else {
                const affected = (res && res.affected_rows !== undefined) ? res.affected_rows : count;
                if (typeof showToast === 'function') {
                    showToast(`Successfully deleted ${affected} records`);
                }
                clearSelection();
                if (typeof onDeleteSuccess === 'function') {
                    onDeleteSuccess();
                }
            }
        } catch (e) {
            if (typeof showToast === 'function') {
                showToast('Error deleting selected rows', 'error');
            }
        } finally {
            isBatchDeleting.value = false;
        }
    };

    return {
        batchMode,
        selectedRows,
        isBatchDeleting,
        toggleBatchMode,
        clearSelection,
        isRowSelected,
        toggleRowSelection,
        isAllSelected,
        toggleSelectAll,
        deleteSelectedRows
    };
};

window.createColumnManagerModule = function(Vue, allColumnsGetter, getStorageKey, isPkGetter) {
    const showColumnDropdown = Vue.ref(false);
    const columnSearch = Vue.ref('');
    const hiddenColumns = Vue.ref([]);
    const customColumnOrder = Vue.ref([]);

    const draggedColField = Vue.ref(null);
    const isColDragging = Vue.ref(false);

    const allColumns = Vue.computed(() => {
        if (typeof allColumnsGetter === 'function') {
            return allColumnsGetter() || [];
        }
        return (allColumnsGetter && allColumnsGetter.value) || [];
    });

    const isColumnPrimaryKey = function(field) {
        if (typeof isPkGetter === 'function') return isPkGetter(field);
        const col = allColumns.value.find(c => c.Field === field);
        return col ? (col.Key === 'PRI' || col.pk === 1) : false;
    };

    const orderedColumns = Vue.computed(() => {
        const rawCols = allColumns.value;
        if (!rawCols || rawCols.length === 0) return [];
        if (!customColumnOrder.value || customColumnOrder.value.length === 0) return rawCols;

        const colMap = new Map();
        rawCols.forEach(c => colMap.set(c.Field, c));

        const result = [];
        customColumnOrder.value.forEach(field => {
            if (colMap.has(field)) {
                result.push(colMap.get(field));
                colMap.delete(field);
            }
        });
        // Append any unlisted / new columns
        colMap.forEach(c => result.push(c));
        return result;
    });

    const visibleColumns = Vue.computed(() => {
        const hiddenSet = new Set(hiddenColumns.value);
        return orderedColumns.value.filter(c => !hiddenSet.has(c.Field));
    });

    const filteredColumnList = Vue.computed(() => {
        const list = orderedColumns.value;
        if (!columnSearch.value) return list;
        const q = columnSearch.value.toLowerCase().trim();
        return list.filter(c => c.Field.toLowerCase().includes(q) || (c.Type && c.Type.toLowerCase().includes(q)));
    });

    const hiddenCount = Vue.computed(() => hiddenColumns.value.length);
    const visibleCount = Vue.computed(() => visibleColumns.value.length);
    const totalCount = Vue.computed(() => allColumns.value.length);

    const isColumnVisible = function(field) {
        return !hiddenColumns.value.includes(field);
    };

    const saveSettings = function() {
        if (typeof getStorageKey !== 'function') return;
        const key = getStorageKey();
        if (!key) return;
        try {
            const data = {
                hidden: hiddenColumns.value,
                order: customColumnOrder.value
            };
            localStorage.setItem('col_prefs_' + key, JSON.stringify(data));
        } catch (e) {
            console.error('Failed to save column preferences:', e);
        }
    };

    const loadSettings = function() {
        if (typeof getStorageKey !== 'function') return;
        const key = getStorageKey();
        if (!key) return;
        try {
            const raw = localStorage.getItem('col_prefs_' + key);
            if (raw) {
                const data = JSON.parse(raw);
                hiddenColumns.value = Array.isArray(data.hidden) ? data.hidden : [];
                customColumnOrder.value = Array.isArray(data.order) ? data.order : [];
            } else {
                hiddenColumns.value = [];
                customColumnOrder.value = [];
            }
        } catch (e) {
            hiddenColumns.value = [];
            customColumnOrder.value = [];
        }
    };

    const toggleColumn = function(field) {
        const idx = hiddenColumns.value.indexOf(field);
        if (idx > -1) {
            hiddenColumns.value.splice(idx, 1);
        } else {
            // Prevent hiding the last visible column
            if (visibleColumns.value.length <= 1 && isColumnVisible(field)) {
                return;
            }
            hiddenColumns.value.push(field);
        }
        saveSettings();
    };

    const showAllColumns = function() {
        hiddenColumns.value = [];
        saveSettings();
    };

    const hideAllColumns = function() {
        // Keep only primary keys or the first column visible
        const pkFields = allColumns.value.filter(c => isColumnPrimaryKey(c.Field)).map(c => c.Field);
        const keepFields = pkFields.length > 0 ? pkFields : (allColumns.value.length > 0 ? [allColumns.value[0].Field] : []);
        hiddenColumns.value = allColumns.value.filter(c => !keepFields.includes(c.Field)).map(c => c.Field);
        saveSettings();
    };

    const ensureCustomOrder = function() {
        if (!customColumnOrder.value || customColumnOrder.value.length === 0) {
            customColumnOrder.value = orderedColumns.value.map(c => c.Field);
        }
    };

    const moveColumnUp = function(field) {
        ensureCustomOrder();
        const idx = customColumnOrder.value.indexOf(field);
        if (idx > 0) {
            const temp = customColumnOrder.value[idx - 1];
            customColumnOrder.value[idx - 1] = customColumnOrder.value[idx];
            customColumnOrder.value[idx] = temp;
            saveSettings();
        }
    };

    const moveColumnDown = function(field) {
        ensureCustomOrder();
        const idx = customColumnOrder.value.indexOf(field);
        if (idx > -1 && idx < customColumnOrder.value.length - 1) {
            const temp = customColumnOrder.value[idx + 1];
            customColumnOrder.value[idx + 1] = customColumnOrder.value[idx];
            customColumnOrder.value[idx] = temp;
            saveSettings();
        }
    };

    const resetColumns = function() {
        hiddenColumns.value = [];
        customColumnOrder.value = [];
        if (typeof getStorageKey === 'function') {
            const key = getStorageKey();
            if (key) {
                try { localStorage.removeItem('col_prefs_' + key); } catch(e) {}
            }
        }
    };

    // Drag and drop reordering
    const onColDragStart = function(e, field) {
        draggedColField.value = field;
        isColDragging.value = true;
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', field);
        }
    };

    const onColDragOver = function(e, targetField) {
        if (!draggedColField.value || draggedColField.value === targetField) return;
        ensureCustomOrder();
        const fromIdx = customColumnOrder.value.indexOf(draggedColField.value);
        const toIdx = customColumnOrder.value.indexOf(targetField);
        if (fromIdx > -1 && toIdx > -1) {
            customColumnOrder.value.splice(fromIdx, 1);
            customColumnOrder.value.splice(toIdx, 0, draggedColField.value);
        }
    };

    const onColDrop = function(e, targetField) {
        saveSettings();
    };

    const onColDragEnd = function() {
        draggedColField.value = null;
        isColDragging.value = false;
        saveSettings();
    };

    return {
        showColumnDropdown,
        columnSearch,
        hiddenColumns,
        customColumnOrder,
        allColumns,
        orderedColumns,
        visibleColumns,
        filteredColumnList,
        hiddenCount,
        visibleCount,
        totalCount,
        isColumnVisible,
        isColumnPrimaryKey,
        toggleColumn,
        showAllColumns,
        hideAllColumns,
        moveColumnUp,
        moveColumnDown,
        resetColumns,
        loadSettings,
        saveSettings,
        draggedColField,
        isColDragging,
        onColDragStart,
        onColDragOver,
        onColDrop,
        onColDragEnd
    };
};

