import json
import sqlite3


def parse_sqlite_explain(rows):
    """Normalize SQLite EXPLAIN QUERY PLAN rows into unified execution nodes."""
    nodes = []
    has_full_scan = False
    warning = None

    for r in rows:
        if isinstance(r, (dict, sqlite3.Row)):
            r_id = r.get('id', 0) if isinstance(r, dict) else r['id']
            parent = r.get('parent', 0) if isinstance(r, dict) else r['parent']
            detail = r.get('detail', '') if isinstance(r, dict) else r['detail']
        elif isinstance(r, (list, tuple)):
            r_id = r[0] if len(r) > 0 else 0
            parent = r[1] if len(r) > 1 else 0
            detail = r[3] if len(r) > 3 else (r[2] if len(r) > 2 else '')
        else:
            continue

        detail = str(detail)
        is_scan = 'SCAN ' in detail and 'INDEX' not in detail
        is_index = 'INDEX' in detail or 'SEARCH' in detail
        if is_scan:
            has_full_scan = True
            warning = f"Full table scan detected: {detail}"

        # Extract table name if present: e.g. "SCAN users" or "SCAN TABLE users"
        parts = detail.split()
        table_name = None
        for idx, word in enumerate(parts):
            if word in ('SCAN', 'SEARCH', 'TABLE') and idx + 1 < len(parts):
                cand = parts[idx + 1]
                if cand not in ('TABLE', 'SUBQUERY', 'CONSTANT'):
                    table_name = cand
                    break

        nodes.append({
            'id': r_id,
            'parent': parent,
            'operation': 'Full Table Scan' if is_scan else ('Index Search' if is_index else 'Query Operation'),
            'type': 'SCAN' if is_scan else ('INDEX' if is_index else 'OTHER'),
            'table': table_name,
            'index': 'USING INDEX' if is_index else None,
            'cost': None,
            'rows': None,
            'filter': None,
            'isFullScan': is_scan,
            'detail': detail
        })

    return {
        'engine': 'sqlite',
        'summary': {
            'hasFullScan': has_full_scan,
            'warning': warning,
            'totalCost': None,
            'estimatedRows': None,
            'totalNodes': len(nodes)
        },
        'nodes': nodes,
        'raw': rows
    }


def parse_postgres_explain(pg_data):
    """Normalize PostgreSQL EXPLAIN (FORMAT JSON) into unified execution nodes."""
    nodes = []
    has_full_scan = False
    warning = None

    def walk(node, parent_id=0):
        nonlocal has_full_scan, warning
        node_id = len(nodes) + 1
        node_type = node.get('Node Type', 'Unknown')
        rel_name = node.get('Relation Name') or node.get('Alias', '')
        is_scan = 'Seq Scan' in node_type
        is_index = 'Index' in node_type
        if is_scan:
            has_full_scan = True
            warning = f"Sequential scan on table '{rel_name}'"

        cost = node.get('Total Cost')
        rows = node.get('Plan Rows')
        fltr = node.get('Filter')
        index_name = node.get('Index Name')

        nodes.append({
            'id': node_id,
            'parent': parent_id,
            'operation': node_type,
            'type': 'SCAN' if is_scan else ('INDEX' if is_index else ('JOIN' if 'Join' in node_type else 'OTHER')),
            'table': rel_name or None,
            'index': index_name or None,
            'cost': cost,
            'rows': rows,
            'filter': fltr,
            'isFullScan': is_scan,
            'detail': f"{node_type} on {rel_name}" if rel_name else node_type
        })

        for child in node.get('Plans', []):
            walk(child, node_id)

    raw_plan = pg_data
    if isinstance(pg_data, list) and pg_data and 'Plan' in pg_data[0]:
        walk(pg_data[0]['Plan'])
    elif isinstance(pg_data, dict) and 'Plan' in pg_data:
        walk(pg_data['Plan'])

    return {
        'engine': 'postgresql',
        'summary': {
            'hasFullScan': has_full_scan,
            'warning': warning,
            'totalCost': nodes[0]['cost'] if nodes else None,
            'estimatedRows': nodes[0]['rows'] if nodes else None,
            'totalNodes': len(nodes)
        },
        'nodes': nodes,
        'raw': raw_plan
    }


