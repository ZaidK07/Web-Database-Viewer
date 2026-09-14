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

window.createErdModule = function(Vue, schemaGetter, onSelectTable, getStorageKey, showToast) {
    const viewMode = Vue.ref('data'); // 'data' | 'erd'
    const erdZoom = Vue.ref(1);
    const erdPan = Vue.ref({ x: 50, y: 50 });
    const erdSearch = Vue.ref('');
    const tablePositions = Vue.ref({});
    const hoveredLink = Vue.ref(null);
    const hoveredTable = Vue.ref(null);

    const isDraggingCard = Vue.ref(false);
    const draggingCardName = Vue.ref(null);
    const dragOffset = Vue.ref({ x: 0, y: 0 });

    const isPanning = Vue.ref(false);
    const panStart = Vue.ref({ x: 0, y: 0, initialPanX: 0, initialPanY: 0 });

    const getSchema = () => {
        if (typeof schemaGetter === 'function') return schemaGetter() || {};
        return (schemaGetter && schemaGetter.value) || {};
    };

    const tableNames = Vue.computed(() => {
        const schema = getSchema();
        return Object.keys(schema);
    });

    const filteredTableNames = Vue.computed(() => {
        const list = tableNames.value;
        if (!erdSearch.value) return list;
        const q = erdSearch.value.toLowerCase().trim();
        return list.filter(t => t.toLowerCase().includes(q));
    });

    // Extract all foreign key links
    const erdLinks = Vue.computed(() => {
        const links = [];
        const schema = getSchema();
        const positions = tablePositions.value;

        Object.keys(schema).forEach(sourceTable => {
            const tableDef = schema[sourceTable];
            if (!tableDef || !tableDef.foreign_keys) return;
            const fks = tableDef.foreign_keys;

            Object.keys(fks).forEach(sourceCol => {
                const target = fks[sourceCol];
                if (!target || !target.table || !schema[target.table]) return;

                const targetTable = target.table;
                const targetCol = target.column;

                const sourcePos = positions[sourceTable] || { x: 0, y: 0 };
                const targetPos = positions[targetTable] || { x: 0, y: 0 };

                // Determine column row offsets
                const sourceCols = tableDef.columns || [];
                const targetCols = schema[targetTable]?.columns || [];

                const sourceIdx = sourceCols.findIndex(c => c.Field === sourceCol);
                const targetIdx = targetCols.findIndex(c => c.Field === targetCol);

                const sourceRowY = sourceIdx >= 0 ? (sourcePos.y + 44 + (sourceIdx * 28) + 14) : (sourcePos.y + 22);
                const targetRowY = targetIdx >= 0 ? (targetPos.y + 44 + (targetIdx * 28) + 14) : (targetPos.y + 22);

                const cardWidth = 260;
                let startX, endX;

                if (sourcePos.x + cardWidth < targetPos.x) {
                    // Source is to the left of Target
                    startX = sourcePos.x + cardWidth;
                    endX = targetPos.x;
                } else if (sourcePos.x > targetPos.x + cardWidth) {
                    // Source is to the right of Target
                    startX = sourcePos.x;
                    endX = targetPos.x + cardWidth;
                } else {
                    // Overlapping horizontally: connect nearest edges
                    startX = sourcePos.x + cardWidth;
                    endX = targetPos.x + cardWidth;
                }

                // Smooth Bézier curve path
                const dx = Math.max(50, Math.abs(endX - startX) * 0.45);
                const cx1 = startX < endX ? startX + dx : startX - dx;
                const cx2 = startX < endX ? endX - dx : endX + dx;
                const path = `M ${startX} ${sourceRowY} C ${cx1} ${sourceRowY}, ${cx2} ${targetRowY}, ${endX} ${targetRowY}`;

                links.push({
                    id: `${sourceTable}.${sourceCol}->${targetTable}.${targetCol}`,
                    sourceTable,
                    sourceCol,
                    targetTable,
                    targetCol,
                    path,
                    startX,
                    startY: sourceRowY,
                    endX,
                    endY: targetRowY,
                    midX: (startX + endX) / 2,
                    midY: (sourceRowY + targetRowY) / 2
                });
            });
        });
        return links;
    });

    // Auto arrange nodes in a responsive grid
    const autoArrange = () => {
        const schema = getSchema();
        const tables = Object.keys(schema);
        if (tables.length === 0) return;

        const cardWidth = 260;
        const colCount = Math.max(2, Math.min(4, Math.ceil(Math.sqrt(tables.length))));
        const gapX = 80;
        const colHeights = new Array(colCount).fill(40);
        const newPositions = {};

        tables.forEach((table, i) => {
            const colIndex = i % colCount;
            const x = 40 + colIndex * (cardWidth + gapX);
            const y = colHeights[colIndex];

            newPositions[table] = { x, y };

            const colCountEstimate = (schema[table]?.columns || []).length;
            const cardHeight = 44 + (colCountEstimate * 28) + 16;
            colHeights[colIndex] += cardHeight + 40;
        });

        tablePositions.value = newPositions;
        savePositions();
    };

    const loadPositions = () => {
        if (typeof getStorageKey !== 'function') return;
        const key = getStorageKey();
        if (!key) return;
        try {
            const saved = localStorage.getItem('erd_pos_' + key);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (typeof parsed === 'object') {
                    tablePositions.value = parsed;
                    return;
                }
            }
        } catch(e) {}
        autoArrange();
    };

    const savePositions = () => {
        if (typeof getStorageKey !== 'function') return;
        const key = getStorageKey();
        if (!key) return;
        try {
            localStorage.setItem('erd_pos_' + key, JSON.stringify(tablePositions.value));
        } catch(e) {}
    };

    // Zoom and Pan Controls
    const zoomIn = () => {
        erdZoom.value = Math.min(2.0, parseFloat((erdZoom.value + 0.15).toFixed(2)));
    };

    const zoomOut = () => {
        erdZoom.value = Math.max(0.35, parseFloat((erdZoom.value - 0.15).toFixed(2)));
    };

    const resetZoom = () => {
        erdZoom.value = 1;
        erdPan.value = { x: 50, y: 50 };
    };

    const onWheel = (e) => {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            erdZoom.value = Math.max(0.35, Math.min(2.0, parseFloat((erdZoom.value + delta).toFixed(2))));
        } else {
            erdPan.value = {
                x: erdPan.value.x - e.deltaX * 0.7,
                y: erdPan.value.y - e.deltaY * 0.7
            };
        }
    };

    // Card Dragging
    const startDragCard = (e, tableName) => {
        if (e.button !== 0) return;
        isDraggingCard.value = true;
        draggingCardName.value = tableName;

        const currentPos = tablePositions.value[tableName] || { x: 0, y: 0 };
        dragOffset.value = {
            x: (e.clientX / erdZoom.value) - currentPos.x,
            y: (e.clientY / erdZoom.value) - currentPos.y
        };
        e.stopPropagation();
    };

    // Canvas Background Panning
    const startCanvasPan = (e) => {
        if (e.target.closest('.erd-card') || e.target.closest('.erd-controls')) return;
        isPanning.value = true;
        panStart.value = {
            x: e.clientX,
            y: e.clientY,
            initialPanX: erdPan.value.x,
            initialPanY: erdPan.value.y
        };
    };

    const onCanvasMouseMove = (e) => {
        if (isDraggingCard.value && draggingCardName.value) {
            const table = draggingCardName.value;
            const newX = Math.round((e.clientX / erdZoom.value) - dragOffset.value.x);
            const newY = Math.round((e.clientY / erdZoom.value) - dragOffset.value.y);
            tablePositions.value = {
                ...tablePositions.value,
                [table]: { x: Math.max(0, newX), y: Math.max(0, newY) }
            };
        } else if (isPanning.value) {
            erdPan.value = {
                x: panStart.value.initialPanX + (e.clientX - panStart.value.x),
                y: panStart.value.initialPanY + (e.clientY - panStart.value.y)
            };
        }
    };

    const onCanvasMouseUp = () => {
        if (isDraggingCard.value) {
            isDraggingCard.value = false;
            draggingCardName.value = null;
            savePositions();
        }
        isPanning.value = false;
    };

    const selectAndOpenTable = (tableName) => {
        viewMode.value = 'data';
        if (typeof onSelectTable === 'function') {
            onSelectTable(tableName);
        }
    };

    // Export Mermaid ERD
    const exportMermaidErd = async () => {
        const schema = getSchema();
        let mermaid = 'erDiagram\n';

        Object.keys(schema).forEach(tbl => {
            const def = schema[tbl];
            const cleanTbl = tbl.replace(/[^a-zA-Z0-9_]/g, '_');
            mermaid += `    ${cleanTbl} {\n`;
            (def.columns || []).forEach(col => {
                let cleanType = (col.Type || 'text').split('(')[0].replace(/[^a-zA-Z0-9]/g, '_');
                let keyTag = '';
                if (col.Key === 'PRI' || col.pk === 1) keyTag = ' PK';
                else if (def.foreign_keys && def.foreign_keys[col.Field]) keyTag = ' FK';
                const cleanField = col.Field.replace(/[^a-zA-Z0-9_]/g, '_');
                mermaid += `        ${cleanType} ${cleanField}${keyTag}\n`;
            });
            mermaid += `    }\n`;
        });

        // Add relationships
        Object.keys(schema).forEach(sourceTable => {
            const def = schema[sourceTable];
            if (!def || !def.foreign_keys) return;
            const cleanSource = sourceTable.replace(/[^a-zA-Z0-9_]/g, '_');
            Object.keys(def.foreign_keys).forEach(sourceCol => {
                const target = def.foreign_keys[sourceCol];
                if (!target || !target.table) return;
                const cleanTarget = target.table.replace(/[^a-zA-Z0-9_]/g, '_');
                mermaid += `    ${cleanSource} }o--|| ${cleanTarget} : "${sourceCol}"\n`;
            });
        });

        try {
            await navigator.clipboard.writeText(mermaid);
            if (typeof showToast === 'function') {
                showToast('Mermaid ERD copied to clipboard!');
            }
        } catch(e) {
            if (typeof showToast === 'function') {
                showToast('Failed to copy to clipboard', 'error');
            }
        }
    };

    return {
        viewMode,
        erdZoom,
        erdPan,
        erdSearch,
        tablePositions,
        hoveredLink,
        hoveredTable,
        isDraggingCard,
        draggingCardName,
        isPanning,
        tableNames,
        filteredTableNames,
        erdLinks,
        autoArrange,
        loadPositions,
        savePositions,
        zoomIn,
        zoomOut,
        resetZoom,
        onWheel,
        startDragCard,
        startCanvasPan,
        onCanvasMouseMove,
        onCanvasMouseUp,
        selectAndOpenTable,
        exportMermaidErd
    };
};

