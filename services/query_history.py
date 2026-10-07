"""Persistent SQL console query history, stored in the app's local profiles.db.

Entries are scoped by ``source`` ('server' for MySQL/PostgreSQL profiles, 'sqlite'
for standalone SQLite files), ``profile_name`` and ``dbname``. Re-running the exact
same query in the same scope bumps the existing entry instead of adding a duplicate.
"""
import time

from services.profiles import get_sqlite_conn

MAX_ENTRIES_PER_SCOPE = 500
MAX_QUERY_LENGTH = 100_000
VALID_SOURCES = ('server', 'sqlite')


def init_history_table():
    with get_sqlite_conn() as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS query_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source TEXT NOT NULL,
                profile_name TEXT NOT NULL DEFAULT '',
                dbname TEXT NOT NULL DEFAULT '',
                db_label TEXT NOT NULL DEFAULT '',
                query TEXT NOT NULL,
                executed_at REAL NOT NULL,
                duration_ms INTEGER,
                row_count INTEGER,
                is_select INTEGER NOT NULL DEFAULT 0,
                success INTEGER NOT NULL DEFAULT 1,
                error TEXT,
                starred INTEGER NOT NULL DEFAULT 0,
                run_count INTEGER NOT NULL DEFAULT 1
            )
        ''')
        conn.execute('''
            CREATE INDEX IF NOT EXISTS idx_query_history_scope
            ON query_history (source, profile_name, executed_at DESC)
        ''')


def _row_to_entry(row):
    entry = dict(row)
    entry['is_select'] = bool(entry['is_select'])
    entry['success'] = bool(entry['success'])
    entry['starred'] = bool(entry['starred'])
    return entry


def record_query(source, profile_name, dbname, query, *, db_label='', duration_ms=None,
                 row_count=None, is_select=False, success=True, error=None):
    """Store an executed query. Never raises: history must not break query execution."""
    try:
        query = (query or '').strip()
        if not query or source not in VALID_SOURCES:
            return
        query = query[:MAX_QUERY_LENGTH]
        profile_name = profile_name or ''
        dbname = dbname or ''
        error = str(error)[:2000] if error else None
        now = time.time()
        with get_sqlite_conn() as conn:
            existing = conn.execute('''
                SELECT id FROM query_history
                WHERE source = ? AND profile_name = ? AND dbname = ? AND query = ?
                ORDER BY executed_at DESC LIMIT 1
            ''', (source, profile_name, dbname, query)).fetchone()
            if existing:
                conn.execute('''
                    UPDATE query_history
                    SET executed_at = ?, duration_ms = ?, row_count = ?, is_select = ?,
                        success = ?, error = ?, db_label = ?, run_count = run_count + 1
                    WHERE id = ?
                ''', (now, duration_ms, row_count, int(bool(is_select)), int(bool(success)),
                      error, db_label or '', existing['id']))
            else:
                conn.execute('''
                    INSERT INTO query_history (source, profile_name, dbname, db_label, query,
                        executed_at, duration_ms, row_count, is_select, success, error)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (source, profile_name, dbname, db_label or '', query, now, duration_ms,
                      row_count, int(bool(is_select)), int(bool(success)), error))
            # Trim old, non-starred entries for this scope
            conn.execute('''
                DELETE FROM query_history
                WHERE source = ? AND profile_name = ? AND starred = 0 AND id NOT IN (
                    SELECT id FROM query_history
                    WHERE source = ? AND profile_name = ?
                    ORDER BY executed_at DESC LIMIT ?
                )
            ''', (source, profile_name, source, profile_name, MAX_ENTRIES_PER_SCOPE))
    except Exception as exc:  # pragma: no cover - defensive
        print(f'Failed to record query history: {exc}')


def list_history(source, profile_name='', dbname=None, search=None, starred_only=False, limit=200):
    clauses = ['source = ?', 'profile_name = ?']
    params = [source, profile_name or '']
    if dbname:
        clauses.append('dbname = ?')
        params.append(dbname)
    if search:
        clauses.append('query LIKE ?')
        params.append(f'%{search}%')
    if starred_only:
        clauses.append('starred = 1')
    limit = max(1, min(int(limit or 200), 1000))
    with get_sqlite_conn() as conn:
        rows = conn.execute(f'''
            SELECT * FROM query_history
            WHERE {' AND '.join(clauses)}
            ORDER BY executed_at DESC
            LIMIT ?
        ''', (*params, limit)).fetchall()
    return [_row_to_entry(r) for r in rows]


def set_starred(entry_id, starred):
    with get_sqlite_conn() as conn:
        cur = conn.execute('UPDATE query_history SET starred = ? WHERE id = ?',
                           (int(bool(starred)), entry_id))
        return cur.rowcount > 0


def delete_entry(entry_id):
    with get_sqlite_conn() as conn:
        cur = conn.execute('DELETE FROM query_history WHERE id = ?', (entry_id,))
        return cur.rowcount > 0


def clear_history(source, profile_name='', dbname=None, keep_starred=True):
    clauses = ['source = ?', 'profile_name = ?']
    params = [source, profile_name or '']
    if dbname:
        clauses.append('dbname = ?')
        params.append(dbname)
    if keep_starred:
        clauses.append('starred = 0')
    with get_sqlite_conn() as conn:
        cur = conn.execute(f"DELETE FROM query_history WHERE {' AND '.join(clauses)}", params)
        return cur.rowcount
