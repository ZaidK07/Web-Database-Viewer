# Contributing to Web Database Viewer

Thank you for considering contributing to Web Database Viewer.

We welcome contributions of all types: bug fixes, feature proposals, UI enhancements, documentation improvements, and adapter expansions for additional database engines.

By participating, you agree to adhere to our [Code of Conduct](CODE_OF_CONDUCT.md) and uphold the principles of free software under the [GNU General Public License v3.0 (GPLv3)](LICENSE).

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
  - [Reporting Bugs](#reporting-bugs)
  - [Suggesting Enhancements](#suggesting-enhancements)
  - [Code Contributions](#code-contributions)
- [Local Development Setup](#local-development-setup)
- [Coding Standards](#coding-standards)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [License Notice](#license-notice)

---

## Code of Conduct

This project is governed by the [Contributor Covenant v2.1](CODE_OF_CONDUCT.md). By participating in this project, you are expected to uphold this code. Please report unacceptable behavior to the project maintainers.

---

## How Can I Contribute?

### Reporting Bugs

Before creating an issue, search the issue tracker to avoid duplicates.

When opening an issue, please use our [Bug Report Template](.github/ISSUE_TEMPLATE/bug_report.md) and include:
* A clear, descriptive title.
* Steps to reproduce the issue.
* The database engine and version used (for example, MySQL 8.0, PostgreSQL 15, SQLite 3.40).
* Operating system and Python version.
* Terminal logs or browser console errors (if relevant).

### Suggesting Enhancements

Feature requests are welcome. Use our [Feature Request Template](.github/ISSUE_TEMPLATE/feature_request.md) to describe:
* The problem or limitation you are trying to solve.
* The proposed solution or behavior.
* Potential alternatives or mockups (if applicable).

### Code Contributions

1. Look through open issues or propose your idea first if it involves significant changes.
2. Fork the repository and create a new branch from `main`.
3. Follow the development setup below to verify your changes locally.

---

## Local Development Setup

### 1. Prerequisites
- Python 3.10+
- Git
- A local or containerized database instance (MySQL or PostgreSQL) for integration testing.

### 2. Fork and Clone

```bash
git clone https://github.com/<your-username>/Web-Database-Viewer.git
cd Web-Database-Viewer
```

### 3. Environment Setup

```bash
python3 -m venv .venv
source .venv/bin/activate    # On Windows: .venv\Scripts\activate
pip install --upgrade pip
pip install -r requirements.txt
```

### 4. Run Development Server

```bash
python3 -m app
```
The server will boot with debug mode on `http://127.0.0.1:10992`.

---

## Coding Standards

### Backend (Python / Flask)
* Adhere to PEP 8 naming conventions and formatting.
* Structure new functionality into the appropriate layer:
  * Database-specific driver code: `adapters/`
  * Business logic and persistence: `services/`
  * HTTP routing, request parsing, response formatting: `routes/`
* Ensure exceptions from adapters are handled gracefully and return clean JSON error payloads (`api_error(error)`).
* Avoid adding large third-party dependencies unless strictly necessary.

### Frontend (Vue 3 / Tailwind CSS)
* Maintain the zero-CDN offline philosophy: do not introduce CDN URLs (`<script src="https://cdn...">`). All client assets must reside in `static/vendor/`.
* Follow dark/light mode consistency using Tailwind's `dark:` utility variants.
* Keep client state reactive and provide immediate user feedback (such as toasts, loading spinners, and confirmation dialogs for destructive actions).

---

## Submitting a Pull Request

1. Commit Hygiene:
   * Write concise, meaningful commit messages describing what and why.
   * Keep commits focused; avoid mixing unrelated changes into a single PR.
2. Push Branch:
   ```bash
   git push origin feature/your-feature-name
   ```
3. Open PR:
   * Open a PR against the `main` branch.
   * Fill out the [Pull Request Template](.github/PULL_REQUEST_TEMPLATE.md).
   * Reference any related issues (such as `Closes #12`).

---

## License Notice

All contributions to this repository are licensed under the [GNU General Public License v3.0 (GPLv3)](LICENSE). By submitting a pull request, you agree that your code will be released under this license.
