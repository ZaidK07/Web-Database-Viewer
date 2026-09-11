import json
from flask import Blueprint, jsonify, render_template, request

from services.profiles import (
    get_profile,
    get_profiles_data,
    get_sqlite_conn
)

profiles_bp = Blueprint('profiles', __name__)


def api_error(error, status=500):
    return jsonify({'error': str(error)}), status


@profiles_bp.route('/api/profiles', methods=['GET'])
def list_profiles():
    data = get_profiles_data()
    public_profiles = [{k: p.get(k) for k in ('name', 'engine', 'host', 'port', 'user', 'schema')}
                       for p in data['profiles']]
    return jsonify(success=True, active=data.get('active'), profiles=public_profiles)


@profiles_bp.route('/api/profiles/active', methods=['PUT'])
def switch_active_profile():
    req = request.get_json(silent=True) or {}
    name = (req.get('name') or '').strip()
    if not get_profile(name):
        return api_error('Profile not found', 404)
    with get_sqlite_conn() as conn:
        conn.cursor().execute('INSERT OR REPLACE INTO meta (key, value) VALUES ("active", ?)', (name,))
        conn.commit()
    return jsonify(success=True, active=name)


@profiles_bp.route('/api/profiles', methods=['POST'])
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

    if get_profile(name):
        return api_error('Profile already exists', 400)

    default_port = 5432 if engine == 'postgresql' else 3306
    default_user = 'postgres' if engine == 'postgresql' else 'root'

    with get_sqlite_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO profiles (name, engine, host, port, user, password, schema, sslmode, databases_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            name,
            engine,
            req.get('host') or 'localhost',
            int(req.get('port') or default_port),
            req.get('user') or default_user,
            req.get('password') or '',
            req.get('schema') or 'public',
            req.get('sslmode') or '',
            '[]'
        ))

        cursor.execute('SELECT COUNT(*) AS cnt FROM profiles')
        if cursor.fetchone()['cnt'] == 1:
            cursor.execute('INSERT OR REPLACE INTO meta (key, value) VALUES ("active", ?)', (name,))
        conn.commit()

    return jsonify(success=True, name=name)


@profiles_bp.route('/api/profiles/<name>', methods=['PUT'])
def update_profile(name):
    req = request.get_json(silent=True) or {}
    old = get_profile(name)
    if not old:
        return api_error('Profile not found', 404)

    new_name = (req.get('name') or name).strip()
    if '/' in new_name:
        return api_error('Profile names cannot contain slashes', 400)
    if new_name != name and get_profile(new_name):
        return api_error('A profile with this name already exists', 400)

    engine = (req.get('engine') or old.get('engine') or 'mysql').lower()
    if engine not in ('mysql', 'postgresql'):
        return api_error('Database type must be MySQL or PostgreSQL', 400)

    host = req.get('host') or old['host']
    port = int(req.get('port') or old['port'])
    user = req.get('user') or old['user']
    schema = req.get('schema') or old.get('schema') or 'public'
    password = req['password'] if req.get('password') else old['password']
    sslmode = req.get('sslmode') or old.get('sslmode') or ''
    databases_json = json.dumps(old.get('databases', []))

    with get_sqlite_conn() as conn:
        cursor = conn.cursor()
        if new_name != name:
            cursor.execute('DELETE FROM profiles WHERE name = ?', (name,))
            cursor.execute('''
                INSERT INTO profiles (name, engine, host, port, user, password, schema, sslmode, databases_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (new_name, engine, host, port, user, password, schema, sslmode, databases_json))

            # Update active profile if needed
            cursor.execute('SELECT value FROM meta WHERE key = "active"')
            active_row = cursor.fetchone()
            if active_row and active_row['value'] == name:
                cursor.execute('UPDATE meta SET value = ? WHERE key = "active"', (new_name,))
        else:
            cursor.execute('''
                UPDATE profiles
                SET engine = ?, host = ?, port = ?, user = ?, password = ?, schema = ?, sslmode = ?
                WHERE name = ?
            ''', (engine, host, port, user, password, schema, sslmode, name))
        conn.commit()

    return jsonify(success=True, name=new_name)


@profiles_bp.route('/api/profiles/<name>', methods=['DELETE'])
def delete_profile(name):
    if not get_profile(name):
        return api_error('Profile not found', 404)

    with get_sqlite_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM profiles WHERE name = ?', (name,))

        cursor.execute('SELECT value FROM meta WHERE key = "active"')
        active_row = cursor.fetchone()
        if active_row and active_row['value'] == name:
            cursor.execute('SELECT name FROM profiles ORDER BY name ASC LIMIT 1')
            first_p = cursor.fetchone()
            new_active = first_p['name'] if first_p else ''
            cursor.execute('UPDATE meta SET value = ? WHERE key = "active"', (new_active,))
        conn.commit()

    return jsonify(success=True)


@profiles_bp.route('/')
@profiles_bp.route('/profiles')
def profile_selector():
    return render_template('profile_selector.html')
