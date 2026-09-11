import json
import os
import sqlite3
import time
import uuid
from werkzeug.utils import secure_filename

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOAD_DIR = os.path.join(BASE_DIR, 'uploads', 'sqlite')
REGISTRY_DB_FILE = os.path.join(BASE_DIR, 'uploads', 'sqlite_registry.db')

os.makedirs(UPLOAD_DIR, exist_ok=True)


def get_registry_conn():
    conn = sqlite3.connect(REGISTRY_DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn


def init_registry_db():
    with get_registry_conn() as conn:
        conn.cursor().execute('''
            CREATE TABLE IF NOT EXISTS uploaded_files (
                id TEXT PRIMARY KEY,
                original_name TEXT NOT NULL,
                file_path TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                uploaded_at REAL NOT NULL,
                last_opened_at REAL NOT NULL
            )
        ''')
        conn.commit()


init_registry_db()


def save_uploaded_sqlite(file_storage):
    filename = secure_filename(file_storage.filename or 'database.sqlite')
    if not filename:
        filename = 'database.sqlite'
    file_id = str(uuid.uuid4())[:8]
    unique_filename = f"{file_id}_{filename}"
    dest_path = os.path.join(UPLOAD_DIR, unique_filename)
    file_storage.save(dest_path)
    
    file_size = os.path.getsize(dest_path)
    now = time.time()
    
    with get_registry_conn() as conn:
        conn.cursor().execute('''
            INSERT INTO uploaded_files (id, original_name, file_path, file_size, uploaded_at, last_opened_at)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (file_id, filename, dest_path, file_size, now, now))
        conn.commit()
        
    return {
        'id': file_id,
        'original_name': filename,
        'file_path': dest_path,
        'file_size': file_size,
        'uploaded_at': now,
        'last_opened_at': now
    }


def register_local_sqlite_path(path):
    if not os.path.exists(path):
        raise FileNotFoundError(f"File does not exist: {path}")
    filename = os.path.basename(path)
    file_id = str(uuid.uuid4())[:8]
    file_size = os.path.getsize(path)
    now = time.time()
    with get_registry_conn() as conn:
        conn.cursor().execute('''
            INSERT INTO uploaded_files (id, original_name, file_path, file_size, uploaded_at, last_opened_at)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (file_id, filename, path, file_size, now, now))
        conn.commit()
    return {
        'id': file_id,
        'original_name': filename,
        'file_path': path,
        'file_size': file_size,
        'uploaded_at': now,
        'last_opened_at': now
    }


def list_uploaded_sqlite_files():
    with get_registry_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM uploaded_files ORDER BY last_opened_at DESC')
        rows = cursor.fetchall()
        files = []
        for r in rows:
            exists = os.path.exists(r['file_path'])
            current_size = os.path.getsize(r['file_path']) if exists else r['file_size']
            files.append({
                'id': r['id'],
                'original_name': r['original_name'],
                'file_path': r['file_path'],
                'file_size': current_size,
                'uploaded_at': r['uploaded_at'],
                'last_opened_at': r['last_opened_at'],
                'exists': exists
            })
        return files


def get_uploaded_sqlite_file(file_id):
    with get_registry_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM uploaded_files WHERE id = ?', (file_id,))
        r = cursor.fetchone()
        if not r:
            return None
        now = time.time()
        cursor.execute('UPDATE uploaded_files SET last_opened_at = ? WHERE id = ?', (now, file_id))
        conn.commit()
        exists = os.path.exists(r['file_path'])
        return {
            'id': r['id'],
            'original_name': r['original_name'],
            'file_path': r['file_path'],
            'file_size': os.path.getsize(r['file_path']) if exists else r['file_size'],
            'uploaded_at': r['uploaded_at'],
            'last_opened_at': now,
            'exists': exists
        }


def delete_uploaded_sqlite_file(file_id):
    with get_registry_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM uploaded_files WHERE id = ?', (file_id,))
        r = cursor.fetchone()
        if not r:
            return False
        cursor.execute('DELETE FROM uploaded_files WHERE id = ?', (file_id,))
        conn.commit()
        if r['file_path'].startswith(UPLOAD_DIR) and os.path.exists(r['file_path']):
            try:
                os.remove(r['file_path'])
            except OSError:
                pass
        return True
