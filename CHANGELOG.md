# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- **Value Inspector Modal**: Dedicated inspection modal for table cells containing JSON or lengthy text:
  - Formatted vs. Raw view toggle with automatic JSON indentation and syntax highlighting.
  - Line count, character count, and single-click copy to clipboard.
  - Quick transition to Cell Editor Modal for immediate editing.
- **Dedicated Cell Edit Modal**: Replaced inline table editing with a focused modal:
  - Supports text, multiline JSON/blobs, and explicit `NULL` value setting.
  - Column metadata display (type, nullability, key status).
- **Batch Row Deletion**:
  - Non-polluting "Batch Select" toolbar toggle to activate/deactivate multi-row selection mode without visual clutter.
  - Master "Select All" checkbox and per-row checkboxes with visual row highlight.
  - Dynamic "Delete Selected (N)" action with confirmation modal and batch DELETE API endpoints for MySQL, PostgreSQL, and SQLite.
- **Raw SQL Panel Docking**:
  - Toggle between Right Sidebar and Bottom Drawer layout positions with smooth slide transitions and persistent preference.
- **Column Visibility & Reordering**:
  - Clever, minimal, non-polluting "Columns" toolbar dropdown with real-time column search filtering.
  - Checkbox toggles to selectively show or hide columns (ideal for wide tables with 25+ columns).
  - Quick action shortcuts: "Show All", "Only PKs", and "Reset".
  - Column reordering via single-click Up / Down caret buttons and HTML5 drag-and-drop.
  - Per-table preference persistence in `localStorage` preserving hidden state and ordering across sessions.
- Comprehensive open-source documentation suite:
  - Insanely detailed `README.md` with system architecture and full API reference.
  - `CONTRIBUTING.md` guide for open-source contributors.
  - `CODE_OF_CONDUCT.md` (Contributor Covenant v2.1).
  - `SECURITY.md` deployment best practices and vulnerability disclosure policy.
  - GitHub issue templates (`bug_report.md`, `feature_request.md`) and pull request template.
- GNU General Public License v3.0 (`LICENSE`).

### Changed
- Refactored frontend logic into reusable modules:
  - `static/js/viewer-utils.js`: Shared Value Inspector and Batch Selection controller modules.
  - `templates/components/inspector_modal.html`: Shared Jinja partial for the value inspector modal.

### Fixed
- Fixed `ModuleNotFoundError: No module named 'routes.profiles'` by creating `routes/profiles.py` and `services/profiles.py`.
- Corrected `.gitignore` rule to explicitly ignore `profiles.db*` and `profiles.json` without blocking Python modules.

---

## [1.1.0] - 2026-09-11

### Added
- **Full Offline & Privacy Support**: Vendored all frontend assets locally in `/static/vendor/`:
  - Outfit variable font family.
  - Phosphor icon set (Regular, Bold, Duotone, Fill, Light, Thin).
  - Tailwind CSS standalone runtime.
  - Vue 3 global runtime.
- **Dedicated SQLite Viewer**:
  - File picker allowing any SQLite extension (`.sqlite`, `.db`, `.sqlite3`).
  - SQLite file registry service with metadata tracking.
  - Aligned SQLite data grid with main database viewer features (pagination, sorting, quick search).
- **Multi-Server Profiles**:
  - Full CRUD operations for MySQL and PostgreSQL server profiles.
  - Real-time profile switching without restarting the application.

### Changed
- Refactored monolithic backend into modular architecture:
  - `adapters/`: PyMySQL, Psycopg, and SQLite abstraction layers.
  - `services/`: Profile management and SQLite file registry.
  - `routes/`: Decoupled Flask blueprints (`databases_bp`, `profiles_bp`, `sqlite_bp`).

---

## [1.0.0] - Initial Release

### Added
- Core web interface for database inspection.
- MySQL and PostgreSQL database connectivity.
- Table schema inspection and row mutation (insert, update, delete).
- SQL query execution console.
- CSV and SQL export/import utilities.
