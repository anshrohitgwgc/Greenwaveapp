# Release Process & Versioning

## 1. Versioning Standard
This project follows **Semantic Versioning 2.0.0** (`MAJOR.MINOR.PATCH`):
- `MAJOR`: Breaking API contract changes or database schema redesigns.
- `MINOR`: Backward-compatible new features (e.g. new reports, driver workflow improvements).
- `PATCH`: Backward-compatible bug fixes and security patches.

---

## 2. Release Progression

```
feature/<name> → development → staging tag (vX.Y.Z-rc) → main (vX.Y.Z)
```

1. **Feature Branch**: Create `feature/<feature-name>` from `development`.
2. **Local Validation**: Pass all unit, integration, and security tests locally.
3. **Pull Request**: Open PR to `development`. Require 1 peer review and passing CI.
4. **Staging Build**: Deploy to `staging.gwgcservers.ca`. Run end-to-end smoke and load tests.
5. **Production Release**: Merge to `main`, create Git tag `vX.Y.Z`, execute manual deployment runbook.
