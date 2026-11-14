# Application archives

The complete app before the 2026-11-11 restart is preserved locally in `app-2026-11-11-before-restart/`, including source, migrations, docs, ignored environment files and review state. No hosted database or marketing source was changed. This directory is ignored because it includes local credentials.

`ARCHIVE-MANIFEST.json` records SHA-256 hashes for 266 original files (excluding dependency/build caches). Every hash was verified after moving the directory. Dependency/build caches are also preserved but not hashed.

To restore: stop the fresh app, rename the fresh `app/` to a separate backup, then move this archived directory to `app/`. Do not overwrite either directory. The old schema remains available only in the archive; never automatically apply it to a hosted database.
