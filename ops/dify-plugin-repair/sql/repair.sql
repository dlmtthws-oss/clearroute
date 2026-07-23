-- repair.sql — WRITES. Run scan.sql first and take a backup.
--
-- Replaces every corrupted separator U+F03A (UTF-8 EF 80 BA) with a real
-- ASCII colon ':' (0x3A) in every updatable text-like column of the CURRENT
-- database. Runs in a single transaction: if any statement fails, nothing is
-- committed.
--
-- Only rows that actually contain U+F03A are touched (WHERE ... LIKE), so a
-- clean identifier that already uses a real colon is left exactly as-is — no
-- risk of doubling a colon. jsonb/json columns are cast to text, repaired,
-- and cast back, preserving their structure.

\pset footer off
\set ON_ERROR_STOP on

BEGIN;

SELECT
  coalesce(
    string_agg(
      format(
        'UPDATE %I.%I SET %I = replace(%I::text, chr(x''F03A''::int), '':'')::%s '
        || 'WHERE %I::text LIKE %L',
        table_schema, table_name, column_name, column_name, udt_name,
        column_name, '%' || chr(x'F03A'::int) || '%'
      ),
      E';\n'
    ) || ';',
    'SELECT 1 WHERE false'
  )
FROM information_schema.columns
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
  AND udt_name IN ('text', 'varchar', 'bpchar', 'json', 'jsonb')
  AND is_updatable = 'YES'
\gexec

COMMIT;
