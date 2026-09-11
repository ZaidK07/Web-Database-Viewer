import os
import sqlite3


class SQLiteAdapter:
    engine = 'sqlite'

    def __init__(self, file_path):
        self.file_path = file_path
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"SQLite file not found: {file_path}")

    def connect(self, dict_rows=True):
        conn = sqlite3.connect(self.file_path)
        if dict_rows:
            conn.row_factory = sqlite3.Row
        return conn

    @staticmethod
    def quote(name):
        return '"' + str(name).replace('"', '""') + '"'

    def table_ref(self, table):
        return self.quote(table)

    def list_tables(self, conn=None):
        should_close = False
        if conn is None:
            conn = self.connect()
            should_close = True
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT name FROM sqlite_master
                WHERE type='table' AND name NOT LIKE 'sqlite_%'
                ORDER BY name
            """)
            return [row['name'] if isinstance(row, sqlite3.Row) else row[0] for row in cursor.fetchall()]
        finally:
            if should_close:
                conn.close()

    def list_views(self, conn=None):
        should_close = False
        if conn is None:
            conn = self.connect()
            should_close = True
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT name FROM sqlite_master
                WHERE type='view'
                ORDER BY name
            """)
            return [row['name'] if isinstance(row, sqlite3.Row) else row[0] for row in cursor.fetchall()]
        finally:
            if should_close:
                conn.close()

    def columns(self, conn, table):
        cursor = conn.cursor()
        # PRAGMA table_info returns: cid, name, type, notnull, dflt_value, pk
        cursor.execute(f"PRAGMA table_info({self.quote(table)})")
        rows = cursor.fetchall()
        cols = []
        for r in rows:
            is_pk = bool(r['pk'] if isinstance(r, sqlite3.Row) else r[5])
            name = r['name'] if isinstance(r, sqlite3.Row) else r[1]
            ctype = r['type'] if isinstance(r, sqlite3.Row) else r[2]
            notnull = r['notnull'] if isinstance(r, sqlite3.Row) else r[3]
            dflt = r['dflt_value'] if isinstance(r, sqlite3.Row) else r[4]

            cols.append({
                'Field': name,
                'Type': ctype or 'TEXT',
                'Null': 'NO' if notnull else 'YES',
                'Key': 'PRI' if is_pk else '',
                'Default': dflt,
                'Extra': 'auto_increment' if (is_pk and 'INTEGER' in (ctype or '').upper()) else ''
            })
        return cols

    def primary_keys(self, conn, table):
        cursor = conn.cursor()
        cursor.execute(f"PRAGMA table_info({self.quote(table)})")
        rows = cursor.fetchall()
        pks = []
        for r in rows:
            is_pk = bool(r['pk'] if isinstance(r, sqlite3.Row) else r[5])
            name = r['name'] if isinstance(r, sqlite3.Row) else r[1]
            if is_pk:
                pks.append(name)
        return pks

    def foreign_keys(self, conn, database, table):
        cursor = conn.cursor()
        # PRAGMA foreign_key_list(table): id, seq, table, from, to, on_update, on_delete, match
        cursor.execute(f"PRAGMA foreign_key_list({self.quote(table)})")
        rows = cursor.fetchall()
        fks = {}
        for r in rows:
            from_col = r['from'] if isinstance(r, sqlite3.Row) else r[3]
            to_table = r['table'] if isinstance(r, sqlite3.Row) else r[2]
            to_col = r['to'] if isinstance(r, sqlite3.Row) else r[4]
            fks[from_col] = {'table': to_table, 'column': to_col}
        return fks

    def search_expression(self, column):
        return f'CAST({self.quote(column)} AS TEXT) LIKE ?'

    def insert_suffix(self, primary_keys):
        return ''

    @staticmethod
    def inserted_id(cursor, primary_keys):
        return cursor.lastrowid
