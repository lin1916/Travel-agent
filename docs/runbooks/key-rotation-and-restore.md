# Key rotation and restore

Publish a new KMS version, deploy readers that support both current and previous versions, then switch writes to the new version. Retain old keys until retention obligations expire. For PostgreSQL restore, perform a point-in-time recovery into an isolated instance, run migrations (including append-only `013_audit`), verify audit/event counts, and only then promote traffic. Never discard audit rows to make a restore pass.
