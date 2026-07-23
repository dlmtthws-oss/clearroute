-- scan.sql — READ ONLY diagnostic.
--
-- Lists every text-like column in the CURRENT database whose value contains
-- the corrupted plugin-identifier separator U+F03A (UTF-8 bytes EF 80 BA),
-- the private-use-area look-alike that a FAT32-hostile copy tool substituted
-- for the ASCII colon ':' (0x3A) in `vendor/name:version@hash`.
--
-- It enumerates columns from information_schema, so it finds the corruption
-- WHEREVER it is hiding — including inside jsonb/json blobs and tables that
-- are not the "obvious" plugin tables. It changes nothing.
--
-- Prints an empty result set when the database is clean.

\pset footer off

SELECT
  coalesce(
    string_agg(
      format(
        'SELECT %L::text AS db, %L::text AS relation, %L::text AS "column", count(*) AS hits '
        || 'FROM %I.%I WHERE %I::text LIKE %L HAVING count(*) > 0',
        current_database(), table_schema || '.' || table_name, column_name,
        table_schema, table_name, column_name,
        '%' || chr(x'F03A'::int) || '%'
      ),
      E'\nUNION ALL\n'
    ),
    -- Fallback when the DB has no text-like columns at all.
    'SELECT NULL::text AS db, NULL::text AS relation, NULL::text AS "column", 0 AS hits WHERE false'
  )
FROM information_schema.columns
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
  AND udt_name IN ('text', 'varchar', 'bpchar', 'json', 'jsonb')
\gexec
