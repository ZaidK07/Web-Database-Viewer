import csv
import io
import os
import sqlite3
from flask import (
    Blueprint, Response, jsonify, render_template, request, send_file
)
from adapters.sqlite import SQLiteAdapter
from services.sqlite_storage import (
    save_uploaded_sqlite,
    list_uploaded_sqlite_files,
    get_uploaded_sqlite_file,
    delete_uploaded_sqlite_file,
    register_local_sqlite_path
)

sqlite_bp = Blueprint('sqlite_viewer', __name__)


def api_error(error, status=500):
    return jsonify({'error': str(error)}), status


def validated_columns(adapter, conn, table):
    return [column['Field'] for column in adapter.columns(conn, table)]


@sqlite_bp.route('/sqlite')
@sqlite_bp.route('/sqlite/<file_id>')
def sqlite_view(file_id=None):
    return render_template('sqlite_viewer.html', initial_file_id=file_id or '')


@sqlite_bp.route('/api/sqlite/files', methods=['GET'])
def list_files():
    files = list_uploaded_sqlite_files()
    return jsonify(success=True, files=files)


@sqlite_bp.route('/api/sqlite/upload', methods=['POST'])
def upload_file():
    upload = request.files.get('file')
    if not upload or not upload.filename:
        return api_error('No file selected', 400)
    try:
        file_info = save_uploaded_sqlite(upload)
        # Test if it is a valid sqlite file
        try:
            adapter = SQLiteAdapter(file_info['file_path'])
            adapter.list_tables()
        except Exception as e:
            delete_uploaded_sqlite_file(file_info['id'])
            return api_error(f'Invalid SQLite file: {str(e)}', 400)
        return jsonify(success=True, file=file_info)
    except Exception as error:
        return api_error(error)


@sqlite_bp.route('/api/sqlite/register-local', methods=['POST'])
def register_local():
    data = request.get_json(silent=True) or {}
    path = (data.get('path') or '').strip()
    if not path or not os.path.exists(path):
        return api_error('Valid local file path is required', 400)
    try:
        file_info = register_local_sqlite_path(path)
        adapter = SQLiteAdapter(file_info['file_path'])
        adapter.list_tables()
        return jsonify(success=True, file=file_info)
    except Exception as error:
        return api_error(error)


@sqlite_bp.route('/api/sqlite/files/<file_id>', methods=['GET', 'DELETE'])
def file_details_or_delete(file_id):
    if request.method == 'DELETE':
        success = delete_uploaded_sqlite_file(file_id)
        if not success:
            return api_error('File not found', 404)
        return jsonify(success=True)
    file_info = get_uploaded_sqlite_file(file_id)
    if not file_info:
        return api_error('File not found', 404)
    return jsonify(success=True, file=file_info)


@sqlite_bp.route('/api/sqlite/<file_id>/schema')
def get_schema(file_id):
    file_info = get_uploaded_sqlite_file(file_id)
    if not file_info or not file_info['exists']:
        return api_error('File not found on disk', 404)
    try:
        adapter = SQLiteAdapter(file_info['file_path'])
        with adapter.connect() as conn:
            tables = adapter.list_tables(conn)
            views = adapter.list_views(conn)
            if hasattr(adapter, 'get_schema'):
                schema = adapter.get_schema(conn, None, tables, views)
            else:
                objects = [*tables, *views]
                schema = {table: {
                    'columns': adapter.columns(conn, table),
                    'primary_keys': adapter.primary_keys(conn, table),
                    'foreign_keys': adapter.foreign_keys(conn, None, table),
                } for table in objects}
        return jsonify(success=True, schema=schema, tables=tables, views=views, file=file_info)
    except Exception as error:
        return api_error(error)


