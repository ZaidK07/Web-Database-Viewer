import csv
import io
import os
import subprocess
import tempfile
from flask import (
    Blueprint, Response, after_this_request, jsonify, redirect,
    render_template, request, send_file, url_for
)
from services.profiles import (
    get_profile,
    require_profile,
    get_db_list,
    save_db_list,
    get_adapter,
    check_db_accessibility,
    check_dbs_accessibility,
    get_profiles_data
)

databases_bp = Blueprint('databases', __name__)


def api_error(error, status=500):
    return jsonify({'error': str(error)}), status


def validated_columns(adapter, conn, table):
    return [column['Field'] for column in adapter.columns(conn, table)]


@databases_bp.route('/p/<profile_name>/')
def index(profile_name):
    profile = get_profile(profile_name)
    if not profile:
        return redirect(url_for('profiles.profile_selector'))
    statuses = [{'name': db, 'accessible': None} for db in profile.get('databases', [])]
    return render_template('index.html', databases=statuses, profile=profile)


@databases_bp.route('/p/<profile_name>/db/<dbname>')
@databases_bp.route('/p/<profile_name>/db/<dbname>/table/<tablename>')
def database_view(profile_name, dbname, tablename=None):
    try:
        profile = require_profile(profile_name)
        return render_template('database.html', dbname=dbname, tables=[], views=[],
                               initial_table=tablename, profile=profile)
    except Exception as error:
        return render_template('database.html', dbname=dbname, error=str(error), tables=[],
                               views=[], initial_table=tablename, profile=get_profile(profile_name))


@databases_bp.route('/api/p/<profile_name>/dbs/<dbname>/check')
def check_db_status(profile_name, dbname):
    if dbname not in get_db_list(profile_name):
        return api_error('Database not found in list', 404)
    return jsonify(success=True, name=dbname, accessible=check_db_accessibility(profile_name, dbname))


@databases_bp.route('/api/p/<profile_name>/dbs/status')
def check_all_dbs_status(profile_name):
    try:
        db_list = get_db_list(profile_name)
        statuses = check_dbs_accessibility(profile_name, db_list)
        return jsonify(success=True, statuses=statuses)
    except Exception as error:
        return api_error(error)


@databases_bp.route('/api/p/<profile_name>/dbs/list')
def get_dbs_list_only(profile_name):
    return jsonify(success=True, databases=get_db_list(profile_name))


@databases_bp.route('/api/p/<profile_name>/remote_dbs', methods=['GET', 'POST'])
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


@databases_bp.route('/api/p/<profile_name>/remote_dbs/<dbname>', methods=['DELETE'])
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


@databases_bp.route('/api/p/<profile_name>/dbs', methods=['POST'])
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


@databases_bp.route('/api/p/<profile_name>/dbs/<dbname>', methods=['DELETE'])
def remove_db(profile_name, dbname):
    databases = get_db_list(profile_name)
    if dbname in databases:
        databases.remove(dbname)
        save_db_list(profile_name, databases)
    return jsonify(success=True)


@databases_bp.route('/api/p/<profile_name>/db/<dbname>/schema')
def get_db_schema(profile_name, dbname):
    try:
        adapter = get_adapter(profile_name)
        with adapter.connect(dbname) as conn:
            tables = adapter.list_tables(conn)
            views = adapter.list_views(conn)
            if hasattr(adapter, 'get_schema'):
                schema = adapter.get_schema(conn, dbname, tables, views)
            else:
                objects = [*tables, *views]
                schema = {table: {
                    'columns': adapter.columns(conn, table),
                    'primary_keys': adapter.primary_keys(conn, table),
                    'foreign_keys': adapter.foreign_keys(conn, dbname, table),
                } for table in objects}
        return jsonify(success=True, schema=schema, tables=tables, views=views)
    except Exception as error:
        return api_error(error)


@databases_bp.route('/api/p/<profile_name>/db/<dbname>/table/<tablename>/data')
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


@databases_bp.route('/api/p/<profile_name>/db/<dbname>/table/<tablename>/row', methods=['POST', 'PUT', 'DELETE'])
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
            if request.method == 'DELETE':
                batch_rows = data.get('rows')
                if isinstance(batch_rows, list) and batch_rows:
                    total_affected = 0
                    for row_pks in batch_rows:
                        if not row_pks or any(k not in valid for k in row_pks):
                            continue
                        where = ' AND '.join(f'{adapter.quote(k)} = %s' for k in row_pks)
                        cursor.execute(f'DELETE FROM {table_ref} WHERE {where}', list(row_pks.values()))
                        total_affected += cursor.rowcount
                    conn.commit()
                    return jsonify(success=True, affected_rows=total_affected)

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


@databases_bp.route('/api/p/<profile_name>/db/<dbname>/table/<tablename>/export/csv')
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


@databases_bp.route('/api/p/<profile_name>/db/<dbname>/export')
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


@databases_bp.route('/api/p/<profile_name>/dbs/import', methods=['POST'])
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


@databases_bp.route('/api/p/<profile_name>/sql', methods=['POST'])
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


@databases_bp.route('/db/<dbname>')
@databases_bp.route('/db/<dbname>/table/<tablename>')
def legacy_database_view(dbname, tablename=None):
    data = get_profiles_data()
    profile_name = data.get('active')
    if not profile_name:
        return redirect(url_for('profiles.profile_selector'))
    if tablename:
        return redirect(url_for('databases.database_view', profile_name=profile_name, dbname=dbname, tablename=tablename))
    return redirect(url_for('databases.database_view', profile_name=profile_name, dbname=dbname))
