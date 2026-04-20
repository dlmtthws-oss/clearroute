-- ============================================================
-- ClearRoute: Customer CSV Import Migration
-- Run this in the Supabase SQL Editor (project: mskdxzknzblvmflsydjs)
-- ============================================================

-- ── 1. Customers table ────────────────────────────────────────────────────────
-- Create if it doesn't exist (safe to run on new or existing projects)

CREATE TABLE IF NOT EXISTS customers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  address_line_1  text,
  address_line_2  text,
  city            text,
  postcode        text,
  email           text,
  phone           text,
  service_type    text,
  notes           text,
  imported_from   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Add new columns to existing tables (safe — IF NOT EXISTS)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address_line_1 text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address_line_2 text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS city           text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS postcode       text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email          text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone          text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS service_type   text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS notes          text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS imported_from  text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS created_at     timestamptz DEFAULT now();

-- Normalise postcode casing on existing rows (trim + uppercase)
UPDATE customers
SET postcode = UPPER(TRIM(postcode))
WHERE postcode IS NOT NULL AND postcode <> UPPER(TRIM(postcode));

-- ── 2. Import log table ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS import_log (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  imported_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  total_rows   integer     NOT NULL DEFAULT 0,
  successful   integer     NOT NULL DEFAULT 0,
  skipped      integer     NOT NULL DEFAULT 0,
  failed       integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ── 3. Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS customers_name_idx     ON customers (LOWER(name));
CREATE INDEX IF NOT EXISTS customers_postcode_idx ON customers (postcode);
CREATE INDEX IF NOT EXISTS import_log_created_idx ON import_log (created_at DESC);

-- ── 4. Row Level Security ─────────────────────────────────────────────────────

ALTER TABLE customers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_log ENABLE ROW LEVEL SECURITY;

-- Customers: authenticated users have full access
DROP POLICY IF EXISTS "Authenticated full access" ON customers;
CREATE POLICY "Authenticated full access" ON customers
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Import log: authenticated users can read and insert; no deletes for non-admins
-- (Role-based enforcement is handled in the application layer)
DROP POLICY IF EXISTS "Authenticated read import_log" ON import_log;
CREATE POLICY "Authenticated read import_log" ON import_log
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated insert import_log" ON import_log;
CREATE POLICY "Authenticated insert import_log" ON import_log
  FOR INSERT TO authenticated WITH CHECK (true);

-- ── Done ──────────────────────────────────────────────────────────────────────
-- Tables ready:  customers, import_log
-- Next step:     Copy your Supabase anon key into .env (see .env.example)
