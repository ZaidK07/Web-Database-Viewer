import json
import os
import sqlite3

from adapters.mysql import MySQLAdapter
from adapters.postgres import PostgreSQLAdapter

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROFILES_FILE = os.path.join(BASE_DIR, 'profiles.json')
PROFILES_DB_FILE = os.path.join(BASE_DIR, 'profiles.db')


def get_sqlite_conn():
    conn = sqlite3.connect(PROFILES_DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn


def init_profiles_db():
    with get_sqlite_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS profiles (
                name TEXT PRIMARY KEY,
                engine TEXT NOT NULL DEFAULT 'mysql',
                host TEXT NOT NULL DEFAULT 'localhost',
                port INTEGER NOT NULL DEFAULT 3306,
                user TEXT NOT NULL DEFAULT 'root',
                password TEXT NOT NULL DEFAULT '',
                schema TEXT NOT NULL DEFAULT 'public',
                sslmode TEXT DEFAULT '',
                databases_json TEXT NOT NULL DEFAULT '[]'
            )
        ''')

        # Check if profiles table is empty. If empty and profiles.json exists, migrate everything!
        cursor.execute('SELECT COUNT(*) AS cnt FROM profiles')
        count = cursor.fetchone()['cnt']
        if count == 0:
            active_name = ''
            json_profiles = []
            if os.path.exists(PROFILES_FILE):
                try:
                    with open(PROFILES_FILE, encoding='utf-8') as handle:
                        mig_data = json.load(handle)
                        active_name = mig_data.get('active', '')
                        json_profiles = mig_data.get('profiles', [])
                except Exception as e:
                    print(f"Error reading profiles.json for migration: {e}")

            if not json_profiles:
                # Default fallback if no profiles.json
                default_dbs = []
                legacy_file = os.path.join(BASE_DIR, 'db_list.json')
                if os.path.exists(legacy_file):
                    try:
                        with open(legacy_file, encoding='utf-8') as handle:
                            default_dbs = json.load(handle)
                    except (OSError, ValueError):
                        pass
                active_name = 'default'
                json_profiles = [{
                    'name': 'default', 'engine': 'mysql',
                    'host': os.getenv('DB_HOST', 'localhost'),
                    'port': int(os.getenv('DB_PORT', 3306) or 3306),
                    'user': os.getenv('DB_USER', 'root'),
                    'password': os.getenv('DB_PASSWORD', ''),
                    'schema': 'public', 'databases': default_dbs,
                }]

            for p in json_profiles:
                cursor.execute('''
                    INSERT OR REPLACE INTO profiles (name, engine, host, port, user, password, schema, sslmode, databases_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    p.get('name'),
                    p.get('engine', 'mysql'),
                    p.get('host', 'localhost'),
                    int(p.get('port') or (5432 if p.get('engine') == 'postgresql' else 3306)),
                    p.get('user', 'root'),
                    p.get('password', ''),
                    p.get('schema', 'public'),
                    p.get('sslmode', ''),
                    json.dumps(p.get('databases', []))
                ))

            if not active_name and json_profiles:
                active_name = json_profiles[0].get('name', '')

            if active_name:
                cursor.execute('INSERT OR REPLACE INTO meta (key, value) VALUES ("active", ?)', (active_name,))
        conn.commit()


def _row_to_profile(row):
    if row is None:
        return None
    d = dict(row)
    try:
        d['databases'] = json.loads(d.get('databases_json') or '[]')
    except (json.JSONDecodeError, TypeError):
        d['databases'] = []
    d.pop('databases_json', None)
    return d


def get_profiles_data():
    with get_sqlite_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT value FROM meta WHERE key = "active"')
        active_row = cursor.fetchone()
        active = active_row['value'] if active_row else ''

        cursor.execute('SELECT * FROM profiles ORDER BY name ASC')
        profiles = [_row_to_profile(row) for row in cursor.fetchall()]
        return {'active': active, 'profiles': profiles}


def get_profile(profile_name):
    with get_sqlite_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM profiles WHERE name = ?', (profile_name,))
        row = cursor.fetchone()
        return _row_to_profile(row)


def require_profile(profile_name):
    profile = get_profile(profile_name)
    if not profile:
        raise LookupError(f'Profile "{profile_name}" was not found')
    return profile


def get_db_list(profile_name):
    return require_profile(profile_name).get('databases', [])


def save_db_list(profile_name, databases):
    with get_sqlite_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('UPDATE profiles SET databases_json = ? WHERE name = ?',
                       (json.dumps(databases), profile_name))
        if cursor.rowcount == 0:
            raise LookupError(f'Profile "{profile_name}" was not found')
        conn.commit()


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
