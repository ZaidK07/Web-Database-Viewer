import os
import subprocess
import pymysql


class MySQLAdapter:
    engine = 'mysql'

    def __init__(self, profile):
        self.profile = profile

    def connect(self, database=None, admin=False, dict_rows=True):
        config = {k: self.profile[k] for k in ('host', 'port', 'user', 'password')}
        if database:
            config['database'] = database
        if dict_rows:
            config['cursorclass'] = pymysql.cursors.DictCursor
        return pymysql.connect(**config)

    @staticmethod
    def quote(name):
        return '`' + str(name).replace('`', '``') + '`'

    def table_ref(self, table):
        return self.quote(table)

    def list_databases(self):
        with self.connect(dict_rows=False) as conn, conn.cursor() as cursor:
            cursor.execute('SHOW DATABASES')
            return [row[0] for row in cursor.fetchall()]

    def create_database(self, name):
        with self.connect(dict_rows=False) as conn, conn.cursor() as cursor:
            cursor.execute(f'CREATE DATABASE {self.quote(name)}')

    def drop_database(self, name):
        with self.connect(dict_rows=False) as conn, conn.cursor() as cursor:
            cursor.execute(f'DROP DATABASE {self.quote(name)}')

    def list_tables(self, conn):
        with conn.cursor() as cursor:
            cursor.execute('SHOW TABLES')
            return [next(iter(row.values())) for row in cursor.fetchall()]

    def list_views(self, conn):
        return []

    def columns(self, conn, table):
        with conn.cursor() as cursor:
            cursor.execute(f'SHOW COLUMNS FROM {self.table_ref(table)}')
            return list(cursor.fetchall())

    def primary_keys(self, conn, table):
        with conn.cursor() as cursor:
            cursor.execute(f'SHOW KEYS FROM {self.table_ref(table)} WHERE Key_name = %s', ('PRIMARY',))
            return [row['Column_name'] for row in cursor.fetchall()]

    def foreign_keys(self, conn, database, table):
        with conn.cursor() as cursor:
            cursor.execute('''
                SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
                FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
                WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s
                  AND REFERENCED_TABLE_NAME IS NOT NULL
            ''', (database, table))
            return {row['COLUMN_NAME']: {'table': row['REFERENCED_TABLE_NAME'],
                    'column': row['REFERENCED_COLUMN_NAME']} for row in cursor.fetchall()}

    def get_schema(self, conn, database, tables, views):
        objects = set(tables) | set(views)
        schema = {obj: {'columns': [], 'primary_keys': [], 'foreign_keys': {}} for obj in objects}
        if not objects:
            return schema

        with conn.cursor() as cursor:
            # 1. Fetch all columns for all tables in one query
            cursor.execute('''
                SELECT TABLE_NAME, COLUMN_NAME AS Field, COLUMN_TYPE AS Type,
                       IS_NULLABLE AS `Null`, COLUMN_KEY AS `Key`,
                       COLUMN_DEFAULT AS `Default`, EXTRA AS Extra
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = %s
                ORDER BY TABLE_NAME, ORDINAL_POSITION
            ''', (database,))
            for row in cursor.fetchall():
                tbl = row['TABLE_NAME']
                if tbl in schema:
                    schema[tbl]['columns'].append({
                        'Field': row['Field'],
                        'Type': row['Type'],
                        'Null': row['Null'],
                        'Key': row['Key'],
                        'Default': row['Default'],
                        'Extra': row['Extra'],
                    })

            # 2. Fetch all primary keys in one query
            cursor.execute('''
                SELECT TABLE_NAME, COLUMN_NAME
                FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
                WHERE TABLE_SCHEMA = %s AND CONSTRAINT_NAME = 'PRIMARY'
                ORDER BY TABLE_NAME, ORDINAL_POSITION
            ''', (database,))
            for row in cursor.fetchall():
                tbl = row['TABLE_NAME']
                if tbl in schema:
                    schema[tbl]['primary_keys'].append(row['COLUMN_NAME'])

            # 3. Fetch all foreign keys in one query
            cursor.execute('''
                SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
                FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
                WHERE TABLE_SCHEMA = %s AND REFERENCED_TABLE_NAME IS NOT NULL
            ''', (database,))
            for row in cursor.fetchall():
                tbl = row['TABLE_NAME']
                if tbl in schema:
                    schema[tbl]['foreign_keys'][row['COLUMN_NAME']] = {
                        'table': row['REFERENCED_TABLE_NAME'],
                        'column': row['REFERENCED_COLUMN_NAME']
                    }

        return schema

    def search_expression(self, column):
        return f'{self.quote(column)} LIKE %s'

    def insert_suffix(self, primary_keys):
        return ''

    @staticmethod
    def inserted_id(cursor, primary_keys):
        return cursor.lastrowid

    def dump_command(self, database, path):
        cmd = ['mysqldump', '-h', self.profile['host'], '-P', str(self.profile['port']),
               '-u', self.profile['user'], '--set-gtid-purged=OFF', database]
        env = os.environ.copy()
        if self.profile.get('password'):
            env['MYSQL_PWD'] = self.profile['password']
        with open(path, 'w', encoding='utf-8') as output:
            subprocess.run(cmd, stdout=output, check=True, stderr=subprocess.PIPE, env=env)

    def import_command(self, database, path):
        cmd = ['mysql', '-h', self.profile['host'], '-P', str(self.profile['port']),
               '-u', self.profile['user'], database]
        env = os.environ.copy()
        if self.profile.get('password'):
            env['MYSQL_PWD'] = self.profile['password']
        with open(path, encoding='utf-8') as source:
            subprocess.run(cmd, stdin=source, check=True, stderr=subprocess.PIPE, env=env)
