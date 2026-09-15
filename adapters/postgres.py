import os
import subprocess

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:
    psycopg = None
    dict_row = None


class PostgreSQLAdapter:
    engine = 'postgresql'

    def __init__(self, profile):
        if psycopg is None:
            raise RuntimeError('PostgreSQL support is not installed. Run: pip install psycopg[binary]')
        self.profile = profile
        self.schema = profile.get('schema') or 'public'

    def connect(self, database=None, admin=False, dict_rows=True):
        dbname = database or self.profile.get('maintenance_database') or 'postgres'
        kwargs = {
            'host': self.profile['host'], 'port': self.profile['port'],
            'user': self.profile['user'], 'password': self.profile['password'],
            'dbname': dbname,
        }
        if dict_rows:
            kwargs['row_factory'] = dict_row
        if self.profile.get('sslmode'):
            kwargs['sslmode'] = self.profile['sslmode']
        return psycopg.connect(**kwargs)

    @staticmethod
    def quote(name):
        return '"' + str(name).replace('"', '""') + '"'

    def table_ref(self, table):
        return f'{self.quote(self.schema)}.{self.quote(table)}'

    def list_databases(self):
        with self.connect() as conn, conn.cursor() as cursor:
            cursor.execute('SELECT datname FROM pg_database WHERE datallowconn ORDER BY datname')
            return [row['datname'] for row in cursor.fetchall()]

    def create_database(self, name):
        with self.connect(dict_rows=False) as conn:
            conn.autocommit = True
            with conn.cursor() as cursor:
                cursor.execute(f'CREATE DATABASE {self.quote(name)}')

    def drop_database(self, name):
        with self.connect(dict_rows=False) as conn:
            conn.autocommit = True
            with conn.cursor() as cursor:
                cursor.execute(f'DROP DATABASE {self.quote(name)}')

    def list_tables(self, conn):
        with conn.cursor() as cursor:
            cursor.execute('''SELECT table_name FROM information_schema.tables
                              WHERE table_schema = %s AND table_type = 'BASE TABLE'
                              ORDER BY table_name''', (self.schema,))
            return [row['table_name'] for row in cursor.fetchall()]

    def list_views(self, conn):
        with conn.cursor() as cursor:
            cursor.execute('''SELECT table_name FROM information_schema.tables
                              WHERE table_schema = %s AND table_type = 'VIEW'
                              ORDER BY table_name''', (self.schema,))
            return [row['table_name'] for row in cursor.fetchall()]

    def columns(self, conn, table):
        with conn.cursor() as cursor:
            cursor.execute('''
                SELECT c.column_name AS "Field",
                       pg_catalog.format_type(a.atttypid, a.atttypmod) AS "Type",
                       CASE WHEN c.is_nullable = 'YES' THEN 'YES' ELSE 'NO' END AS "Null",
                       CASE WHEN EXISTS (
                           SELECT 1
                           FROM information_schema.table_constraints ptc
                           JOIN information_schema.key_column_usage pkcu
                             ON ptc.constraint_name = pkcu.constraint_name
                            AND ptc.constraint_schema = pkcu.constraint_schema
                           WHERE ptc.constraint_type = 'PRIMARY KEY'
                             AND ptc.table_schema = c.table_schema
                             AND ptc.table_name = c.table_name
                             AND pkcu.column_name = c.column_name
                       ) THEN 'PRI' ELSE '' END AS "Key",
                       c.column_default AS "Default",
                       CASE WHEN c.is_identity = 'YES' OR c.column_default LIKE 'nextval(%%' THEN 'auto_increment' ELSE '' END AS "Extra"
                FROM information_schema.columns c
                JOIN pg_catalog.pg_namespace n ON n.nspname = c.table_schema
                JOIN pg_catalog.pg_class cl ON cl.relnamespace = n.oid AND cl.relname = c.table_name
                JOIN pg_catalog.pg_attribute a ON a.attrelid = cl.oid AND a.attname = c.column_name
                WHERE c.table_schema = %s AND c.table_name = %s
                ORDER BY c.ordinal_position
            ''', (self.schema, table))
            return list(cursor.fetchall())

    def primary_keys(self, conn, table):
        with conn.cursor() as cursor:
            cursor.execute('''
                SELECT kcu.column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name AND tc.constraint_schema = kcu.constraint_schema
                WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = %s AND tc.table_name = %s
                ORDER BY kcu.ordinal_position
            ''', (self.schema, table))
            return [row['column_name'] for row in cursor.fetchall()]

    def foreign_keys(self, conn, database, table):
        with conn.cursor() as cursor:
            cursor.execute('''
                SELECT kcu.column_name, ccu.table_name AS foreign_table_name,
                       ccu.column_name AS foreign_column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name AND tc.constraint_schema = kcu.constraint_schema
                JOIN information_schema.constraint_column_usage ccu
                  ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema
                WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = %s AND tc.table_name = %s
            ''', (self.schema, table))
            return {row['column_name']: {'table': row['foreign_table_name'],
                    'column': row['foreign_column_name']} for row in cursor.fetchall()}

    def get_schema(self, conn, database, tables, views):
        objects = set(tables) | set(views)
        schema = {obj: {'columns': [], 'primary_keys': [], 'foreign_keys': {}} for obj in objects}
        if not objects:
            return schema

        with conn.cursor() as cursor:
            # 1. Bulk columns query
            cursor.execute('''
                SELECT c.table_name,
                       c.column_name AS "Field",
                       pg_catalog.format_type(a.atttypid, a.atttypmod) AS "Type",
                       CASE WHEN c.is_nullable = 'YES' THEN 'YES' ELSE 'NO' END AS "Null",
                       CASE WHEN EXISTS (
                           SELECT 1
                           FROM information_schema.table_constraints ptc
                           JOIN information_schema.key_column_usage pkcu
                             ON ptc.constraint_name = pkcu.constraint_name
                            AND ptc.constraint_schema = pkcu.constraint_schema
                           WHERE ptc.constraint_type = 'PRIMARY KEY'
                             AND ptc.table_schema = c.table_schema
                             AND ptc.table_name = c.table_name
                             AND pkcu.column_name = c.column_name
                       ) THEN 'PRI' ELSE '' END AS "Key",
                       c.column_default AS "Default",
                       CASE WHEN c.is_identity = 'YES' OR c.column_default LIKE 'nextval(%%' THEN 'auto_increment' ELSE '' END AS "Extra"
                FROM information_schema.columns c
                JOIN pg_catalog.pg_namespace n ON n.nspname = c.table_schema
                JOIN pg_catalog.pg_class cl ON cl.relnamespace = n.oid AND cl.relname = c.table_name
                JOIN pg_catalog.pg_attribute a ON a.attrelid = cl.oid AND a.attname = c.column_name
                WHERE c.table_schema = %s
                ORDER BY c.table_name, c.ordinal_position
            ''', (self.schema,))
            for row in cursor.fetchall():
                tbl = row['table_name']
                if tbl in schema:
                    schema[tbl]['columns'].append({
                        'Field': row['Field'],
                        'Type': row['Type'],
                        'Null': row['Null'],
                        'Key': row['Key'],
                        'Default': row['Default'],
                        'Extra': row['Extra'],
                    })

            # 2. Bulk primary keys query
            cursor.execute('''
                SELECT tc.table_name, kcu.column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name AND tc.constraint_schema = kcu.constraint_schema
                WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = %s
                ORDER BY tc.table_name, kcu.ordinal_position
            ''', (self.schema,))
            for row in cursor.fetchall():
                tbl = row['table_name']
                if tbl in schema:
                    schema[tbl]['primary_keys'].append(row['column_name'])

            # 3. Bulk foreign keys query
            cursor.execute('''
                SELECT tc.table_name, kcu.column_name, ccu.table_name AS foreign_table_name,
                       ccu.column_name AS foreign_column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name AND tc.constraint_schema = kcu.constraint_schema
                JOIN information_schema.constraint_column_usage ccu
                  ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema
                WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = %s
            ''', (self.schema,))
            for row in cursor.fetchall():
                tbl = row['table_name']
                if tbl in schema:
                    schema[tbl]['foreign_keys'][row['column_name']] = {
                        'table': row['foreign_table_name'],
                        'column': row['foreign_column_name']
                    }

        return schema

    def search_expression(self, column):
        return f'CAST({self.quote(column)} AS TEXT) ILIKE %s'

    def insert_suffix(self, primary_keys):
        return f' RETURNING {self.quote(primary_keys[0])}' if primary_keys else ''

    @staticmethod
    def inserted_id(cursor, primary_keys):
        if not primary_keys or not cursor.description:
            return None
        row = cursor.fetchone()
        return row[primary_keys[0]] if row else None

    def _cli_env(self):
        env = os.environ.copy()
        if self.profile.get('password'):
            env['PGPASSWORD'] = self.profile['password']
        if self.profile.get('sslmode'):
            env['PGSSLMODE'] = self.profile['sslmode']
        return env

    def dump_command(self, database, path):
        cmd = ['pg_dump', '-h', self.profile['host'], '-p', str(self.profile['port']),
               '-U', self.profile['user'], '--no-owner', '--no-privileges', database]
        with open(path, 'w', encoding='utf-8') as output:
            subprocess.run(cmd, stdout=output, check=True, stderr=subprocess.PIPE, env=self._cli_env())

    def import_command(self, database, path):
        cmd = ['psql', '-X', '-v', 'ON_ERROR_STOP=1', '-h', self.profile['host'],
               '-p', str(self.profile['port']), '-U', self.profile['user'], '-d', database]
        with open(path, encoding='utf-8') as source:
            subprocess.run(cmd, stdin=source, check=True, stderr=subprocess.PIPE, env=self._cli_env())
