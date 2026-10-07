import threading
import time
from collections import deque


class PooledConnection:
    """Wrapper around a DB-API connection that returns it to the pool on close/exit."""

    def __init__(self, raw_conn, pool, pool_key):
        self._raw_conn = raw_conn
        self._pool = pool
        self._pool_key = pool_key
        self._returned = False

    def close(self):
        if not self._returned:
            self._returned = True
            if self._pool:
                self._pool.release(self._pool_key, self._raw_conn)
            else:
                try:
                    self._raw_conn.close()
                except Exception:
                    pass

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type is not None:
            try:
                self._raw_conn.rollback()
            except Exception:
                pass
        self.close()
        return False

    def __getattr__(self, name):
        return getattr(self._raw_conn, name)


class ConnectionPool:
    """Thread-safe connection pool with health checks and idle eviction."""

    def __init__(self, max_size=5, max_idle_seconds=180):
        self.max_size = max_size
        self.max_idle_seconds = max_idle_seconds
        self._pools = {}
        self._lock = threading.Lock()

    def get_connection(self, pool_key, creator_fn, validator_fn=None):
        now = time.time()
        conn = None

        with self._lock:
            queue = self._pools.get(pool_key)
            if queue:
                while queue:
                    candidate, last_used = queue.pop()
                    if now - last_used > self.max_idle_seconds:
                        self._close_conn(candidate)
                        continue
                    if validator_fn:
                        try:
                            if not validator_fn(candidate):
                                self._close_conn(candidate)
                                continue
                        except Exception:
                            self._close_conn(candidate)
                            continue
                    conn = candidate
                    break

        if conn is None:
            conn = creator_fn()

        return PooledConnection(conn, self, pool_key)

    def release(self, pool_key, conn):
        now = time.time()
        with self._lock:
            if pool_key not in self._pools:
                self._pools[pool_key] = deque()
            queue = self._pools[pool_key]
            if len(queue) < self.max_size:
                # Rollback any uncommitted transaction before putting back
                try:
                    if hasattr(conn, 'rollback'):
                        conn.rollback()
                except Exception:
                    self._close_conn(conn)
                    return
                queue.append((conn, now))
            else:
                self._close_conn(conn)

    def clear(self, key_prefix=None):
        """Close and discard all connections matching key_prefix, or all if None."""
        with self._lock:
            keys = list(self._pools.keys())
            for k in keys:
                if key_prefix is None or (isinstance(k, tuple) and k[0] == key_prefix):
                    queue = self._pools.pop(k, deque())
                    while queue:
                        conn, _ = queue.pop()
                        self._close_conn(conn)

    @staticmethod
    def _close_conn(conn):
        try:
            conn.close()
        except Exception:
            pass


# Global pool singleton
global_pool = ConnectionPool(max_size=8, max_idle_seconds=180)
