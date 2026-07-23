-- scan.sql — READ ONLY diagnostic. Codepoint-agnostic, scoped to plugin ids.
--
-- Lists every value in the CURRENT database that (a) looks like a plugin
-- identifier — it contains both '/' and '@' — and (b) holds a non-ASCII byte,
-- detected structurally as octet_length <> char_length. For each hit it prints
-- the value and its UTF-8 hex, so you can read off the REAL corrupted codepoint
-- instead of guessing.
--
-- Why this shape:
--  * Codepoint-agnostic — the incident notes guessed the bad separator twice
--    (U+FF1A, then U+F03A). Any non-ASCII byte in a plugin identifier is wrong;
--    the hex tells you exactly which one, whatever it is.
--  * Scoped to '/'...'@' values — plugin identifiers are pure ASCII, but other
--    columns legitimately hold non-ASCII (descriptions, user data, emoji). The
--    guard keeps those out, so a hit here always means real corruption. It is
--    the same guard sql/repair.sql applies, so scan and repair agree.
--  * Finds it wherever it hides, including inside jsonb/json blobs.
--
-- Prints an empty result set when the database is clean. Changes nothing.

\pset footer off

SELECT
  coalesce(
    string_agg(
      format(
        '(SELECT %L::text AS relation, %L::text AS "column", left(%I::text,80) AS value, '
        || 'encode(convert_to(%I::text,''UTF8''),''hex'') AS hex '
        || 'FROM %I.%I WHERE octet_length(%I::text) <> char_length(%I::text) '
        || 'AND %I::text LIKE ''%%/%%@%%'' LIMIT 5)',
        table_schema || '.' || table_name, column_name, column_name, column_name,
        table_schema, table_name, column_name, column_name, column_name
      ),
      E'\nUNION ALL\n'
    ),
    'SELECT NULL::text AS relation, NULL::text AS "column", NULL::text AS value, NULL::text AS hex WHERE false'
  )
FROM information_schema.columns
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
  AND udt_name IN ('text', 'varchar', 'bpchar', 'json', 'jsonb')
\gexec
