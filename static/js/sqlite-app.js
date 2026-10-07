/**
 * SQLite Viewer Application — Local & uploaded SQLite database viewer
 */
(function () {
    'use strict';
    const { createApp, ref, onMounted, computed, reactive, watch, nextTick } = Vue;

    window.initSqliteApp = function () {
    window.setupApp = () => {
        const baseSetup = window.baseAppSetup();

        const openSqlConsole = () => {
            if (activeFile.value) {
                baseSetup.sqlDb.value = activeFile.value.id;
            } else if (sqliteFiles.value.length > 0) {
                baseSetup.sqlDb.value = sqliteFiles.value[0].id;
            }
            baseSetup.showSqlPanel.value = true;
        };

        // Sidebar width persistence
        const sqliteSidebarWidth = ref(parseInt(localStorage.getItem('sqlite_sidebar_width') || '280'));
        let isResizing = false;
        const startSqliteResize = () => {
            isResizing = true;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            window.addEventListener('mousemove', onSqliteResize);
            window.addEventListener('mouseup', stopSqliteResize);
        };
        const onSqliteResize = (e) => {
            if (!isResizing) return;
            const newWidth = Math.max(200, Math.min(600, e.clientX));
            sqliteSidebarWidth.value = newWidth;
        };
        const stopSqliteResize = () => {
            isResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            localStorage.setItem('sqlite_sidebar_width', sqliteSidebarWidth.value.toString());
            window.removeEventListener('mousemove', onSqliteResize);
            window.removeEventListener('mouseup', stopSqliteResize);
        };

        const sqliteFiles = ref([]);
        const selectedFileId = ref(window.INITIAL_FILE_ID || localStorage.getItem('last_sqlite_file_id') || '');
        const activeFile = computed(() => sqliteFiles.value.find(f => f.id === selectedFileId.value) || null);
        const searchFileQuery = ref('');
        const filteredFiles = computed(() => {
            if (!searchFileQuery.value) return sqliteFiles.value;
            const q = searchFileQuery.value.toLowerCase();
            return sqliteFiles.value.filter(f => f.original_name.toLowerCase().includes(q));
        });

        // Schema state
        const tables = ref([]);
        const views = ref([]);
        const schema = ref({});
        const tableFilter = ref('');
        const loadingSchema = ref(false);
        const schemaError = ref('');
        const expandedSchema = ref(null);

        const filteredTables = computed(() => {
            if (!tableFilter.value) return tables.value;
            const q = tableFilter.value.toLowerCase();
            return tables.value.filter(t => t.toLowerCase().includes(q));
        });

        const filteredViews = computed(() => {
            if (!tableFilter.value) return views.value;
            const q = tableFilter.value.toLowerCase();
            return views.value.filter(v => v.toLowerCase().includes(q));
        });

        const activeTable = ref('');
        const rows = ref([]);
        const totalRows = ref(0);
        const currentPage = ref(1);
        const totalPages = ref(1);
        const pageLimit = ref(100);
        const searchQuery = ref('');
        const sortCol = ref('');
        const sortDir = ref('ASC');
        const loadingData = ref(false);
        const tableError = ref('');
        const showActionsDropdown = ref(false);

        // Responsive / Collapsible Search
        const showSearchInput = ref(false);
        const searchInputRef = ref(null);
        const windowWidth = ref(window.innerWidth);

        const handleWindowResize = () => {
            windowWidth.value = window.innerWidth;
        };
        window.addEventListener('resize', handleWindowResize);

        const isSearchCollapsible = computed(() => {
            if (baseSetup.showSqlPanel?.value) return true;
            if (windowWidth.value < 1280) return true;
            return false;
        });

        const isSearchOpen = computed(() => {
            if (searchQuery.value) return true;
            if (showSearchInput.value) return true;
            return !isSearchCollapsible.value;
        });

        const openSearchInput = () => {
            showSearchInput.value = true;
            nextTick(() => {
                if (searchInputRef.value) {
                    searchInputRef.value.focus();
                }
            });
        };

        const currentTableColumns = computed(() => {
            if (!activeTable.value || !schema.value[activeTable.value]) return [];
            return schema.value[activeTable.value].columns || [];
        });

        const currentPrimaryKeys = computed(() => {
            if (!activeTable.value || !schema.value[activeTable.value]) return [];
            return schema.value[activeTable.value].primary_keys || [];
        });

        const toggleSchema = (tbl) => {
            expandedSchema.value = expandedSchema.value === tbl ? null : tbl;
        };

        const formatFileSize = (bytes) => {
            if (!bytes || bytes === 0) return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
        };

        // Upload dropdown state
        const showFileDropdown = ref(false);

        // Fetch uploaded files list
        const fetchFiles = async () => {
            try {
                const res = await fetch('/api/sqlite/files');
                const data = await res.json();
                if (data.success) {
                    sqliteFiles.value = data.files;
                    baseSetup.dbList.value = data.files.map(f => ({ name: f.original_name, id: f.id }));
                    if (!selectedFileId.value && data.files.length > 0) {
                        selectedFileId.value = data.files[0].id;
                        localStorage.setItem('last_sqlite_file_id', data.files[0].id);
                    }
                    if (selectedFileId.value) {
                        baseSetup.sqlDb.value = selectedFileId.value;
                        fetchSchema(selectedFileId.value);
                    }
                }
            } catch (e) {
                console.error('Error loading SQLite files:', e);
            }
        };

        // Switch active SQLite file
        const switchActiveFile = async (file) => {
            if (!file) return;
            showFileDropdown.value = false;
            selectedFileId.value = file.id;
            baseSetup.sqlDb.value = file.id;
            localStorage.setItem('last_sqlite_file_id', file.id);
            activeTable.value = '';
            rows.value = [];
            totalRows.value = 0;
            currentPage.value = 1;
            searchQuery.value = '';
            expandedSchema.value = null;
            await fetchSchema(file.id);
        };

        // Fetch database schema
        const fetchSchema = async (fileId) => {
            if (!fileId) return;
            loadingSchema.value = true;
            schemaError.value = '';
            try {
                const res = await fetch(`/api/sqlite/${fileId}/schema`);
                const data = await res.json();
                if (data.success) {
                    tables.value = data.tables || [];
                    views.value = data.views || [];
                    schema.value = data.schema || {};
                    erd.loadPositions();
                    // Auto select first table if none active or current activeTable is not in this db
                    const allDbObjects = [...(data.tables || []), ...(data.views || [])];
                    if ((!activeTable.value || !allDbObjects.includes(activeTable.value)) && data.tables && data.tables.length > 0) {
                        selectSqliteTable(data.tables[0]);
                    } else if (activeTable.value && allDbObjects.includes(activeTable.value)) {
                        fetchTableData();
                    } else {
                        activeTable.value = '';
                        rows.value = [];
                    }
                } else {
                    schemaError.value = data.error || 'Failed to read database schema';
                }
            } catch (e) {
                schemaError.value = 'Failed to load database schema';
            } finally {
                loadingSchema.value = false;
            }
        };

        const onFileSelected = () => {
            localStorage.setItem('last_sqlite_file_id', selectedFileId.value);
            activeTable.value = '';
            rows.value = [];
            totalRows.value = 0;
            currentPage.value = 1;
            expandedSchema.value = null;
            fetchSchema(selectedFileId.value);
        };

        // Cell Edit Modal State
        const cellEditModal = ref({
            open: false,
            rowIndex: -1,
            colField: '',
            colType: '',
            value: '',
            isNull: false,
            isSaving: false,
            originalValue: null
        });
        const cellEditTextarea = ref(null);
        const cancelCellEdit = () => {
            cellEditModal.value.open = false;
            cellEditModal.value.rowIndex = -1;
            cellEditModal.value.colField = '';
            cellEditModal.value.value = '';
            cellEditModal.value.isNull = false;
            cellEditModal.value.isSaving = false;
        };
        const cancelEdit = cancelCellEdit;

        const selectSqliteTable = (tbl) => {
            activeTable.value = tbl;
            currentPage.value = 1;
            searchQuery.value = '';
            sortCol.value = '';
            sortDir.value = 'ASC';
            colWidths.value = {};
            batchSelection.clearSelection();
            columnManager.loadSettings();
            cancelCellEdit();
            fetchTableData();
        };

        const fetchTableData = async () => {
            if (!selectedFileId.value || !activeTable.value) return;
            loadingData.value = true;
            tableError.value = '';
            batchSelection.clearSelection();
            try {
                let url = `/api/sqlite/${selectedFileId.value}/table/${encodeURIComponent(activeTable.value)}/data?page=${currentPage.value}&limit=${pageLimit.value}`;
                if (searchQuery.value) url += `&search=${encodeURIComponent(searchQuery.value)}`;
                if (sortCol.value) url += `&sort=${encodeURIComponent(sortCol.value)}&dir=${sortDir.value}`;

                const res = await fetch(url);
                const data = await res.json();
                if (data.error) {
                    tableError.value = data.error;
                    rows.value = [];
                } else {
                    rows.value = data.rows || [];
                    totalRows.value = data.total || 0;
                    totalPages.value = data.pages || 1;
                }
            } catch (e) {
                tableError.value = 'Network error loading records';
            } finally {
                loadingData.value = false;
            }
        };

        const sortBy = (col) => {
            if (sortCol.value === col) {
                sortDir.value = sortDir.value === 'ASC' ? 'DESC' : 'ASC';
            } else {
                sortCol.value = col;
                sortDir.value = 'ASC';
            }
            fetchTableData();
        };

        const prevPage = () => {
            if (currentPage.value > 1) {
                currentPage.value--;
                fetchTableData();
            }
        };

        const nextPage = () => {
            if (currentPage.value < totalPages.value) {
                currentPage.value++;
                fetchTableData();
            }
        };

        const refreshCurrentDatabase = async () => {
            if (!selectedFileId.value) return;
            showToast('Refreshing database...');
            await fetchSchema(selectedFileId.value);
            if (activeTable.value) {
                await fetchTableData();
            }
            showToast('Database refreshed!');
        };

        // Drag & Drop / Upload handling
        const isDragging = ref(false);
        const fileInput = ref(null);
        const triggerFileUpload = () => {
            const input = document.getElementById('sqlite-file-input') || fileInput.value;
            if (input) input.click();
        };

        const handleFileInputChange = (e) => {
            const file = e.target.files && e.target.files[0];
            if (file) uploadSqliteFile(file);
            e.target.value = '';
        };

        const onDragOver = () => { isDragging.value = true; };
        const onDragLeave = () => { isDragging.value = false; };
        const onDrop = (e) => {
            isDragging.value = false;
            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                uploadSqliteFile(e.dataTransfer.files[0]);
            }
        };

        const uploadSqliteFile = async (file) => {
            console.log("Uploading file:", file.name, file.size);
            baseSetup.showToast('Uploading SQLite file...');
            const formData = new FormData();
            formData.append('file', file);
            try {
                const res = await fetch('/api/sqlite/upload', {
                    method: 'POST',
                    body: formData
                });
                const data = await res.json();
                console.log("Upload response:", data);
                if (data.success) {
                    baseSetup.showToast('File loaded successfully!');
                    await fetchFiles();
                    await switchActiveFile(data.file);
                } else {
                    baseSetup.showToast(data.error || 'Upload failed', 'error');
                }
            } catch (e) {
                console.error("Upload error:", e);
                baseSetup.showToast('Failed to upload file: ' + e.message, 'error');
            }
        };

        // Local path modal
        const showLocalPathModal = ref(false);
        const localPathInput = ref('');
        const registerLocalPath = async () => {
            if (!localPathInput.value) return;
            try {
                const res = await fetch('/api/sqlite/register-local', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: localPathInput.value })
                });
                const data = await res.json();
                if (data.success) {
                    baseSetup.showToast('Local SQLite file opened!');
                    showLocalPathModal.value = false;
                    const openedFile = data.file;
                    localPathInput.value = '';
                    await fetchFiles();
                    await switchActiveFile(openedFile);
                } else {
                    baseSetup.showToast(data.error || 'Failed to open local path', 'error');
                }
            } catch (e) {
                baseSetup.showToast('Error registering local file', 'error');
            }
        };

        // Delete file
        const confirmDeleteFile = async (file) => {
            if (!file) return;
            const confirmed = await baseSetup.customConfirm(
                'Remove SQLite File',
                `Are you sure you want to remove "${file.original_name}" from the viewer?`,
                true
            );
            if (!confirmed) return;

            try {
                const res = await fetch(`/api/sqlite/files/${file.id}`, { method: 'DELETE' });
                const data = await res.json();
                if (data.success) {
                    baseSetup.showToast('File removed');
                    if (selectedFileId.value === file.id) {
                        selectedFileId.value = '';
                        localStorage.removeItem('last_sqlite_file_id');
                        activeTable.value = '';
                        rows.value = [];
                        tables.value = [];
                        views.value = [];
                        schema.value = {};
                    }
                    await fetchFiles();
                    if (!selectedFileId.value && sqliteFiles.value.length > 0) {
                        await switchActiveFile(sqliteFiles.value[0]);
                    }
                } else {
                    baseSetup.showToast(data.error || 'Failed to remove file', 'error');
                }
            } catch (e) {
                baseSetup.showToast('Network error removing file', 'error');
            }
        };

        // Row Insert / Edit Modal
        const showRowModal = ref(false);
        const isEditingRow = ref(false);
        const rowFormData = reactive({});
        const editingOriginalKeys = ref({});

        const openInsertModal = () => {
            isEditingRow.value = false;
            Object.keys(rowFormData).forEach(k => delete rowFormData[k]);
            currentTableColumns.value.forEach(col => {
                rowFormData[col.Field] = '';
            });
            showRowModal.value = true;
        };

        const openEditModal = (row) => {
            isEditingRow.value = true;
            Object.keys(rowFormData).forEach(k => delete rowFormData[k]);
            currentTableColumns.value.forEach(col => {
                rowFormData[col.Field] = row[col.Field] !== null ? String(row[col.Field]) : '';
            });
            const pks = {};
            currentPrimaryKeys.value.forEach(pk => {
                pks[pk] = row[pk];
            });
            editingOriginalKeys.value = pks;
            showRowModal.value = true;
        };

        const saveRowForm = async () => {
            try {
                let url = `/api/sqlite/${selectedFileId.value}/table/${encodeURIComponent(activeTable.value)}/row`;
                let method = isEditingRow.value ? 'PUT' : 'POST';
                let payload = {};

                if (isEditingRow.value) {
                    payload = {
                        primary_keys: editingOriginalKeys.value,
                        updates: { ...rowFormData }
                    };
                } else {
                    payload = { ...rowFormData };
                }

                const res = await fetch(url, {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (data.success) {
                    showToast(isEditingRow.value ? 'Row updated!' : 'Row inserted!');
                    showRowModal.value = false;
                    fetchTableData();
                } else {
                    showToast(data.error || 'Save failed', 'error');
                }
            } catch (e) {
                showToast('Network error saving row', 'error');
            }
        };

        const confirmDeleteRow = async (row) => {
            if (!confirm('Are you sure you want to delete this row?')) return;
            const pks = {};
            currentPrimaryKeys.value.forEach(pk => {
                pks[pk] = row[pk];
            });
            try {
                const res = await fetch(`/api/sqlite/${selectedFileId.value}/table/${encodeURIComponent(activeTable.value)}/row`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ primary_keys: pks })
                });
                const data = await res.json();
                if (data.success) {
                    showToast('Row deleted');
                    fetchTableData();
                } else {
                    showToast(data.error || 'Delete failed', 'error');
                }
            } catch (e) {
                showToast('Network error deleting row', 'error');
            }
        };

        // Column Resizing State
        const colWidths = ref({});
        const resizingCol = ref({ field: null, startX: 0, startWidth: 0 });

        const startColResize = (e, field) => {
            const currentWidth = colWidths.value[field] || 200;
            resizingCol.value = { field, startX: e.clientX, startWidth: currentWidth };
            document.addEventListener('mousemove', handleColResize);
            document.addEventListener('mouseup', stopColResize);
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        };

        const handleColResize = (e) => {
            if (!resizingCol.value.field) return;
            const diff = e.clientX - resizingCol.value.startX;
            const newWidth = Math.max(50, Math.min(800, resizingCol.value.startWidth + diff));
            colWidths.value[resizingCol.value.field] = newWidth;
        };

        const stopColResize = () => {
            resizingCol.value = { field: null, startX: 0, startWidth: 0 };
            document.removeEventListener('mousemove', handleColResize);
            document.removeEventListener('mouseup', stopColResize);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };

        const startCellEdit = (rowIndex, colField, currentValue) => {
            if (!currentPrimaryKeys.value.length || currentPrimaryKeys.value.includes(colField)) return;
            const colDef = currentTableColumns.value.find(c => c.Field === colField);
            const isNull = currentValue === null;
            const valStr = isNull ? '' : (typeof currentValue === 'object' ? JSON.stringify(currentValue) : String(currentValue));

            cellEditModal.value = {
                open: true,
                rowIndex,
                colField,
                colType: colDef ? colDef.Type : '',
                value: valStr,
                isNull,
                isSaving: false,
                originalValue: currentValue
            };

            Vue.nextTick(() => {
                if (cellEditTextarea.value) {
                    cellEditTextarea.value.focus();
                    cellEditTextarea.value.select();
                }
            });
        };

        const saveCellEdit = async () => {
            const { rowIndex, colField, isNull, value, originalValue } = cellEditModal.value;
            if (rowIndex === -1 || !colField) return;

            const originalRow = rows.value[rowIndex];
            const newValue = isNull ? null : value;
            if (newValue === originalValue) {
                cancelCellEdit();
                return;
            }

            const pks = {};
            currentPrimaryKeys.value.forEach(pk => {
                pks[pk] = originalRow[pk];
            });

            cellEditModal.value.isSaving = true;
            const previousValue = originalRow[colField];
            // Optimistic UI update
            rows.value[rowIndex][colField] = newValue;

            try {
                const res = await fetch(`/api/sqlite/${selectedFileId.value}/table/${encodeURIComponent(activeTable.value)}/row`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ primary_keys: pks, updates: { [colField]: newValue } })
                });
                const data = await res.json();
                if (data.success) {
                    cancelCellEdit();
                    baseSetup.showToast('Cell updated successfully');
                } else {
                    rows.value[rowIndex][colField] = previousValue; // Revert
                    baseSetup.showToast(data.error || 'Failed to update cell', 'error');
                }
            } catch (e) {
                rows.value[rowIndex][colField] = previousValue; // Revert
                baseSetup.showToast('Network error updating cell', 'error');
            } finally {
                cellEditModal.value.isSaving = false;
            }
        };

        // Cell Copy on 'c' Key
        const copiedCell = ref({ row: -1, col: null });
        const isCHeld = ref(false);

        const copyToClipboard = (text, rowIdx, colField) => {
            const val = text === null ? 'NULL' : (typeof text === 'object' ? JSON.stringify(text) : String(text));
            navigator.clipboard.writeText(val).then(() => {
                copiedCell.value = { row: rowIdx, col: colField };
                setTimeout(() => {
                    if (copiedCell.value.row === rowIdx && copiedCell.value.col === colField) {
                        copiedCell.value = { row: -1, col: null };
                    }
                }, 1000);
            });
        };

        const handleCellClick = (e, value, rowIdx, colField) => {
            if (isCHeld.value) {
                e.preventDefault();
                copyToClipboard(value, rowIdx, colField);
            }
        };

        const isColumnPrimaryKey = (colField) => {
            return (currentPrimaryKeys.value || []).includes(colField);
        };

        // Inspector Modal (via shared viewer module)
        const inspector = window.createInspectorModule(
            Vue,
            (colField) => isColumnPrimaryKey(colField),
            (rowIndex, colField, originalValue) => startCellEdit(rowIndex, colField, originalValue)
        );
        const { inspectorModal, closeInspector } = inspector;

        // Batch Selection Module
        const batchSelection = window.createBatchSelectionModule(
            Vue,
            rows,
            () => (currentPrimaryKeys.value || []),
            () => { fetchTableData(); },
            async (pkList) => {
                const res = await fetch(`/api/sqlite/${selectedFileId.value}/table/${encodeURIComponent(activeTable.value)}/row`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ rows: pkList })
                });
                return await res.json();
            }
        );

        // Column Visibility & Reordering Module
        const columnManager = window.createColumnManagerModule(
            Vue,
            () => currentTableColumns.value,
            () => (activeTable.value && selectedFileId.value ? ('sqlite_' + selectedFileId.value + '_' + activeTable.value) : ''),
            (field) => currentPrimaryKeys.value.includes(field)
        );

        // Interactive ER Diagram Module
        const erd = window.createErdModule(
            Vue,
            () => schema.value,
            (t) => selectSqliteTable(t),
            () => (selectedFileId.value ? ('sqlite_' + selectedFileId.value) : ''),
            baseSetup.showToast
        );

        onMounted(() => {
            fetchFiles();

            window.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    if (showActionsDropdown.value) {
                        showActionsDropdown.value = false;
                        return;
                    }
                    if (showColumnDropdown.value) {
                        showColumnDropdown.value = false;
                        return;
                    }
                    if (inspectorModal.value.open) {
                        closeInspector();
                        return;
                    }
                    if (cellEditModal.value.open) {
                        cancelCellEdit();
                        return;
                    }
                }
                const tag = e.target.tagName.toLowerCase();
                if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
                if (e.key.toLowerCase() === 'c') isCHeld.value = true;
            });
            window.addEventListener('keyup', (e) => {
                if (e.key.toLowerCase() === 'c') isCHeld.value = false;
            });
            window.addEventListener('blur', () => isCHeld.value = false);
        });

        return {
            ...baseSetup,
            sqliteSidebarWidth, startSqliteResize,
            sqliteFiles, selectedFileId, activeFile, formatFileSize,
            tables, views, schema, tableFilter, filteredTables, filteredViews,
            loadingSchema, schemaError, expandedSchema, toggleSchema,
            activeTable, rows, totalRows, currentPage, totalPages, pageLimit,
            searchQuery, sortCol, sortDir, loadingData, tableError,
            showActionsDropdown,
            showSearchInput, searchInputRef, isSearchCollapsible, isSearchOpen, openSearchInput,
            currentTableColumns, currentPrimaryKeys,
            selectSqliteTable, fetchTableData, sortBy, prevPage, nextPage,
            refreshCurrentDatabase,
            colWidths, startColResize,
            cellEditModal, cellEditTextarea, startCellEdit, cancelCellEdit, saveCellEdit, cancelEdit: cancelCellEdit, saveCell: saveCellEdit,
            // Inspector Modal
            ...inspector,
            // Batch Selection
            ...batchSelection,
            deleteSelectedRows: () => batchSelection.deleteSelectedRows(baseSetup.customConfirm, baseSetup.showToast),
            // Column Visibility & Reordering
            ...columnManager,
            // ER Diagram Module
            ...erd,
            copiedCell, isCHeld, copyToClipboard, handleCellClick,
            isDragging, fileInput, triggerFileUpload, handleFileInputChange, onDragOver, onDragLeave, onDrop,
            showFileDropdown, switchActiveFile,
            showLocalPathModal, localPathInput, registerLocalPath, confirmDeleteFile,
            openSqlConsole,
            showRowModal, isEditingRow, rowFormData, openInsertModal, openEditModal, saveRowForm, confirmDeleteRow
        };
    };

    createApp({
        directives: {
            focus: { mounted(el) { el.focus(); } }
        },
        setup: window.setupApp
    }).mount('#app');
};
})();
