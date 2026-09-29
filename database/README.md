# database/

**This folder owns local MySQL provisioning only. It owns no schema.**

Schema authority is Flyway, with versioned SQL under
`backend/src/main/resources/db/migration/`. That arrives with the database phase
(`docs/audit/E-database-model.md` specifies V1-V7, 21 tables). Nothing here creates tables, so
there is never a second definition of the same structure to drift out of sync.

## What is here

| File | Purpose |
|---|---|
| `docker-compose.yml` | A disposable MySQL 8.4 container for development |
| `smoke-test.sql` | Read-only connectivity probe; proves the driver, credentials and schema name without touching data |

## Why the container is published on 3307

This machine already runs a native MySQL service on 3306. Mapping the container to `3307:3306`
lets both coexist. Point the application at it with `MYSQL_PORT=3307`.

## Start it

```bash
cp .env.example .env          # then fill in MYSQL_USER / MYSQL_PASSWORD / MYSQL_ROOT_PASSWORD
cd database
docker compose --env-file ../.env up -d
```

`MYSQL_ROOT_PASSWORD`, `MYSQL_USER` and `MYSQL_PASSWORD` have **no defaults** — an unset value
fails the compose command instead of silently provisioning a well-known weak one, which is
exactly what the old project's `docker-compose.yml` did.

## Verify it

```bash
docker compose exec -T mysql mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" \
  < smoke-test.sql
```

Expected: the server version, the connected database name, and `utf8mb4` for both character set
and collation. `smoke-test.sql` is `SELECT`-only and safe to run against a populated schema.

## Then check the application's view of it

```bash
curl -s localhost:8080/api/v1/ready | python -m json.tool
```

`components.mysql.status` should be `UP`. If it is `DOWN`, the reason and error type are in the
same object; the response never contains a credential value.
