import csv
import datetime
import decimal
import io
import ipaddress
import json
import os
import subprocess
import tempfile
import uuid

from dotenv import load_dotenv
from flask import (Flask, Response, after_this_request, jsonify, redirect,
                   render_template, request, send_file, url_for)
from flask.json.provider import DefaultJSONProvider
from flask_cors import CORS
import pymysql

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:  # A useful error is raised only when a PostgreSQL profile is used.
    psycopg = None
    dict_row = None


load_dotenv()
app = Flask(__name__)
CORS(app)
PROFILES_FILE = os.path.join(app.root_path, 'profiles.json')


class DatabaseJSONProvider(DefaultJSONProvider):
    def default(self, obj):
        if isinstance(obj, decimal.Decimal):
            return str(obj)
        if isinstance(obj, (datetime.date, datetime.datetime, datetime.time)):
            return obj.isoformat()
        if isinstance(obj, datetime.timedelta):
            return str(obj)
        if isinstance(obj, uuid.UUID):
            return str(obj)
        if isinstance(obj, (ipaddress.IPv4Address, ipaddress.IPv6Address,
                            ipaddress.IPv4Network, ipaddress.IPv6Network)):
            return str(obj)
        if isinstance(obj, memoryview):
            return bytes(obj).decode('utf-8', errors='replace')
        if isinstance(obj, bytes):
            return obj.decode('utf-8', errors='replace')
        return super().default(obj)


app.json = DatabaseJSONProvider(app)


def _normalize_profiles(data):
    changed = False
    for profile in data.get('profiles', []):
        if 'engine' not in profile:
            profile['engine'] = 'mysql'
            changed = True
        if 'schema' not in profile:
            profile['schema'] = 'public'
            changed = True
    return changed


def get_profiles_data():
    if not os.path.exists(PROFILES_FILE):
        default_dbs = []
        legacy_file = os.path.join(app.root_path, 'db_list.json')
        if os.path.exists(legacy_file):
            try:
                with open(legacy_file, encoding='utf-8') as handle:
                    default_dbs = json.load(handle)
            except (OSError, ValueError):
                pass
        data = {'active': 'default', 'profiles': [{
            'name': 'default', 'engine': 'mysql',
            'host': os.getenv('DB_HOST', 'localhost'),
            'port': int(os.getenv('DB_PORT', 3306) or 3306),
            'user': os.getenv('DB_USER', 'root'),
            'password': os.getenv('DB_PASSWORD', ''),
            'schema': 'public', 'databases': default_dbs,
        }]}
        save_profiles_data(data)
        return data
    try:
        with open(PROFILES_FILE, encoding='utf-8') as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return {'active': '', 'profiles': []}
    if _normalize_profiles(data):
        save_profiles_data(data)
    return data


def save_profiles_data(data):
    with open(PROFILES_FILE, 'w', encoding='utf-8') as handle:
        json.dump(data, handle, indent=4)


def get_profile(profile_name):
    for profile in get_profiles_data().get('profiles', []):
        if profile['name'] == profile_name:
            return profile
    return None


def require_profile(profile_name):
    profile = get_profile(profile_name)
    if not profile:
        raise LookupError(f'Profile "{profile_name}" was not found')
    return profile


def get_db_list(profile_name):
    return require_profile(profile_name).get('databases', [])


def save_db_list(profile_name, databases):
    data = get_profiles_data()
    for profile in data['profiles']:
        if profile['name'] == profile_name:
            profile['databases'] = databases
            save_profiles_data(data)
            return
    raise LookupError(f'Profile "{profile_name}" was not found')


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


def get_adapter(profile_name):
    profile = require_profile(profile_name)
    engine = profile.get('engine', 'mysql').lower()
    if engine == 'mysql':
        return MySQLAdapter(profile)
    if engine in ('postgres', 'postgresql'):
        return PostgreSQLAdapter(profile)
    raise ValueError(f'Unsupported database type: {engine}')