def parse_mysql_explain(data):
    """Normalize MySQL EXPLAIN FORMAT=JSON or tabular into unified execution nodes."""
    nodes = []
    has_full_scan = False
    warning = None

    if isinstance(data, dict) and 'query_block' in data:
        qb = data['query_block']
        cost_info = qb.get('cost_info', {})
        total_cost = cost_info.get('query_cost')

        def extract_table(tbl, parent_id=0):
            nonlocal has_full_scan, warning
            node_id = len(nodes) + 1
            tbl_name = tbl.get('table_name', '')
            access_type = tbl.get('access_type', '')
            key = tbl.get('key')
            is_scan = access_type in ('ALL', 'index')
            is_index = access_type in ('ref', 'eq_ref', 'const', 'range') or bool(key)
            if is_scan:
                has_full_scan = True
                warning = f"Full table scan (access_type={access_type}) on table '{tbl_name}'"

            rows = tbl.get('rows_examined_per_scan')
            fltr = tbl.get('attached_condition')

            nodes.append({
                'id': node_id,
                'parent': parent_id,
                'operation': f"Table Access ({access_type})",
                'type': 'SCAN' if is_scan else ('INDEX' if is_index else 'OTHER'),
                'table': tbl_name,
                'index': key,
                'cost': tbl.get('cost_info', {}).get('eval_cost'),
                'rows': rows,
                'filter': fltr,
                'isFullScan': is_scan,
                'detail': f"{access_type} on {tbl_name}" + (f" using key {key}" if key else "")
            })

        if 'table' in qb:
            extract_table(qb['table'])
        elif 'nested_loop' in qb:
            for item in qb['nested_loop']:
                if 'table' in item:
                    extract_table(item['table'])

        return {
            'engine': 'mysql',
            'summary': {
                'hasFullScan': has_full_scan,
                'warning': warning,
                'totalCost': total_cost,
                'estimatedRows': nodes[0]['rows'] if nodes else None,
                'totalNodes': len(nodes)
            },
            'nodes': nodes,
            'raw': data
        }

    # Fallback for tabular MySQL EXPLAIN
    if isinstance(data, list):
        for idx, row in enumerate(data):
            row_dict = dict(row) if isinstance(row, dict) else {'row': str(row)}
            access_type = row_dict.get('type', '')
            is_scan = access_type in ('ALL', 'index')
            is_index = access_type in ('ref', 'eq_ref', 'const', 'range') or bool(row_dict.get('key'))
            if is_scan:
                has_full_scan = True
                warning = f"Full table scan on '{row_dict.get('table')}'"

            nodes.append({
                'id': idx + 1,
                'parent': 0,
                'operation': f"Access ({access_type})",
                'type': 'SCAN' if is_scan else ('INDEX' if is_index else 'OTHER'),
                'table': row_dict.get('table'),
                'index': row_dict.get('key'),
                'cost': None,
                'rows': row_dict.get('rows'),
                'filter': row_dict.get('Extra'),
                'isFullScan': is_scan,
                'detail': f"{access_type} on {row_dict.get('table')}"
            })

        return {
            'engine': 'mysql',
            'summary': {
                'hasFullScan': has_full_scan,
                'warning': warning,
                'totalCost': None,
                'estimatedRows': None,
                'totalNodes': len(nodes)
            },
            'nodes': nodes,
            'raw': data
        }

    return {
        'engine': 'mysql',
        'summary': {'hasFullScan': False, 'warning': None, 'totalCost': None, 'estimatedRows': None, 'totalNodes': 0},
        'nodes': [],
        'raw': data
    }
