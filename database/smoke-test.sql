-- Read-only connectivity probe. Safe to run against a populated schema.
--
--   docker compose --env-file ../.env exec -T mysql \
--     mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" < smoke-test.sql
--
-- Expect: the server version, the database you connected to, utf8mb4 for both
-- character set and collation, and 0 tables until Flyway creates them.

SELECT VERSION()                       AS mysql_version,
       DATABASE()                      AS connected_database,
       @@character_set_server          AS server_charset,
       @@collation_server              AS server_collation;

SELECT COUNT(*)                        AS user_tables_present,
       'Flyway owns the schema; 0 is correct in Phase 1' AS note
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_type = 'BASE TABLE';
