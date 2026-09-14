<div align="center">

# Web Database Viewer

**A modern, lightweight, privacy-focused web interface to browse, inspect, and manage MySQL, PostgreSQL, and SQLite databases.**

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Python Version](https://img.shields.io/badge/python-3.10%2B-blue.svg)](https://www.python.org/downloads/)
[![Framework](https://img.shields.io/badge/framework-Flask-lightgrey.svg)](https://flask.palletsprojects.com/)
[![Frontend](https://img.shields.io/badge/frontend-Vue%203%20%7C%20Tailwind%20CSS-38bdf8.svg)](https://tailwindcss.com)
[![Offline Ready](https://img.shields.io/badge/dependencies-100%25%20Vendored%20Offline-success.svg)](#privacy-and-offline-first-architecture)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

<p align="center">
  <a href="#key-features">Key Features</a> &bull;
  <a href="#architecture">Architecture</a> &bull;
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#configuration">Configuration</a> &bull;
  <a href="#api-reference">API Reference</a> &bull;
  <a href="#contributing">Contributing</a> &bull;
  <a href="#license">License</a>
</p>

</div>

---

## Overview

**Web Database Viewer** is an open-source, web-based database management interface designed for developers, database administrators, and data analysts who need a nimble, responsive client without the bloat of heavyweight desktop GUI tools like DBeaver or phpMyAdmin.

Engineered with a modular Flask backend and a modern Vue 3 / Tailwind CSS reactive frontend, it provides an intuitive web interface for managing multi-engine databases on your local machine, in Docker, or across remote cloud instances. All frontend assets (fonts, icons, stylesheets, scripts) are **100% vendored locally**, ensuring full functionality in strictly air-gapped or offline development environments.

---

## Key Features

### Multi-Server Profile Management
* **Multi-Engine Connections:** Native support for **MySQL**, **PostgreSQL**, and **SQLite**.
* **Zero-Restart Profile Switching:** Create, modify, and switch between isolated server connection profiles in real time directly from the UI.
* **Persistent Configuration:** Profile credentials and custom database bookmark lists are safely stored in a local SQLite application database (`profiles.db`).
* **SSL and Advanced Connection Options:** Configurable SSL modes (`require`, `prefer`, `disable`), schemas (PostgreSQL search path), ports, and hosts.

### Interactive Data Grid and Table Viewer
* **High-Performance Pagination:** Dynamically paginate through hundreds of thousands of records with configurable page sizes (25, 50, 100, 250 rows).
* **Column Sorting and Instant Search:** Sort ascending/descending by clicking table headers; execute real-time keyword search across all indexed columns.
* **Dedicated Cell Editor Modal:** Double-click cell editing in an intuitive modal with "Set to NULL" toggle, character counter, and keyboard shortcuts (`Cmd/Ctrl+Enter` to save, `Esc` to cancel).
* **Value Inspector Modal (JSON & Text):** Hover over cells with JSON or long text to open a dedicated syntax-highlighted code inspector with Formatted/Raw toggle, character/line counts, one-click clipboard copy, and quick edit shortcut.
* **Batch Row Deletion (Selection Mode):** Toggleable multi-row selection mode that displays checkboxes on demand without cluttering the normal view, complete with "Select All" header toggle, row selection highlights, and a batch "Delete Selected (N)" confirmation action.
* **Foreign Key Badges:** Automatically inspects schema constraints and highlights relational foreign keys with reference tooltips.

### Comprehensive Schema and Relationship Inspector
* **Table and View Breakdown:** List physical tables alongside SQL views in categorized sidebars.
* **Column Details:** Detailed field inspection showing SQL column data types, nullability, default values, primary keys, and auto-increment properties.
* **Foreign Key Mappings:** Interactive view showing source column, target table, and target column relationships.

### Interactive SQL Console
* **Arbitrary Query Execution:** Run custom `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `JOIN`, or `CREATE` statements directly from your browser.
* **Dual Output Mode:** Automatically formats `SELECT` queries into an interactive tabular view, or displays affected row counts and execution status for DDL/DML queries.
* **Graceful Error Reporting:** Descriptive SQL execution error banners highlighting query syntax mistakes without crashing the app.

### Standalone SQLite Explorer
* **Drag-and-Drop File Upload:** Inspect any `.db`, `.sqlite`, or `.sqlite3` file on demand.
* **File Registry:** Uploaded files are cataloged with file metadata (size, upload timestamp, last accessed).
* **No Database Server Required:** Perform instant table browsing and SQL querying on standalone files without spinning up daemon processes.

### Import and Export
* **CSV Export:** Stream filtered or full table datasets directly into standard `.csv` files for spreadsheets and reporting.
* **Database SQL Dump:** Export entire databases as `.sql` scripts using automated `mysqldump` and `pg_dump` integration.
* **SQL Import:** Upload and restore schema/data directly into your target database.

### Privacy and Offline-First Architecture
* **No External CDN Calls:** All fonts (Outfit font family), Phosphor SVG icon sets, Vue 3 runtime, and Tailwind CSS engine are bundled directly inside `/static/vendor/`.
* **Zero Telemetry:** No analytics, tracking pixels, or external API pings. Your data never leaves your environment.

---

## Architecture

The application is structured into decoupled, single-responsibility modules:

```text
Web-Database-Viewer/
├── adapters/                  # Engine-specific database abstraction layer
│   ├── __init__.py            # Adapter registry
│   ├── mysql.py               # PyMySQL adapter (introspection, queries, mysqldump)
│   ├── postgres.py            # Psycopg adapter (schemas, quoting, pg_dump)
│   └── sqlite.py              # SQLite3 adapter (file-based introspection)
├── routes/                    # Flask blueprints (RESTful endpoints & views)
│   ├── __init__.py            # Blueprint registry
│   ├── profiles.py            # Server profile CRUD and active profile switcher
│   ├── databases.py           # Table inspector, data grid, mutation, SQL console
│   └── sqlite_viewer.py       # Standalone SQLite file viewer & upload registry
├── services/                  # Business logic & persistence services
│   ├── __init__.py            # Service exports
│   ├── profiles.py            # SQLite metadata storage (`profiles.db`) & migrations
│   └── sqlite_storage.py      # Uploaded SQLite file management & file registry
├── static/                    # Vendored static assets (100% offline)
│   ├── fonts/                 # Outfit web fonts (woff2)
│   └── vendor/                # Phosphor icons, Tailwind script, Vue 3 runtime
├── templates/                 # Jinja2 HTML templates
│   ├── base.html              # Master layout, navigation, dark mode, toast alerts
│   ├── profile_selector.html  # Server profile management dashboard
│   ├── index.html             # Profile database list dashboard
│   ├── database.html          # Table data grid, schema viewer, and SQL console
│   └── sqlite_viewer.html     # Dedicated SQLite file viewer interface
├── app.py                     # Application entry point and JSON provider setup
├── requirements.txt           # Python dependency specifications
├── run.sh                     # Launch script
└── LICENSE                    # GNU General Public License v3.0
```

---

## Quick Start

### Prerequisites
* **Python 3.10+**
* (Optional) **MySQL Client** (`mysql`, `mysqldump`) if you plan to import/export MySQL dumps.
* (Optional) **PostgreSQL Client** (`psql`, `pg_dump`) if you plan to import/export PostgreSQL dumps.

### 1. Clone the Repository

```bash
git clone https://github.com/ZaidK07/Web-Database-Viewer.git
cd Web-Database-Viewer
```

### 2. Create and Activate a Virtual Environment

```bash
# On macOS / Linux
python3 -m venv .venv
source .venv/bin/activate

# On Windows (PowerShell)
python -m venv .venv
.venv\Scripts\Activate.ps1
```

### 3. Install Dependencies

```bash
pip install --upgrade pip
pip install -r requirements.txt
```

### 4. Configure Environment Variables (Optional)

Create a `.env` file in the root directory to customize defaults:

```env
# Default Fallback Connection (optional)
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
```

### 5. Launch the Server

Using the convenience launcher:
```bash
chmod +x run.sh
./run.sh
```

Or directly via Python:
```bash
python3 -m app
```

### 6. Access the Web Interface
Open your browser and navigate to:
```text
http://127.0.0.1:10992
```

---

## Configuration

### Default Ports and Connection Details

| Database Engine | Default Port | Default User | Default Schema |
| :--- | :--- | :--- | :--- |
| **MySQL** | `3306` | `root` | N/A |
| **PostgreSQL** | `5432` | `postgres` | `public` |
| **SQLite** | Local file | N/A | N/A |

### Application Files
* **`profiles.db`**: SQLite database created automatically on first run to store profile connection definitions and metadata. Automatically gitignored for security.
* **`uploads/`**: Directory where standalone uploaded SQLite databases and registry records are stored.

---

## API Reference

The backend exposes a clean JSON REST API used by the frontend:

### Server Profiles
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/profiles` | List all saved server profiles and current active profile |
| `POST` | `/api/profiles` | Create a new connection profile |
| `PUT` | `/api/profiles/<name>` | Update an existing profile configuration |
| `DELETE` | `/api/profiles/<name>` | Remove a server profile |
| `PUT` | `/api/profiles/active` | Switch the active server profile |

### Database and Table Operations
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/p/<profile>/dbs/list` | Get configured databases for a profile |
| `POST` | `/api/p/<profile>/dbs` | Add a database to the profile watchlist |
| `DELETE` | `/api/p/<profile>/dbs/<dbname>` | Remove a database from the watchlist |
| `GET` | `/api/p/<profile>/dbs/<dbname>/check` | Test connectivity to a specific database |
| `GET` | `/api/p/<profile>/db/<dbname>/schema` | Fetch list of tables, views, and column schemas |
| `GET` | `/api/p/<profile>/db/<dbname>/table/<table\>/data` | Paginated rows, sorting, filtering, and foreign keys |
| `POST` | `/api/p/<profile>/db/<dbname>/table/<table\>/row` | Insert a new row |
| `PUT` | `/api/p/<profile>/db/<dbname>/table/<table\>/row` | Update an existing row by primary key |
| `DELETE` | `/api/p/<profile>/db/<dbname>/table/<table\>/row` | Delete a row by primary key |
| `POST` | `/api/p/<profile>/sql` | Execute arbitrary SQL queries |
| `GET` | `/api/p/<profile>/db/<dbname>/table/<table\>/export/csv` | Download table records as CSV |
| `GET` | `/api/p/<profile>/db/<dbname>/export` | Download full SQL dump of database |
| `POST` | `/api/p/<profile>/dbs/import` | Upload and restore a SQL dump file |

### Standalone SQLite Viewer
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/sqlite/files` | List all uploaded / registered SQLite files |
| `POST` | `/api/sqlite/upload` | Upload a new `.sqlite` or `.db` file |
| `DELETE` | `/api/sqlite/files/<id>` | Delete an uploaded SQLite database file |

---

## Contributing

Contributions make the open-source community an excellent place to learn, build, and share. Any contributions you make are greatly appreciated.

Please see our [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on code standards, development setup, and submitting pull requests.

Please also review our [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before participating in this project.

---

## Security and Safe Usage

Web Database Viewer connects directly to database servers and can execute DDL/DML queries. If deploying in team environments:
* **Do not expose without authentication:** Always place behind a secure reverse proxy (such as Nginx, Caddy, or Cloudflare Tunnel) with HTTP Basic Auth, OAuth2, or VPN access.
* Review our complete [SECURITY.md](SECURITY.md) for vulnerability disclosure procedures and configuration recommendations.

---

## License

This project is licensed under the terms of the **GNU General Public License v3.0 (GPLv3)**.

You are free to use, modify, study, and share this software under the conditions of the GPLv3. See the [LICENSE](LICENSE) file for full license text and terms.
