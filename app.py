import datetime
import decimal
import ipaddress
import uuid

from dotenv import load_dotenv
from flask import Flask, request
from flask.json.provider import DefaultJSONProvider
from flask_cors import CORS

from routes.profiles import profiles_bp
from routes.databases import databases_bp
from routes.sqlite_viewer import sqlite_bp
from services.profiles import init_profiles_db

load_dotenv()
app = Flask(__name__)
CORS(app)


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

# Ensure database tables initialized
init_profiles_db()


@app.context_processor
def inject_profile_context():
    return {'profile_name': request.view_args.get('profile_name', '') if request.view_args else ''}


# Register Blueprints
app.register_blueprint(profiles_bp)
app.register_blueprint(databases_bp)
app.register_blueprint(sqlite_bp)


if __name__ == '__main__':
    app.run(debug=True, port=10992)
