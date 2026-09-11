# Security Policy

## Supported Versions

Security updates are actively applied to the latest release on the `main` branch.

| Version / Branch | Supported |
| ---------------- | --------- |
| `main`           | Yes       |
| Legacy releases  | No        |

---

## Reporting a Vulnerability

We take the security of Web Database Viewer seriously. If you discover a vulnerability or potential security risk, please follow responsible disclosure guidelines.

Do not report security vulnerabilities through public GitHub issues.

Instead, report vulnerabilities privately:
1. GitHub Private Vulnerability Reporting: If enabled on the repository, submit via Security -> Advisories -> Report a vulnerability.
2. Direct Contact: Reach out privately to the repository owner via their GitHub profile or contact email.

### What to include in your report:
* Type of vulnerability (for example: SQL Injection bypass, Cross-Site Scripting, Path Traversal, SSRF).
* Clear, step-by-step instructions or Proof of Concept (PoC) to reproduce the vulnerability.
* Affected components (such as a specific route, database adapter, or template).
* Potential impact and severity.
* Suggested fix or remediation (if available).

### Response Timeline:
* Acknowledgment: Within 48 hours of initial receipt.
* Assessment and Patch Development: A timeline will be coordinated with the reporter.
* Public Disclosure: Once a fix has been tested, merged, and released.

---

## Deployment and Security Best Practices

Because Web Database Viewer connects to database engines and allows arbitrary SQL execution:

1. Network Isolation:
   * Run the application bound to `localhost` (`127.0.0.1`) whenever possible.
   * If accessing remotely, place the application inside a private VPN or behind a reverse proxy (such as Nginx, Caddy, or Cloudflare Access).

2. Authentication and Access Control:
   * The application does not contain built-in multi-tenant user authentication.
   * Ensure any publicly reachable instances are protected with HTTP Basic Authentication, OAuth2 proxy, or IP allowlisting at the reverse proxy layer.

3. Database User Privileges:
   * Connect to production databases using a dedicated database user with least-privilege permissions (for example, a read-only user if data editing is not required).
   * Avoid connecting using root/superuser credentials when viewing untrusted databases.

4. Credential Security:
   * Server credentials are saved in the local SQLite database (`profiles.db`).
   * Keep filesystem permissions on `profiles.db` restricted to the host user running the application process (`chmod 600 profiles.db`).
   * Never commit `profiles.db` or `.env` to version control.