def check_db_accessibility(profile_name, database):
    try:
        with get_adapter(profile_name).connect(database):
            return True
    except Exception:
        return False


def api_error(error, status=500):
    return jsonify({'error': str(error)}), status


@app.context_processor
def inject_profile_context():
    return {'profile_name': request.view_args.get('profile_name', '') if request.view_args else ''}


@app.route('/api/profiles', methods=['GET'])
def list_profiles():
    data = get_profiles_data()
    public_profiles = [{k: p.get(k) for k in ('name', 'engine', 'host', 'port', 'user', 'schema')}
                       for p in data['profiles']]
    return jsonify(success=True, active=data.get('active'), profiles=public_profiles)


@app.route('/api/profiles', methods=['POST'])
def add_profile():
    req = request.get_json(silent=True) or {}
    name = (req.get('name') or '').strip()
    engine = (req.get('engine') or 'mysql').lower()
    if not name:
        return api_error('Name is required', 400)
    if '/' in name:
        return api_error('Profile names cannot contain slashes', 400)
    if engine not in ('mysql', 'postgresql'):
        return api_error('Database type must be MySQL or PostgreSQL', 400)
    data = get_profiles_data()
    if any(p['name'] == name for p in data['profiles']):
        return api_error('Profile already exists', 400)
    default_port = 5432 if engine == 'postgresql' else 3306
    default_user = 'postgres' if engine == 'postgresql' else 'root'
    data['profiles'].append({
        'name': name, 'engine': engine, 'host': req.get('host') or 'localhost',
        'port': int(req.get('port') or default_port), 'user': req.get('user') or default_user,
        'password': req.get('password') or '', 'schema': req.get('schema') or 'public',
        'sslmode': req.get('sslmode') or '', 'databases': [],
    })
    if len(data['profiles']) == 1:
        data['active'] = name
    save_profiles_data(data)
    return jsonify(success=True, name=name)


@app.route('/api/profiles/<name>', methods=['PUT'])
def update_profile(name):
    req = request.get_json(silent=True) or {}
    data = get_profiles_data()
    index = next((i for i, p in enumerate(data['profiles']) if p['name'] == name), -1)
    if index < 0:
        return api_error('Profile not found', 404)
    old = data['profiles'][index]
    new_name = (req.get('name') or name).strip()
    if '/' in new_name:
        return api_error('Profile names cannot contain slashes', 400)
    if new_name != name and any(p['name'] == new_name for p in data['profiles']):
        return api_error('A profile with this name already exists', 400)
    engine = (req.get('engine') or old.get('engine') or 'mysql').lower()
    if engine not in ('mysql', 'postgresql'):
        return api_error('Database type must be MySQL or PostgreSQL', 400)
    updated = dict(old)
    updated.update({
        'name': new_name, 'engine': engine, 'host': req.get('host') or old['host'],
        'port': int(req.get('port') or old['port']), 'user': req.get('user') or old['user'],
        'schema': req.get('schema') or old.get('schema') or 'public',
    })
    if req.get('password'):
        updated['password'] = req['password']
    data['profiles'][index] = updated
    if data.get('active') == name:
        data['active'] = new_name
    save_profiles_data(data)
    return jsonify(success=True, name=new_name)


@app.route('/api/profiles/<name>', methods=['DELETE'])
def delete_profile(name):
    data = get_profiles_data()
    if not any(p['name'] == name for p in data['profiles']):
        return api_error('Profile not found', 404)
    data['profiles'] = [p for p in data['profiles'] if p['name'] != name]
    if data.get('active') == name:
        data['active'] = data['profiles'][0]['name'] if data['profiles'] else ''
    save_profiles_data(data)
    return jsonify(success=True)


@app.route('/')
def profile_selector():
    return render_template('profile_selector.html')


