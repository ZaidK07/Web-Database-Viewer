import os
import sqlite3
from .pool import global_pool


class SQLiteAdapter:
    engine = 'sqlite'

    def __init__(self, file_path):
        self.file_path = file_path
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"SQLite file not found: {file_path}")

    def connect(self, dict_rows=True, pooled=True):
        if not pooled:
            conn = sqlite3.connect(self.file_path, timeout=15)
            conn.execute('PRAGMA busy_timeout = 5000')
            if dict_rows:
                conn.row_factory = sqlite3.Row
            return conn

        pool_key = ('sqlite', self.file_path, dict_rows)

        def creator():
            conn = sqlite3.connect(self.file_path, timeout=15)
            conn.execute('PRAGMA busy_timeout = 5000')
            if dict_rows:
                conn.row_factory = sqlite3.Row
            return conn

        def validator(conn):
            try:
                conn.execute('SELECT 1')
                return True
            except Exception:
                return False

        return global_pool.get_connection(pool_key, creator, validator)

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

    def get_schema(self, conn, database, tables, views):
        objects = [*tables, *views]
        schema = {}
        cursor = conn.cursor()
        for table in objects:
            cursor.execute(f"PRAGMA table_info({self.quote(table)})")
            rows = cursor.fetchall()
            cols = []
            pks = []
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
                if is_pk:
                    pks.append(name)

            cursor.execute(f"PRAGMA foreign_key_list({self.quote(table)})")
            fk_rows = cursor.fetchall()
            fks = {}
            for r in fk_rows:
                from_col = r['from'] if isinstance(r, sqlite3.Row) else r[3]
                to_table = r['table'] if isinstance(r, sqlite3.Row) else r[2]
                to_col = r['to'] if isinstance(r, sqlite3.Row) else r[4]
                fks[from_col] = {'table': to_table, 'column': to_col}

            schema[table] = {
                'columns': cols,
                'primary_keys': pks,
                'foreign_keys': fks,
            }
        return schema

    def search_expression(self, column):
        return f'CAST({self.quote(column)} AS TEXT) LIKE ?'

    def insert_suffix(self, primary_keys):
        return ''

    @staticmethod
    def inserted_id(cursor, primary_keys):
        return cursor.lastrowid

    def dump_table_stream(self, table):
        conn = sqlite3.connect(self.file_path, timeout=15)
        conn.execute('PRAGMA busy_timeout = 5000')

        def generate():
            try:
                cursor = conn.cursor()
                cursor.execute("SELECT sql FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?", (table,))
                row = cursor.fetchone()
                if not row or not row[0]:
                    raise LookupError(f"Table '{table}' not found")
                create_sql = row[0]

                buffer = [
                    f"-- SQLite Table Dump: {table}\n",
                    "BEGIN TRANSACTION;\n",
                    f"DROP TABLE IF EXISTS {self.quote(table)};\n",
                    f"{create_sql};\n"
                ]
                yield "".join(buffer).encode('utf-8')
                buffer = []
                buf_len = 0

                cursor.execute(f"SELECT * FROM {self.quote(table)}")
                cols = [desc[0] for desc in cursor.description] if cursor.description else []
                quoted_cols = ", ".join(self.quote(c) for c in cols)
                table_quoted = self.quote(table)

                while True:
                    batch = cursor.fetchmany(500)
                    if not batch:
                        break
                    for r in batch:
                        vals = []
                        for v in r:
                            if v is None:
                                vals.append("NULL")
                            elif isinstance(v, (int, float)):
                                vals.append(str(v))
                            elif isinstance(v, (bytes, bytearray)):
                                vals.append(f"X'{v.hex()}'")
                            else:
                                escaped = str(v).replace("'", "''")
                                vals.append(f"'{escaped}'")
                        line = f"INSERT INTO {table_quoted} ({quoted_cols}) VALUES ({', '.join(vals)});\n"
                        buffer.append(line)
                        buf_len += len(line)
                        if buf_len >= 64 * 1024:
                            yield "".join(buffer).encode('utf-8')
                            buffer = []
                            buf_len = 0

                buffer.append("COMMIT;\n")
                yield "".join(buffer).encode('utf-8')
            finally:
                conn.close()

        return generate()

    def dump_stream(self, database=None, table=None):
        if table:
            return self.dump_table_stream(table)

        conn = sqlite3.connect(self.file_path, timeout=15)
        conn.execute('PRAGMA busy_timeout = 5000')

        def generate():
            try:
                buffer = []
                buf_len = 0
                for line in conn.iterdump():
                    buffer.append(line)
                    buffer.append('\n')
                    buf_len += len(line) + 1
                    if buf_len >= 64 * 1024:
                        yield "".join(buffer).encode('utf-8')
                        buffer = []
                        buf_len = 0
                if buffer:
                    yield "".join(buffer).encode('utf-8')
            finally:
                conn.close()

        return generate()

    def explain_query(self, conn, query):
        clean_query = query.strip().rstrip(';')
        cursor = conn.cursor()
        cursor.execute(f"EXPLAIN QUERY PLAN {clean_query}")
        rows = cursor.fetchall()
        steps = []
        for r in rows:
            if isinstance(r, (dict, sqlite3.Row)):
                r_id = r['id'] if 'id' in r else r[0]
                parent = r['parent'] if 'parent' in r else r[1]
                detail = r['detail'] if 'detail' in r else r[3]
            else:
                r_id = r[0] if len(r) > 0 else 0
                parent = r[1] if len(r) > 1 else 0
                detail = r[3] if len(r) > 3 else (r[2] if len(r) > 2 else '')
            steps.append({'id': r_id, 'parent': parent, 'detail': detail})
        return steps
