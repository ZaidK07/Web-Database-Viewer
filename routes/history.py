from flask import Blueprint, jsonify, request

from services.query_history import (
    VALID_SOURCES,
    clear_history,
    delete_entry,
    list_history,
    set_starred,
)

history_bp = Blueprint('history', __name__)


def _scope_args(source_data):
    source = source_data.get('source') or 'server'
    if source not in VALID_SOURCES:
        raise ValueError('Invalid history source')
    return source, source_data.get('profile') or '', source_data.get('db') or None


@history_bp.route('/api/history', methods=['GET'])
def get_history():
    try:
        source, profile, db = _scope_args(request.args)
        entries = list_history(
            source, profile, dbname=db,
            search=(request.args.get('q') or '').strip() or None,
            starred_only=request.args.get('starred') in ('1', 'true'),
            limit=request.args.get('limit', 200),
        )
        return jsonify(success=True, history=entries)
    except ValueError as error:
        return jsonify(success=False, error=str(error)), 400
    except Exception as error:
        return jsonify(success=False, error=str(error)), 500


@history_bp.route('/api/history', methods=['DELETE'])
def delete_history():
    try:
        source, profile, db = _scope_args(request.args)
        keep_starred = request.args.get('keep_starred', '1') not in ('0', 'false')
        removed = clear_history(source, profile, dbname=db, keep_starred=keep_starred)
        return jsonify(success=True, removed=removed)
    except ValueError as error:
        return jsonify(success=False, error=str(error)), 400
    except Exception as error:
        return jsonify(success=False, error=str(error)), 500


@history_bp.route('/api/history/<int:entry_id>', methods=['PATCH', 'DELETE'])
def history_entry(entry_id):
    try:
        if request.method == 'DELETE':
            ok = delete_entry(entry_id)
        else:
            data = request.get_json(silent=True) or {}
            ok = set_starred(entry_id, bool(data.get('starred')))
        if not ok:
            return jsonify(success=False, error='History entry not found'), 404
        return jsonify(success=True)
    except Exception as error:
        return jsonify(success=False, error=str(error)), 500