@app.route('/p/<profile_name>/')
def index(profile_name):
    profile = get_profile(profile_name)
    if not profile:
        return redirect(url_for('profile_selector'))
    statuses = [{'name': db, 'accessible': None} for db in profile.get('databases', [])]
    return render_template('index.html', databases=statuses, profile=profile)


@app.route('/p/<profile_name>/db/<dbname>')
@app.route('/p/<profile_name>/db/<dbname>/table/<tablename>')
def database_view(profile_name, dbname, tablename=None):
    try:
        adapter = get_adapter(profile_name)
        with adapter.connect(dbname) as conn:
            tables = adapter.list_tables(conn)
            views = adapter.list_views(conn)
        return render_template('database.html', dbname=dbname, tables=tables, views=views,
                               initial_table=tablename, profile=require_profile(profile_name))
    except Exception as error:
        return render_template('database.html', dbname=dbname, error=str(error), tables=[],
                               views=[], initial_table=tablename, profile=get_profile(profile_name))


@app.route('/api/p/<profile_name>/dbs/<dbname>/check')
def check_db_status(profile_name, dbname):
    if dbname not in get_db_list(profile_name):
        return api_error('Database not found in list', 404)
    return jsonify(success=True, name=dbname, accessible=check_db_accessibility(profile_name, dbname))


@app.route('/api/p/<profile_name>/dbs/list')
def get_dbs_list_only(profile_name):
    return jsonify(success=True, databases=get_db_list(profile_name))


@app.route('/api/p/<profile_name>/remote_dbs', methods=['GET', 'POST'])
def remote_databases(profile_name):
    try:
        adapter = get_adapter(profile_name)
        if request.method == 'GET':
            return jsonify(success=True, databases=adapter.list_databases())
        name = ((request.get_json(silent=True) or {}).get('name') or '').strip()
        if not name:
            return api_error('Database name required', 400)
        adapter.create_database(name)
        return jsonify(success=True, name=name)
    except Exception as error:
        return api_error(error)


@app.route('/api/p/<profile_name>/remote_dbs/<dbname>', methods=['DELETE'])
def drop_remote_db(profile_name, dbname):
    try:
        get_adapter(profile_name).drop_database(dbname)
        databases = get_db_list(profile_name)
        if dbname in databases:
            databases.remove(dbname)
            save_db_list(profile_name, databases)
        return jsonify(success=True)
    except Exception as error:
        return api_error(error)


@app.route('/api/p/<profile_name>/dbs', methods=['POST'])
def add_db(profile_name):
    name = ((request.get_json(silent=True) or {}).get('name') or '').strip()
    if not name:
        return api_error('Database name required', 400)
    databases = get_db_list(profile_name)
    if name in databases:
        return api_error('Database already exists in list', 400)
    databases.append(name)
    save_db_list(profile_name, databases)
    return jsonify(success=True, name=name, accessible=check_db_accessibility(profile_name, name))


@app.route('/api/p/<profile_name>/dbs/<dbname>', methods=['DELETE'])
def remove_db(profile_name, dbname):
    databases = get_db_list(profile_name)
    if dbname in databases:
        databases.remove(dbname)
        save_db_list(profile_name, databases)
    return jsonify(success=True)


@app.route('/api/p/<profile_name>/db/<dbname>/schema')
def get_db_schema(profile_name, dbname):
    try:
        adapter = get_adapter(profile_name)
        with adapter.connect(dbname) as conn:
            tables = adapter.list_tables(conn)
            views = adapter.list_views(conn)
            objects = [*tables, *views]
            schema = {table: {
                'columns': adapter.columns(conn, table),
                'primary_keys': adapter.primary_keys(conn, table),
                'foreign_keys': adapter.foreign_keys(conn, dbname, table),
            } for table in objects}
        return jsonify(success=True, schema=schema, tables=tables, views=views)
    except Exception as error:
        return api_error(error)


def validated_columns(adapter, conn, table):
    return [column['Field'] for column in adapter.columns(conn, table)]


