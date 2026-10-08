/**
 * Base Application Setup — Shared navigation, SQL console, and profile management
 */
(function () {
    'use strict';
    const { ref, onMounted, computed, reactive, watch, nextTick } = Vue;

        window.baseAppSetup = () => {
            const isDark = ref(localStorage.getItem('theme') === 'dark');
            const showFeaturesModal = ref(false);
            
            const isOnDashboard = computed(() => {
                return window.location.pathname === window.PROFILE_ROOT;
            });

            const toggleDarkMode = () => {
                isDark.value = !isDark.value;
                localStorage.setItem('theme', isDark.value ? 'dark' : 'light');
                if (isDark.value) {
                    document.documentElement.classList.add('dark');
                } else {
                    document.documentElement.classList.remove('dark');
                }
            };

            onMounted(() => {
                if (isDark.value) {
                    document.documentElement.classList.add('dark');
                }
            });

            const showSqlPanel = ref(false);
            const initialSqlPosition = localStorage.getItem('sql_panel_position') === 'bottom' ? 'bottom' : 'right';
            const sqlPosition = ref(initialSqlPosition);
            const setSqlPosition = (pos) => {
                const targetPos = pos === 'bottom' ? 'bottom' : 'right';
                sqlPosition.value = targetPos;
                try {
                    localStorage.setItem('sql_panel_position', targetPos);
                } catch (e) {
                    console.error('Failed to save sql_panel_position to localStorage:', e);
                }
            };

            // SQL Panel Width / Height with localStorage persistence
            const getSavedSqlWidth = () => {
                try {
                    const saved = localStorage.getItem('sql_panel_width');
                    if (saved) {
                        const parsed = parseInt(saved, 10);
                        if (!isNaN(parsed) && parsed >= 300 && parsed <= 900) return parsed;
                    }
                } catch(e) {}
                return 400;
            };
            const getSavedSqlHeight = () => {
                try {
                    const saved = localStorage.getItem('sql_panel_height');
                    if (saved) {
                        const parsed = parseInt(saved, 10);
                        if (!isNaN(parsed) && parsed >= 200 && parsed <= 700) return parsed;
                    }
                } catch(e) {}
                return 360;
            };
            const sqlPanelWidth = ref(getSavedSqlWidth());
            const sqlPanelHeight = ref(getSavedSqlHeight());
            const isResizingSql = ref(false);

            const startSqlResizeRight = (e) => {
                isResizingSql.value = true;
                const startX = e.clientX;
                const startW = sqlPanelWidth.value;
                const onMove = (moveEv) => {
                    const diff = startX - moveEv.clientX;
                    const newW = Math.max(300, Math.min(window.innerWidth - 300, startW + diff));
                    sqlPanelWidth.value = newW;
                };
                const onUp = () => {
                    isResizingSql.value = false;
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                    try { localStorage.setItem('sql_panel_width', String(sqlPanelWidth.value)); } catch(e) {}
                };
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
            };

            const startSqlResizeBottom = (e) => {
                isResizingSql.value = true;
                const startY = e.clientY;
                const startH = sqlPanelHeight.value;
                const onMove = (moveEv) => {
                    const diff = startY - moveEv.clientY;
                    const newH = Math.max(200, Math.min(window.innerHeight - 150, startH + diff));
                    sqlPanelHeight.value = newH;
                };
                const onUp = () => {
                    isResizingSql.value = false;
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                    try { localStorage.setItem('sql_panel_height', String(sqlPanelHeight.value)); } catch(e) {}
                };
                document.body.style.cursor = 'row-resize';
                document.body.style.userSelect = 'none';
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
            };
            const sqlDb = ref(localStorage.getItem('last_sql_db') || '');

            // Custom minimal database selector state
            const showSqlDbDropdown = ref(false);
            const sqlDbSearch = ref('');
            const sqlDbSearchInput = ref(null);
            const sqlDbDropdownBtn = ref(null);
            const sqlDbDropdownStyles = ref({});
            const sqlDbDropdownPlacement = ref('bottom');
            const highlightedDbIndex = ref(-1);

            const updateSqlDbDropdownPosition = () => {
                if (!sqlDbDropdownBtn.value) return;
                const rect = sqlDbDropdownBtn.value.getBoundingClientRect();
                const viewportHeight = window.innerHeight;
                const viewportWidth = window.innerWidth;

                // Available vertical space
                const spaceBelow = viewportHeight - rect.bottom - 12;
                const spaceAbove = rect.top - 12;

                // Auto-flip: if space below is tight (<260px) and there is more room above, flip upwards
                const openUp = spaceBelow < 260 && spaceAbove > spaceBelow;
                sqlDbDropdownPlacement.value = openUp ? 'top' : 'bottom';

                // Strictly clamp max height to available space so it never clips against the screen boundary
                const availableSpace = openUp ? spaceAbove : spaceBelow;
                const maxMenuHeight = Math.min(380, Math.max(160, availableSpace - 8));

                // Clamp horizontal position so it stays within viewport
                const targetWidth = Math.min(Math.max(rect.width, 240), viewportWidth - 20);
                let targetLeft = rect.left;
                if (targetLeft + targetWidth > viewportWidth - 10) {
                    targetLeft = viewportWidth - targetWidth - 10;
                }
                if (targetLeft < 10) targetLeft = 10;

                const baseStyles = {
                    position: 'fixed',
                    left: `${targetLeft}px`,
                    width: `${targetWidth}px`,
                    maxHeight: `${maxMenuHeight}px`,
                    zIndex: 9999
                };

                if (openUp) {
                    baseStyles.bottom = `${viewportHeight - rect.top + 6}px`;
                    baseStyles.top = 'auto';
                } else {
                    baseStyles.top = `${rect.bottom + 6}px`;
                    baseStyles.bottom = 'auto';
                }

                sqlDbDropdownStyles.value = baseStyles;
            };

            const toggleSqlDbDropdown = () => {
                if (!showSqlDbDropdown.value) {
                    updateSqlDbDropdownPosition();
                    showSqlDbDropdown.value = true;
                    const currentIdx = filteredSqlDbList.value.findIndex(d => (d.id || d.name) === sqlDb.value || d === sqlDb.value);
                    highlightedDbIndex.value = currentIdx >= 0 ? currentIdx : 0;
                } else {
                    showSqlDbDropdown.value = false;
                }
            };

            const selectSqlDb = (dbVal) => {
                sqlDb.value = dbVal;
                showSqlDbDropdown.value = false;
                sqlDbSearch.value = '';
            };

            const scrollToHighlightedDb = () => {
                Vue.nextTick(() => {
                    const el = document.querySelector('[data-db-highlighted="true"]');
                    if (el) el.scrollIntoView({ block: 'nearest' });
                });
            };

            const handleSqlDbKeydown = (e) => {
                if (!showSqlDbDropdown.value) return;
                const list = filteredSqlDbList.value;
                if (!list.length) return;

                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    highlightedDbIndex.value = (highlightedDbIndex.value + 1) % list.length;
                    scrollToHighlightedDb();
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    highlightedDbIndex.value = (highlightedDbIndex.value - 1 + list.length) % list.length;
                    scrollToHighlightedDb();
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (highlightedDbIndex.value >= 0 && highlightedDbIndex.value < list.length) {
                        const target = list[highlightedDbIndex.value];
                        selectSqlDb(target.id || target.name || target);
                    }
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    showSqlDbDropdown.value = false;
                }
            };

            const filteredSqlDbList = computed(() => {
                const list = dbList.value || [];
                if (!sqlDbSearch.value.trim()) return list;
                const query = sqlDbSearch.value.toLowerCase().trim();
                return list.filter(db => {
                    const name = ((db && (db.original_name || db.name)) || (typeof db === 'string' ? db : '')).toLowerCase();
                    return name.includes(query);
                });
            });

            const getDbDisplayName = (dbVal) => {
                if (!dbVal) return '';
                const item = (dbList.value || []).find(d => (d && (d.id || d.name)) === dbVal || d === dbVal);
                if (item) return item.original_name || item.name || item;
                return dbVal;
            };

            watch(showSqlDbDropdown, (isOpen) => {
                if (isOpen) {
                    updateSqlDbDropdownPosition();
                    window.addEventListener('resize', updateSqlDbDropdownPosition);
                    window.addEventListener('scroll', updateSqlDbDropdownPosition, true);
                    Vue.nextTick(() => {
                        if (sqlDbSearchInput.value) sqlDbSearchInput.value.focus();
                        scrollToHighlightedDb();
                    });
                } else {
                    window.removeEventListener('resize', updateSqlDbDropdownPosition);
                    window.removeEventListener('scroll', updateSqlDbDropdownPosition, true);
                }
            });

            watch(sqlDbSearch, () => {
                highlightedDbIndex.value = 0;
                updateSqlDbDropdownPosition();
            });

            watch(sqlDb, (newDb) => {
                if (newDb) {
                    try {
                        localStorage.setItem('last_sql_db', newDb);
                    } catch (e) {}
                }
                sqlError.value = '';
                loadEditorSchema();
                fetchRecallHistory();
                if (sqlTab.value === 'history' && historyCurrentDbOnly.value) {
                    fetchHistory();
                }
            });
            const sqlQuery = ref('');
            const sqlLoading = ref(false);
            const sqlError = ref('');
            const sqlSuccess = ref(false);
            const sqlRows = ref([]);
            const sqlIsSelect = ref(false);
            const sqlAffected = ref(0);
            const sqlResultTime = ref(null);
            const sqlResultTab = ref('results');
            const sqlExplainPlan = ref(null);
            const isExplaining = ref(false);
            const sqlExplainRawView = ref(false);

            const dbList = ref([]);
            const currentTable = ref(null);

            // ---------- SQL editor (CodeMirror) + query history ----------
            const isSqliteMode = () => window.location.pathname.startsWith('/sqlite');
            const sqlTab = ref('editor');
            const sqlEditorEl = ref(null);
            const sqlSchemaInfo = ref('');
            const sqlHasSelection = ref(false);
            let sqlEditor = null;
            const schemaCache = {};

            const historyItems = ref([]);
            const historyLoading = ref(false);
            const historySearch = ref('');
            const historyStarredOnly = ref(false);
            const historyCurrentDbOnly = ref(localStorage.getItem('sql_history_db_only') === '1');
            watch(historyCurrentDbOnly, (v) => {
                try { localStorage.setItem('sql_history_db_only', v ? '1' : '0'); } catch (e) {}
            });

            const historyScope = (dbOnly) => {
                const params = new URLSearchParams();
                if (isSqliteMode()) {
                    params.set('source', 'sqlite');
                } else {
                    params.set('source', 'server');
                    params.set('profile', window.PROFILE_NAME || '');
                }
                if (dbOnly && sqlDb.value) params.set('db', sqlDb.value);
                return params;
            };

            let historyRequestId = 0;
            const fetchHistory = async () => {
                const params = historyScope(historyCurrentDbOnly.value);
                if (historySearch.value.trim()) params.set('q', historySearch.value.trim());
                if (historyStarredOnly.value) params.set('starred', '1');
                const reqId = ++historyRequestId;
                historyLoading.value = true;
                try {
                    const res = await fetch('/api/history?' + params.toString());
                    const data = await res.json();
                    if (reqId === historyRequestId && data.success) historyItems.value = data.history || [];
                } catch (e) {
                    console.error('Failed to load query history', e);
                } finally {
                    if (reqId === historyRequestId) historyLoading.value = false;
                }
            };

            // Recent queries for the current DB, used for Up/Down recall in the editor
            const fetchRecallHistory = async () => {
                if (!sqlEditor) return;
                try {
                    const params = historyScope(true);
                    params.set('limit', '100');
                    const res = await fetch('/api/history?' + params.toString());
                    const data = await res.json();
                    if (data.success) sqlEditor.setHistory((data.history || []).map(h => h.query));
                } catch (e) {}
            };

            let historySearchTimer = null;
            watch(historySearch, () => {
                clearTimeout(historySearchTimer);
                historySearchTimer = setTimeout(fetchHistory, 250);
            });
            watch([historyStarredOnly, historyCurrentDbOnly], () => fetchHistory());
            watch(sqlDb, () => { if (sqlTab.value === 'history' && historyCurrentDbOnly.value) fetchHistory(); });

            const setSqlTab = (tab) => {
                sqlTab.value = tab;
                if (tab === 'history') {
                    fetchHistory();
                } else {
                    Vue.nextTick(() => { if (sqlEditor) { sqlEditor.refresh(); sqlEditor.focus(); } });
                }
            };

            const timeAgo = (ts) => {
                const diff = Math.max(0, Date.now() / 1000 - ts);
                if (diff < 45) return 'just now';
                if (diff < 3600) return Math.round(diff / 60) + 'm ago';
                if (diff < 86400) return Math.round(diff / 3600) + 'h ago';
                if (diff < 86400 * 7) return Math.round(diff / 86400) + 'd ago';
                return new Date(ts * 1000).toLocaleDateString();
            };

            const toggleHistoryStar = async (item) => {
                const next = !item.starred;
                item.starred = next;
                try {
                    const res = await fetch('/api/history/' + item.id, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ starred: next })
                    });
                    const data = await res.json();
                    if (!data.success) throw new Error(data.error);
                    if (!next && historyStarredOnly.value) {
                        historyItems.value = historyItems.value.filter(h => h.id !== item.id);
                    }
                } catch (e) {
                    item.starred = !next;
                    showToast('Failed to update star', 'error');
                }
            };

            const deleteHistoryItem = async (item) => {
                try {
                    const res = await fetch('/api/history/' + item.id, { method: 'DELETE' });
                    const data = await res.json();
                    if (!data.success) throw new Error(data.error);
                    historyItems.value = historyItems.value.filter(h => h.id !== item.id);
                    fetchRecallHistory();
                } catch (e) {
                    showToast('Failed to delete history entry', 'error');
                }
            };

            const clearHistory = async () => {
                const scopeLabel = historyCurrentDbOnly.value && sqlDb.value ? 'this database' : 'this ' + (isSqliteMode() ? 'SQLite viewer' : 'profile');
                const confirmed = await customConfirm(
                    'Clear Query History',
                    `Remove all non-starred queries for ${scopeLabel}? Starred queries are kept.`,
                    true
                );
                if (!confirmed) return;
                try {
                    const params = historyScope(historyCurrentDbOnly.value);
                    const res = await fetch('/api/history?' + params.toString(), { method: 'DELETE' });
                    const data = await res.json();
                    if (!data.success) throw new Error(data.error);
                    showToast(`Cleared ${data.removed} quer${data.removed === 1 ? 'y' : 'ies'}`);
                    fetchHistory();
                    fetchRecallHistory();
                } catch (e) {
                    showToast('Failed to clear history', 'error');
                }
            };

            const copyHistoryItem = async (item) => {
                try {
                    await navigator.clipboard.writeText(item.query);
                    showToast('Query copied');
                } catch (e) {
                    showToast('Copy failed', 'error');
                }
            };

            const loadHistoryItem = (item, run = false) => {
                if (item.dbname && item.dbname !== sqlDb.value) {
                    const known = dbList.value.some(d => (d.id || d.name) === item.dbname);
                    if (known || !isSqliteMode()) sqlDb.value = item.dbname;
                }
                sqlQuery.value = item.query;
                setSqlTab('editor');
                if (run) Vue.nextTick(() => executeSql());
            };

            const showHistoryModal = ref(false);
            const historySearchInput = ref(null);

            const openHistoryModal = () => {
                showHistoryModal.value = true;
                fetchHistory();
                setTimeout(() => {
                    if (historySearchInput.value) historySearchInput.value.focus();
                }, 60);
            };

            const selectHistoryItem = (item) => {
                loadHistoryItem(item, false);
                showHistoryModal.value = false;
                Vue.nextTick(() => {
                    if (sqlEditor) {
                        sqlEditor.refresh();
                        sqlEditor.focus();
                    }
                });
            };

            const loadEditorSchema = async () => {
                const db = sqlDb.value;
                if (!db) {
                    if (sqlEditor) sqlEditor.setSchema({}, []);
                    sqlSchemaInfo.value = '';
                    return;
                }
                const sqlite = isSqliteMode();
                const key = (sqlite ? 'sqlite:' : 'server:') + db;
                const apiBase = window.API_BASE || (activeProfile.value ? `/api/p/${encodeURIComponent(activeProfile.value)}` : '');
                if (!schemaCache[key]) {
                    const url = sqlite
                        ? `/api/sqlite/${encodeURIComponent(db)}/schema`
                        : (apiBase ? `${apiBase}/db/${encodeURIComponent(db)}/schema` : null);
                    if (!url) return;
                    schemaCache[key] = fetch(url).then(r => r.json()).then(d => (d && d.success ? d : null)).catch(() => null);
                }
                const data = await schemaCache[key];
                if (db !== sqlDb.value) return; // DB switched while loading
                if (!data) {
                    delete schemaCache[key];
                    if (sqlEditor) sqlEditor.setSchema({}, []);
                    sqlSchemaInfo.value = '';
                    return;
                }
                if (sqlEditor) sqlEditor.setSchema(data.schema || {}, data.views || []);
                const n = Object.keys(data.schema || {}).length;
                sqlSchemaInfo.value = n ? `${n} table${n === 1 ? '' : 's'}` : '';
            };

            const invalidateEditorSchema = () => {
                const key = (isSqliteMode() ? 'sqlite:' : 'server:') + sqlDb.value;
                delete schemaCache[key];
            };

            const toast = ref({ show: false, message: '', type: 'success' });

            // Custom Confirm State
            const confirmModal = reactive({
                show: false,
                title: 'Confirm Action',
                message: 'Are you sure you want to proceed?',
                danger: false,
                onConfirm: () => {},
                onCancel: () => {}
            });

            const customConfirm = (title, message, isDanger = false) => {
                return new Promise((resolve) => {
                    confirmModal.title = title;
                    confirmModal.message = message;
                    confirmModal.danger = isDanger;
                    confirmModal.show = true;
                    confirmModal.onConfirm = () => {
                        confirmModal.show = false;
                        resolve(true);
                    };
                    confirmModal.onCancel = () => {
                        confirmModal.show = false;
                        resolve(false);
                    };
                });
            };

            const profiles = ref([]);
            const activeProfile = ref(window.PROFILE_NAME || '');
            const showProfileModal = ref(false);
            const showProfileDropdown = ref(false);
            const emptyProfile = () => ({ name: '', engine: 'mysql', host: '', port: 3306, user: '', password: '', schema: 'public' });
            const newProfile = ref(emptyProfile());
            
            const isEditingProfile = ref(false);
            const editingProfileOriginalName = ref('');

            const fetchProfiles = async () => {
                try {
                    const res = await fetch('/api/profiles');
                    const data = await res.json();
                    if (data.success) {
                        profiles.value = data.profiles;
                        if (!window.PROFILE_NAME && !activeProfile.value) activeProfile.value = '';
                    }
                } catch(e) {
                    console.error("Failed to fetch profiles");
                }
            };

            const startEditProfile = (p) => {
                isEditingProfile.value = true;
                editingProfileOriginalName.value = p.name;
                newProfile.value = { 
                    name: p.name, 
                    engine: p.engine || 'mysql',
                    host: p.host, 
                    port: p.port, 
                    user: p.user, 
                    password: '', // Don't pre-fill password for security
                    schema: p.schema || 'public'
                };
            };

            const cancelEditProfile = () => {
                isEditingProfile.value = false;
                editingProfileOriginalName.value = '';
                newProfile.value = emptyProfile();
            };

            const showEngineDropdown = ref(false);
            const setEngine = (engine) => {
                newProfile.value.engine = engine;
                handleEngineChange();
                showEngineDropdown.value = false;
            };

            const handleEngineChange = () => {
                if (newProfile.value.engine === 'postgresql') {
                    if (!newProfile.value.port || newProfile.value.port === 3306) newProfile.value.port = 5432;
                    if (!newProfile.value.user || newProfile.value.user === 'root') newProfile.value.user = 'postgres';
                } else {
                    if (!newProfile.value.port || newProfile.value.port === 5432) newProfile.value.port = 3306;
                    if (!newProfile.value.user || newProfile.value.user === 'postgres') newProfile.value.user = 'root';
                }
            };

            const handleProfileSwitch = async (name) => {
                showProfileDropdown.value = false;
                window.location.href = `/p/${encodeURIComponent(name)}/`;
            };

            const switchProfile = async () => {
                try {
                    const res = await fetch('/api/profiles/active', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: activeProfile.value })
                    });
                    const data = await res.json();
                    if (data.success) {
                        window.location.href = `/p/${encodeURIComponent(activeProfile.value)}/`;
                    } else {
                        showToast(data.error, 'error');
                    }
                } catch(e) {
                    showToast('Failed to switch profile', 'error');
                }
            };

            const createProfile = async () => {
                try {
                    const res = await fetch('/api/profiles', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(newProfile.value)
                    });
                    const data = await res.json();
                    if (data.success) {
                        showToast('Profile created successfully');
                        newProfile.value = emptyProfile();
                        fetchProfiles();
                    } else {
                        showToast(data.error, 'error');
                    }
                } catch(e) {
                    showToast('Failed to create profile', 'error');
                }
            };

            const updateProfile = async () => {
                try {
                    const res = await fetch(`/api/profiles/${editingProfileOriginalName.value}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(newProfile.value)
                    });
                    const data = await res.json();
                    if (data.success) {
                        showToast('Profile updated successfully');
                        const oldName = editingProfileOriginalName.value;
                        const newName = newProfile.value.name;
                        
                        cancelEditProfile();
                        await fetchProfiles();
                        
                        // If we renamed the active profile, the backend update_profile handles it,
                        // but we might need to reload if host/credentials changed.
                        if (oldName === activeProfile.value) {
                            window.location.href = `/p/${encodeURIComponent(newName)}/`;
                        }
                    } else {
                        showToast(data.error, 'error');
                    }
                } catch(e) {
                    showToast('Failed to update profile', 'error');
                }
            };

            const deleteProfile = async (name) => {
                const confirmed = await customConfirm(
                    'Delete Profile',
                    `Are you sure you want to permanently delete the profile "${name}"? This action cannot be undone.`,
                    true
                );
                
                if(!confirmed) return;
                
                try {
                    const res = await fetch(`/api/profiles/${name}`, { method: 'DELETE' });
                    const data = await res.json();
                    if (data.success) {
                        showToast('Profile deleted');
                        if (name === activeProfile.value) {
                            window.location.href = '/';
                        } else {
                            fetchProfiles();
                        }
                    } else {
                        showToast(data.error, 'error');
                    }
                } catch(e) {
                    showToast('Failed to delete profile', 'error');
                }
            };

            // Cmd+K State
            const showCmdK = ref(false);
            const cmdKSearch = ref('');
            const cmdKIndex = ref(0);
            const cmdKInput = ref(null);

            const filteredCmdKDbList = computed(() => {
                if(!cmdKSearch.value) return dbList.value;
                return dbList.value.filter(db => {
                    const name = (db && (db.name || db.original_name)) || (typeof db === 'string' ? db : '');
                    return name.toLowerCase().includes(cmdKSearch.value.toLowerCase());
                });
            });

            const cmdKList = ref(null);
            const cmdKNav = (dir) => {
                const max = filteredCmdKDbList.value.length; // +1 for home (index 0)
                cmdKIndex.value = (cmdKIndex.value + dir + (max + 1)) % (max + 1);
                Vue.nextTick(() => {
                    const el = document.getElementById('cmdk-item-' + cmdKIndex.value);
                    if(el) {
                        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                    }
                });
            };

            const cmdKExecute = () => {
                if(cmdKIndex.value === 0) {
                    goTo('/');
                } else {
                    const db = filteredCmdKDbList.value[cmdKIndex.value - 1];
                    if(db) {
                        const target = db.name || db.id || (typeof db === 'string' ? db : '');
                        if (target) goTo('/db/' + encodeURIComponent(target));
                    }
                }
                showCmdK.value = false;
            };

            onMounted(() => {
                document.addEventListener('keydown', (e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                        e.preventDefault();
                        showCmdK.value = true;
                        cmdKSearch.value = '';
                        cmdKIndex.value = 0;
                        setTimeout(() => { if(cmdKInput.value) cmdKInput.value.focus(); }, 50);
                    }
                    if ((e.metaKey || e.ctrlKey) && (e.key === 'h' || e.key === 'H') && !e.shiftKey && !e.altKey) {
                        if (showSqlPanel.value) {
                            e.preventDefault();
                            if (showHistoryModal.value) {
                                showHistoryModal.value = false;
                            } else {
                                openHistoryModal();
                            }
                        }
                    }
                    if (e.key === 'Escape') {
                        if (showCmdK.value) {
                            showCmdK.value = false;
                        } else if (showHistoryModal.value) {
                            showHistoryModal.value = false;
                        } else if (showSqlDbDropdown.value) {
                            showSqlDbDropdown.value = false;
                        } else if (showSqlPanel.value) {
                            showSqlPanel.value = false;
                        }
                    }
                });
            });

            const showToast = (msg, type='success') => {
                toast.value = { show: true, message: msg, type };
                setTimeout(() => toast.value.show = false, 3000);
            };

            let customNavigator = null;
            const setCustomNavigator = (fn) => {
                customNavigator = fn;
            };

            const goTo = (url) => {
                if (typeof customNavigator === 'function') {
                    customNavigator(url);
                    return;
                }
                if (window.PROFILE_NAME && url === '/') window.location.href = window.PROFILE_ROOT;
                else if (window.PROFILE_NAME && url.startsWith('/db/')) window.location.href = window.PROFILE_ROOT + url.slice(1);
                else window.location.href = url;
            };

            const currentEngine = computed(() => {
                if (isSqliteMode()) return 'sqlite';
                const p = profiles.value.find(x => x.name === (activeProfile.value || window.PROFILE_NAME));
                return p ? (p.engine || 'mysql') : 'mysql';
            });

            const sqlDiagnostics = ref([]);
            const topDiagnostic = computed(() => (sqlDiagnostics.value && sqlDiagnostics.value.length > 0 ? sqlDiagnostics.value[0] : null));

            const applySqlQuickFix = (fix) => {
                if (sqlEditor && sqlEditor.applyQuickFix) {
                    sqlEditor.applyQuickFix(fix);
                }
            };

            const initSqlEditor = () => {
                if (sqlEditor || !sqlEditorEl.value || !window.SqlEditor) return;
                sqlEditor = window.SqlEditor.create(sqlEditorEl.value, {
                    value: sqlQuery.value,
                    dialect: currentEngine.value,
                    placeholder: 'SELECT * FROM table_name LIMIT 50;',
                    onChange: (val) => {
                        sqlQuery.value = val;
                    },
                    onDiagnostics: (diags) => {
                        sqlDiagnostics.value = diags || [];
                    },
                    onRun: () => {
                        executeSql();
                    }
                });
                sqlEditor.cm.on('cursorActivity', () => {
                    sqlHasSelection.value = !!(sqlEditor && sqlEditor.getSelection().trim());
                });
                sqlEditor.setDialect(currentEngine.value);
                if (currentTable.value) sqlEditor.setDefaultTable(currentTable.value);
                loadEditorSchema();
                fetchRecallHistory();
            };

            watch(sqlQuery, (val) => {
                if (sqlEditor && sqlEditor.getValue() !== (val || '')) {
                    sqlEditor.setValue(val || '');
                }
            });

            watch(currentEngine, (eng) => {
                if (sqlEditor) sqlEditor.setDialect(eng);
            });

            watch(currentTable, (tbl) => {
                if (sqlEditor) sqlEditor.setDefaultTable(tbl);
            });

            watch([sqlPosition, sqlPanelWidth, sqlPanelHeight], () => {
                if (sqlEditor) {
                    Vue.nextTick(() => sqlEditor.refresh());
                }
            });

            const executeSql = async () => {
                const selection = sqlEditor ? sqlEditor.getSelection().trim() : '';
                const queryToRun = (selection || sqlQuery.value || '').trim();
                if (!queryToRun) return;

                // Auto-detect USE statement if query declares database
                const useMatch = queryToRun.match(/^\s*USE\s+[`"]?([a-zA-Z0-9_$]+)[`"]?/i);
                if (useMatch) {
                    sqlDb.value = useMatch[1];
                } else if (!sqlDb.value && !window.location.pathname.startsWith('/sqlite')) {
                    if (typeof DBNAME !== 'undefined' && DBNAME) {
                        sqlDb.value = DBNAME;
                    } else if (dbList.value && dbList.value.length === 1) {
                        sqlDb.value = dbList.value[0].name || dbList.value[0].id || '';
                    }
                }

                sqlLoading.value = true;
                sqlResultTab.value = 'results';
                sqlError.value = '';
                sqlSuccess.value = false;
                const start = performance.now();

                try {
                    const isSqlite = window.location.pathname.startsWith('/sqlite');
                    const url = isSqlite ? `/api/sqlite/${encodeURIComponent(sqlDb.value)}/sql` : (window.API_BASE + '/sql');
                    const body = isSqlite ? { query: queryToRun } : { dbname: sqlDb.value, query: queryToRun };

                    const res = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body)
                    });
                    const data = await res.json();

                    if(data.error) {
                        sqlError.value = data.error;
                    } else {
                        sqlSuccess.value = true;
                        sqlIsSelect.value = data.is_select;
                        if(data.is_select) {
                            sqlRows.value = data.rows || [];
                        } else {
                            sqlAffected.value = data.affected_rows !== undefined ? data.affected_rows : 0;
                        }
                        if (data.dbname && data.dbname !== sqlDb.value) {
                            sqlDb.value = data.dbname;
                            if (!dbList.value.some(d => (d.name || d.id) === data.dbname)) {
                                dbList.value.push({ name: data.dbname });
                            }
                        }

                        // Invalidate autocomplete schema cache if DDL was run
                        if (/^\s*(CREATE|ALTER|DROP|TRUNCATE)\b/i.test(queryToRun)) {
                            invalidateEditorSchema();
                            loadEditorSchema();
                        }
                    }
                } catch(e) {
                    sqlError.value = "Network error: " + (e.message || e);
                } finally {
                    sqlLoading.value = false;
                    sqlResultTime.value = Math.round(performance.now() - start);
                    fetchRecallHistory();
                    if (sqlTab.value === 'history') fetchHistory();
                }
            };

            const explainSql = async () => {
                const selection = sqlEditor ? sqlEditor.getSelection().trim() : '';
                const queryToRun = (selection || sqlQuery.value || '').trim();
                if (!queryToRun) return;

                if (!sqlDb.value && !window.location.pathname.startsWith('/sqlite')) {
                    if (typeof DBNAME !== 'undefined' && DBNAME) {
                        sqlDb.value = DBNAME;
                    } else if (dbList.value && dbList.value.length === 1) {
                        sqlDb.value = dbList.value[0].name || dbList.value[0].id || '';
                    }
                }

                sqlLoading.value = true;
                isExplaining.value = true;
                sqlError.value = '';
                const start = performance.now();

                try {
                    const isSqlite = window.location.pathname.startsWith('/sqlite');
                    const url = isSqlite ? `/api/sqlite/${encodeURIComponent(sqlDb.value)}/sql/explain` : (window.API_BASE + '/sql/explain');
                    const body = isSqlite ? { query: queryToRun } : { dbname: sqlDb.value, query: queryToRun };

                    const res = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body)
                    });
                    const data = await res.json();
                    if (data.error) {
                        sqlError.value = data.error;
                        sqlResultTab.value = 'results';
                    } else {
                        sqlExplainPlan.value = data.plan;
                        sqlResultTab.value = 'explain';
                    }
                } catch(e) {
                    sqlError.value = "Network error: " + (e.message || e);
                    sqlResultTab.value = 'results';
                } finally {
                    sqlLoading.value = false;
                    isExplaining.value = false;
                    sqlResultTime.value = Math.round(performance.now() - start);
                }
            };

            const normalizeDbList = (list) => {
                if (!Array.isArray(list)) return [];
                return list.map(item => {
                    if (typeof item === 'string') return { name: item };
                    return item;
                });
            };

            // fetch db list for sidebar
            const fetchDbList = async () => {
                try {
                    if(window.INITIAL_DATABASES) {
                        dbList.value = normalizeDbList(window.INITIAL_DATABASES);
                    } else {
                        if (!window.API_BASE) return;
                        const res = await fetch(window.API_BASE + '/dbs/list');
                        const data = await res.json();
                        if(data.success) {
                            dbList.value = (data.databases || []).map(name => ({ name }));
                        }
                    }
                } catch(e) {
                    console.error("Failed to fetch databases", e);
                }
            };

            watch(dbList, (newList) => {
                if (newList && newList.length > 0) {
                    const isSqlite = window.location.pathname.startsWith('/sqlite');
                    if (isSqlite) return;
                    if (typeof DBNAME !== 'undefined' && DBNAME) {
                        sqlDb.value = DBNAME;
                        return;
                    }
                    const exists = newList.some(d => (d.name || d.id) === sqlDb.value);
                    if (!exists && newList.length > 0) {
                        sqlDb.value = newList[0].name || newList[0].id || '';
                    }
                }
            }, { immediate: true });

            watch(showSqlPanel, (isOpen) => {
                if (isOpen) {
                    const isSqlite = window.location.pathname.startsWith('/sqlite');
                    if (!isSqlite) {
                        if (typeof DBNAME !== 'undefined' && DBNAME) {
                            sqlDb.value = DBNAME;
                        } else if (!sqlDb.value && dbList.value && dbList.value.length > 0) {
                            sqlDb.value = dbList.value[0].name || dbList.value[0].id || '';
                        }
                    }
                    Vue.nextTick(() => {
                        initSqlEditor();
                        if (sqlEditor) {
                            sqlEditor.refresh();
                            if (sqlTab.value === 'editor') sqlEditor.focus();
                        }
                        loadEditorSchema();
                        fetchRecallHistory();
                    });
                }
            });

            onMounted(() => {
                fetchProfiles();
                fetchDbList();
                Vue.nextTick(() => {
                    initSqlEditor();
                });
            });

            return {
                isDark, toggleDarkMode, showFeaturesModal, isOnDashboard,
                showSqlPanel, sqlPosition, setSqlPosition, sqlPanelWidth, sqlPanelHeight, isResizingSql, startSqlResizeRight, startSqlResizeBottom, sqlDb, sqlQuery, sqlLoading, sqlError, sqlSuccess, sqlRows, sqlIsSelect, sqlAffected, sqlResultTime, dbList, currentTable, executeSql,
                sqlResultTab, sqlExplainPlan, isExplaining, sqlExplainRawView, explainSql,
                sqlTab, setSqlTab, sqlEditorEl, sqlSchemaInfo, sqlHasSelection,
                sqlDiagnostics, topDiagnostic, applySqlQuickFix,
                showSqlDbDropdown, sqlDbSearch, sqlDbSearchInput, sqlDbDropdownBtn, sqlDbDropdownStyles, sqlDbDropdownPlacement, highlightedDbIndex, handleSqlDbKeydown, toggleSqlDbDropdown, filteredSqlDbList, getDbDisplayName, selectSqlDb,
                showHistoryModal, historySearchInput, openHistoryModal, selectHistoryItem,
                historyItems, historyLoading, historySearch, historyStarredOnly, historyCurrentDbOnly,
                fetchHistory, toggleHistoryStar, deleteHistoryItem, clearHistory, copyHistoryItem, loadHistoryItem, timeAgo,
                loadEditorSchema, invalidateEditorSchema,
                showCmdK, cmdKSearch, cmdKIndex, cmdKInput, cmdKList, filteredCmdKDbList, cmdKNav, cmdKExecute,
                toast, showToast, goTo, setCustomNavigator,
                profiles, activeProfile, showProfileModal, showProfileDropdown, showEngineDropdown, setEngine, newProfile, isEditingProfile, editingProfileOriginalName, fetchProfiles, switchProfile, handleProfileSwitch, handleEngineChange, createProfile, updateProfile, deleteProfile, startEditProfile, cancelEditProfile,
                confirmModal, customConfirm
            };
        };

})();
