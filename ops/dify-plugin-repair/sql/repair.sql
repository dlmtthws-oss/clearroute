-- repair.sql — WRITES. Run scan.sql first, read the hex, take a backup.
--
-- Maps the known colon look-alikes back to an ASCII colon ':' in every
-- updatable text-like column of the CURRENT database, but ONLY inside values
-- shaped like a plugin identifier (they contain both '/' and '@'). That guard
-- means legitimate non-ASCII text elsewhere — descriptions, user data, emoji —
-- is never touched.
--
-- Handled codepoints (all render as / substitute for ':' after a FAT32-style
-- transliteration):
--   U+F03A  private-use-area look-alike   (UTF-8 EF 80 BA)
--   U+FF1A  fullwidth colon               (UTF-8 EF BC 9A)
--   U+2236  ratio                         (UTF-8 E2 88 B6)
--   U+A789  modifier letter colon         (UTF-8 EA 9E 89)
-- If scan.sql shows a codepoint NOT in this list, add its chr(x'XXXX'::int) to
-- badset below before running.
--
-- Reports how many rows it fixed per column, and a total. Idempotent: a value
-- with a real colon already contains no look-alike, so re-running is a no-op.

\set ON_ERROR_STOP on

DO $repair$
DECLARE
  r      record;
  badset text := chr(x'F03A'::int) || chr(x'FF1A'::int) || chr(x'2236'::int) || chr(x'A789'::int);
  n      int;
  total  int := 0;
BEGIN
  FOR r IN
    SELECT table_schema AS s, table_name AS t, column_name AS c, udt_name AS u
    FROM information_schema.columns
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      AND udt_name IN ('text', 'varchar', 'bpchar', 'json', 'jsonb')
      AND is_updatable = 'YES'
  LOOP
    EXECUTE format(
      'UPDATE %I.%I SET %I = translate(%I::text, $1, $2)::%s '
      'WHERE %I::text LIKE ''%%/%%@%%'' AND %I::text ~ (''['' || $1 || '']'')',
      r.s, r.t, r.c, r.c, r.u, r.c, r.c
    )
    USING badset, repeat(':', length(badset));
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      RAISE NOTICE 'fixed % row(s) in %.%.%', n, r.s, r.t, r.c;
      total := total + n;
    END IF;
  END LOOP;
  RAISE NOTICE 'TOTAL plugin-identifier rows repaired: %', total;
END
$repair$;