@app.route('/api/p/<profile_name>/db/<dbname>/table/<tablename>/data')
def get_table_data(profile_name, dbname, tablename):
    try:
        page = max(1, int(request.args.get('page', 1)))
        limit = min(1000, max(1, int(request.args.get('limit', 100))))
        offset = (page - 1) * limit
        adapter = get_adapter(profile_name)
        with adapter.connect(dbname) as conn, conn.cursor() as cursor:
            columns = validated_columns(adapter, conn, tablename)
            if not columns:
                return api_error('Table not found', 404)
            table_ref = adapter.table_ref(tablename)
            query = f'SELECT * FROM {table_ref}'
            count_query = f'SELECT COUNT(*) AS total FROM {table_ref}'
            params = []
            filter_col = request.args.get('filter_col', '')
            filter_val = request.args.get('filter_val', '')
            search = request.args.get('search', '')
            if filter_col and filter_val and filter_col in columns:
                clause = f' WHERE {adapter.quote(filter_col)} = %s'
                query += clause
                count_query += clause
                params.append(filter_val)
            elif search:
                clause = ' WHERE ' + ' OR '.join(adapter.search_expression(col) for col in columns)
                query += clause
                count_query += clause
                params = [f'%{search}%'] * len(columns)
            cursor.execute(count_query, params)
            total = cursor.fetchone()['total']
            sort_col = request.args.get('sort')
            sort_dir = request.args.get('dir', 'asc').upper()
            if sort_col in columns:
                query += f' ORDER BY {adapter.quote(sort_col)} {"DESC" if sort_dir == "DESC" else "ASC"}'
            query += ' LIMIT %s OFFSET %s'
            cursor.execute(query, params + [limit, offset])
            rows = cursor.fetchall()
        return jsonify(rows=rows, total=total, page=page, limit=limit,
                       pages=(total + limit - 1) // limit)
    except Exception as error:
        return api_error(error)


@app.route('/api/p/<profile_name>/db/<dbname>/table/<tablename>/row', methods=['POST', 'PUT', 'DELETE'])
def mutate_row(profile_name, dbname, tablename):
    data = request.get_json(silent=True) or {}
    try:
        adapter = get_adapter(profile_name)
        with adapter.connect(dbname) as conn, conn.cursor() as cursor:
            valid = set(validated_columns(adapter, conn, tablename))
            table_ref = adapter.table_ref(tablename)
            if request.method == 'POST':
                values = {k: v for k, v in data.items() if k in valid}
                if not values:
                    return api_error('Data is required', 400)
                primary_keys = adapter.primary_keys(conn, tablename)
                columns = ', '.join(adapter.quote(k) for k in values)
                placeholders = ', '.join(['%s'] * len(values))
                query = f'INSERT INTO {table_ref} ({columns}) VALUES ({placeholders})'
                query += adapter.insert_suffix(primary_keys)
                cursor.execute(query, list(values.values()))
                inserted_id = adapter.inserted_id(cursor, primary_keys)
                conn.commit()
                return jsonify(success=True, lastrowid=inserted_id)
            primary_keys = data.get('primary_keys') or {}
            if not primary_keys or any(k not in valid for k in primary_keys):
                return api_error('Valid primary keys are required', 400)
            where = ' AND '.join(f'{adapter.quote(k)} = %s' for k in primary_keys)
            if request.method == 'PUT':
                updates = data.get('updates') or {}
                if not updates or any(k not in valid for k in updates):
                    return api_error('Valid updates are required', 400)
                set_clause = ', '.join(f'{adapter.quote(k)} = %s' for k in updates)
                cursor.execute(f'UPDATE {table_ref} SET {set_clause} WHERE {where}',
                               list(updates.values()) + list(primary_keys.values()))
            else:
                cursor.execute(f'DELETE FROM {table_ref} WHERE {where}', list(primary_keys.values()))
            affected = cursor.rowcount
            conn.commit()
            return jsonify(success=True, affected_rows=affected)
    except Exception as error:
        return api_error(error)


@app.route('/api/p/<profile_name>/db/<dbname>/table/<tablename>/export/csv')
def export_table_csv(profile_name, dbname, tablename):
    try:
        adapter = get_adapter(profile_name)
        with adapter.connect(dbname) as conn, conn.cursor() as cursor:
            columns = validated_columns(adapter, conn, tablename)
            cursor.execute(f'SELECT * FROM {adapter.table_ref(tablename)}')
            rows = cursor.fetchall()
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)
        return Response(output.getvalue(), mimetype='text/csv', headers={
            'Content-Disposition': f'attachment; filename="{tablename}_export.csv"'})
    except Exception as error:
        return api_error(error)


