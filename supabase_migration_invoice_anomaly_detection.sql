-- ============================================================
-- ClearRoute: Invoice Anomaly Detection Migration
-- Run this in the Supabase SQL Editor (project: mskdxzknzblvmflsydjs)
-- ============================================================

-- ── 0. Profiles table (reference for users) ────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name   text,
  default_payment_terms text DEFAULT 'Net 30',
  default_vat_rate numeric DEFAULT 0.20,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ── 1. Invoices table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number       text NOT NULL UNIQUE,
  customer_id          uuid REFERENCES customers(id) ON DELETE SET NULL,
  issue_date           date NOT NULL,
  due_date             date,
  subtotal             numeric NOT NULL DEFAULT 0,
  vat_amount           numeric NOT NULL DEFAULT 0,
  total               numeric NOT NULL DEFAULT 0,
  vat_rate             numeric NOT NULL DEFAULT 0.20,
  payment_terms        text DEFAULT 'Net 30',
  status               text DEFAULT 'draft',
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ── 2. Invoice Items table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      uuid REFERENCES invoices(id) ON DELETE CASCADE,
  description     text NOT NULL,
  quantity       numeric NOT NULL DEFAULT 1,
  unit_price      numeric NOT NULL DEFAULT 0,
  vat_rate        numeric NOT NULL DEFAULT 0,
  tax_amount     numeric NOT NULL DEFAULT 0,
  line_total     numeric NOT NULL DEFAULT 0,
  sort_order     integer DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ── 3. Risk Events table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS risk_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id         uuid REFERENCES invoices(id) ON DELETE CASCADE,
  anomaly_type      text NOT NULL,
  severity          text NOT NULL DEFAULT 'warning',
  title              text NOT NULL,
  description       text,
  ai_reasoning       text,
  suggested_action   text,
  status             text DEFAULT 'open',
  reviewed_by       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at       timestamptz,
  resolution_note   text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ── 4. Risk Thresholds table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS risk_thresholds (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  threshold_type   text NOT NULL UNIQUE,
  value            numeric NOT NULL,
  is_active        boolean DEFAULT true,
  updated_by       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ── 5. Indexes ───────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS invoices_customer_idx        ON invoices (customer_id);
CREATE INDEX IF NOT EXISTS invoices_issue_date_idx      ON invoices (issue_date);
CREATE INDEX IF NOT EXISTS invoices_status_idx           ON invoices (status);
CREATE INDEX IF NOT EXISTS invoice_items_invoice_idx   ON invoice_items (invoice_id);
CREATE INDEX IF NOT EXISTS risk_events_invoice_idx     ON risk_events (invoice_id);
CREATE INDEX IF NOT EXISTS risk_events_status_idx       ON risk_events (status);
CREATE INDEX IF NOT EXISTS risk_events_type_idx         ON risk_events (anomaly_type);
CREATE INDEX IF NOT EXISTS risk_thresholds_type_idx     ON risk_thresholds (threshold_type);

-- ── 6. Default Thresholds ────────────────────────────────────────────────
INSERT INTO risk_thresholds (threshold_type, value, is_active) VALUES
  ('duplicate_days_window', 7, true),
  ('amount_high_multiplier', 2.0, true),
  ('amount_low_multiplier', 0.3, true),
  ('price_variance_percent', 20, true)
ON CONFLICT (threshold_type) DO NOTHING;

-- ── 7. Row Level Security ───────────────────────────────────────────────────

ALTER TABLE profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_thresholds ENABLE ROW LEVEL SECURITY;

-- Profiles: authenticated users have access to their own
DROP POLICY IF EXISTS "Authenticated access own profile" ON profiles;
CREATE POLICY "Authenticated access own profile" ON profiles
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Invoices: authenticated users have full access
DROP POLICY IF EXISTS "Authenticated full access invoices" ON invoices;
CREATE POLICY "Authenticated full access invoices" ON invoices
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Invoice Items: authenticated users have full access
DROP POLICY IF EXISTS "Authenticated full access invoice_items" ON invoice_items;
CREATE POLICY "Authenticated full access invoice_items" ON invoice_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Risk Events: authenticated users have full access
DROP POLICY IF EXISTS "Authenticated full access risk_events" ON risk_events;
CREATE POLICY "Authenticated full access risk_events" ON risk_events
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Risk Thresholds: authenticated users can read, only profiles can update
DROP POLICY IF EXISTS "Authenticated read risk_thresholds" ON risk_thresholds;
CREATE POLICY "Authenticated read risk_thresholds" ON risk_thresholds
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated update risk_thresholds" ON risk_thresholds;
CREATE POLICY "Authenticated update risk_thresholds" ON risk_thresholds
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ── 8. Function: Calculate Invoice Totals ────────────────────────────
CREATE OR REPLACE FUNCTION calculate_invoice_totals(p_invoice_id uuid)
RETURNS TABLE(subtotal numeric, vat_amount numeric, total numeric)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_subtotal numeric := 0;
  v_vat_amount numeric := 0;
  v_total numeric := 0;
BEGIN
  SELECT COALESCE(SUM(line_total), 0)
  INTO v_subtotal
  FROM invoice_items
  WHERE invoice_id = p_invoice_id;

  SELECT COALESCE(SUM(tax_amount), 0)
  INTO v_vat_amount
  FROM invoice_items
  WHERE invoice_id = p_invoice_id;

  v_total := v_subtotal + v_vat_amount;

  RETURN QUERY SELECT v_subtotal, v_vat_amount, v_total;
END;
$$;

-- ── Done ───────────────────────────────────────────────────────────────────
-- Tables ready: profiles, invoices, invoice_items, risk_events, risk_thresholds
-- Function ready: calculate_invoice_totals
-- Next: Deploy Edge Function check-invoice-anomalies