@sqlite_bp.route('/api/sqlite/<file_id>/table/<tablename>/data')
def get_table_data(file_id, tablename):
    file_info = get_uploaded_sqlite_file(file_id)
    if not file_info or not file_info['exists']:
        return api_error('File not found on disk', 404)
    try:
        page = max(1, int(request.args.get('page', 1)))
        limit = min(1000, max(1, int(request.args.get('limit', 100))))
        offset = (page - 1) * limit
        adapter = SQLiteAdapter(file_info['file_path'])
        with adapter.connect() as conn:
            columns = validated_columns(adapter, conn, tablename)
            if not columns:
                return api_error('Table not found or has no columns', 404)
            table_ref = adapter.table_ref(tablename)
            query = f'SELECT * FROM {table_ref}'
            count_query = f'SELECT COUNT(*) AS total FROM {table_ref}'
            params = []
            filter_col = request.args.get('filter_col', '')
            filter_val = request.args.get('filter_val', '')
            search = request.args.get('search', '')
            if filter_col and filter_val and filter_col in columns:
                clause = f' WHERE {adapter.quote(filter_col)} = ?'
                query += clause
                count_query += clause
                params.append(filter_val)
            elif search:
                clause = ' WHERE ' + ' OR '.join(adapter.search_expression(col) for col in columns)
                query += clause
                count_query += clause
                params = [f'%{search}%'] * len(columns)
            
            cursor = conn.cursor()
            cursor.execute(count_query, params)
            total = cursor.fetchone()['total']
            sort_col = request.args.get('sort')
            sort_dir = request.args.get('dir', 'asc').upper()
            if sort_col in columns:
                query += f' ORDER BY {adapter.quote(sort_col)} {"DESC" if sort_dir == "DESC" else "ASC"}'
            query += ' LIMIT ? OFFSET ?'
            cursor.execute(query, params + [limit, offset])
            rows = [dict(r) for r in cursor.fetchall()]
        return jsonify(rows=rows, total=total, page=page, limit=limit,
                       pages=(total + limit - 1) // limit)
    except Exception as error:
        return api_error(error)


@sqlite_bp.route('/api/sqlite/<file_id>/table/<tablename>/row', methods=['POST', 'PUT', 'DELETE'])
def mutate_row(file_id, tablename):
    file_info = get_uploaded_sqlite_file(file_id)
    if not file_info or not file_info['exists']:
        return api_error('File not found on disk', 404)
    data = request.get_json(silent=True) or {}
    try:
        adapter = SQLiteAdapter(file_info['file_path'])
        with adapter.connect() as conn:
            valid = set(validated_columns(adapter, conn, tablename))
            table_ref = adapter.table_ref(tablename)
            cursor = conn.cursor()
            if request.method == 'POST':
                values = {k: v for k, v in data.items() if k in valid}
                if not values:
                    return api_error('Data is required', 400)
                columns = ', '.join(adapter.quote(k) for k in values)
                placeholders = ', '.join(['?'] * len(values))
                query = f'INSERT INTO {table_ref} ({columns}) VALUES ({placeholders})'
                cursor.execute(query, list(values.values()))
                inserted_id = cursor.lastrowid
                conn.commit()
                return jsonify(success=True, lastrowid=inserted_id)
            
            if request.method == 'DELETE':
                batch_rows = data.get('rows')
                if isinstance(batch_rows, list) and batch_rows:
                    total_affected = 0
                    for row_pks in batch_rows:
                        if not row_pks or any(k not in valid for k in row_pks):
                            continue
                        where = ' AND '.join(f'{adapter.quote(k)} = ?' for k in row_pks)
                        cursor.execute(f'DELETE FROM {table_ref} WHERE {where}', list(row_pks.values()))
                        total_affected += cursor.rowcount
                    conn.commit()
                    return jsonify(success=True, affected_rows=total_affected)

            primary_keys = data.get('primary_keys') or {}
            if not primary_keys or any(k not in valid for k in primary_keys):
                return api_error('Valid primary keys are required', 400)
            where = ' AND '.join(f'{adapter.quote(k)} = ?' for k in primary_keys)
            if request.method == 'PUT':
                updates = data.get('updates') or {}
                if not updates or any(k not in valid for k in updates):
                    return api_error('Valid updates are required', 400)
                set_clause = ', '.join(f'{adapter.quote(k)} = ?' for k in updates)
                cursor.execute(f'UPDATE {table_ref} SET {set_clause} WHERE {where}',
                               list(updates.values()) + list(primary_keys.values()))
            else:
                cursor.execute(f'DELETE FROM {table_ref} WHERE {where}', list(primary_keys.values()))
            affected = cursor.rowcount
            conn.commit()
            return jsonify(success=True, affected_rows=affected)
    except Exception as error:
        return api_error(error)


@sqlite_bp.route('/api/sqlite/<file_id>/table/<tablename>/export/csv')
def export_table_csv(file_id, tablename):
    file_info = get_uploaded_sqlite_file(file_id)
    if not file_info or not file_info['exists']:
        return api_error('File not found on disk', 404)
    try:
        adapter = SQLiteAdapter(file_info['file_path'])
        with adapter.connect() as conn:
            columns = validated_columns(adapter, conn, tablename)
            cursor = conn.cursor()
            cursor.execute(f'SELECT * FROM {adapter.table_ref(tablename)}')
            rows = [dict(r) for r in cursor.fetchall()]
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)
        return Response(output.getvalue(), mimetype='text/csv', headers={
            'Content-Disposition': f'attachment; filename="{tablename}_export.csv"'})
    except Exception as error:
        return api_error(error)


@sqlite_bp.route('/api/sqlite/<file_id>/download')
def download_sqlite_file(file_id):
    file_info = get_uploaded_sqlite_file(file_id)
    if not file_info or not file_info['exists']:
        return api_error('File not found on disk', 404)
    return send_file(file_info['file_path'], as_attachment=True, download_name=file_info['original_name'],
                     mimetype='application/x-sqlite3')


@sqlite_bp.route('/api/sqlite/<file_id>/sql', methods=['POST'])
def execute_sql(file_id):
    file_info = get_uploaded_sqlite_file(file_id)
    if not file_info or not file_info['exists']:
        return api_error('File not found on disk', 404)
    data = request.get_json(silent=True) or {}
    query = (data.get('query') or '').strip()
    if not query:
        return api_error('Query is required', 400)
    try:
        adapter = SQLiteAdapter(file_info['file_path'])
        with adapter.connect() as conn:
            cursor = conn.cursor()
            cursor.execute(query)
            if cursor.description:
                rows = [dict(r) for r in cursor.fetchall()]
                return jsonify(success=True, rows=rows, is_select=True)
            affected = cursor.rowcount
            conn.commit()
            return jsonify(success=True, affected_rows=affected, is_select=False)
    except Exception as error:
        return api_error(error)