@app.route('/api/p/<profile_name>/db/<dbname>/export')
def export_db(profile_name, dbname):
    if dbname not in get_db_list(profile_name):
        return api_error('Database not found in list', 404)
    path = None
    try:
        fd, path = tempfile.mkstemp(suffix='.sql')
        os.close(fd)
        get_adapter(profile_name).dump_command(dbname, path)

        @after_this_request
        def cleanup(response):
            try:
                os.remove(path)
            except OSError:
                pass
            return response

        return send_file(path, as_attachment=True, download_name=f'{dbname}_export.sql',
                         mimetype='application/sql')
    except subprocess.CalledProcessError as error:
        if path:
            try: os.remove(path)
            except OSError: pass
        return api_error(f'Export failed: {error.stderr.decode("utf-8", errors="replace")}')
    except Exception as error:
        return api_error(error)


@app.route('/api/p/<profile_name>/dbs/import', methods=['POST'])
def import_db(profile_name):
    upload = request.files.get('file')
    dbname = (request.form.get('name') or '').strip()
    if not upload or not upload.filename:
        return api_error('No selected file', 400)
    if not dbname:
        return api_error('Database name required', 400)
    path = None
    try:
        adapter = get_adapter(profile_name)
        if dbname not in adapter.list_databases():
            adapter.create_database(dbname)
        fd, path = tempfile.mkstemp(suffix='.sql')
        os.close(fd)
        upload.save(path)
        adapter.import_command(dbname, path)
        databases = get_db_list(profile_name)
        if dbname not in databases:
            databases.append(dbname)
            save_db_list(profile_name, databases)
        return jsonify(success=True, name=dbname, accessible=True)
    except subprocess.CalledProcessError as error:
        return api_error(f'Import failed: {error.stderr.decode("utf-8", errors="replace")}')
    except Exception as error:
        return api_error(error)
    finally:
        if path:
            try: os.remove(path)
            except OSError: pass


@app.route('/api/p/<profile_name>/sql', methods=['POST'])
def execute_sql(profile_name):
    data = request.get_json(silent=True) or {}
    dbname, query = data.get('dbname'), data.get('query')
    if not query:
        return api_error('Query is required', 400)
    try:
        adapter = get_adapter(profile_name)
        with adapter.connect(dbname) as conn, conn.cursor() as cursor:
            cursor.execute(query)
            if cursor.description:
                rows = cursor.fetchall()
                return jsonify(success=True, rows=rows, is_select=True)
            affected = cursor.rowcount
            conn.commit()
            return jsonify(success=True, affected_rows=affected, is_select=False)
    except Exception as error:
        return api_error(error)


# Old bookmarks still land on the active profile, then become profile-scoped URLs.
@app.route('/db/<dbname>')
@app.route('/db/<dbname>/table/<tablename>')
def legacy_database_view(dbname, tablename=None):
    data = get_profiles_data()
    profile_name = data.get('active')
    if not profile_name:
        return redirect(url_for('profile_selector'))
    if tablename:
        return redirect(url_for('database_view', profile_name=profile_name, dbname=dbname, tablename=tablename))
    return redirect(url_for('database_view', profile_name=profile_name, dbname=dbname))


if __name__ == '__main__':
    app.run(debug=True, port=10992)
