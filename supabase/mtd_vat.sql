-- MTD VAT Integration SQL Schema

-- HMRC Connections table
CREATE TABLE IF NOT EXISTS hmrc_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT,
  vrn TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expires_at TIMESTAMP WITH TIME ZONE,
  connected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- VAT Returns table
CREATE TABLE IF NOT EXISTS vat_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT,
  period_key TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  due_date DATE,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'draft', 'submitted', 'finalised')),
  box_1 NUMERIC(10,2) DEFAULT 0,
  box_2 NUMERIC(10,2) DEFAULT 0,
  box_3 NUMERIC(10,2) DEFAULT 0,
  box_4 NUMERIC(10,2) DEFAULT 0,
  box_5 NUMERIC(10,2) DEFAULT 0,
  box_6 NUMERIC(10,2) DEFAULT 0,
  box_7 NUMERIC(10,2) DEFAULT 0,
  box_8 NUMERIC(10,2) DEFAULT 0,
  box_9 NUMERIC(10,2) DEFAULT 0,
  submitted_at TIMESTAMP WITH TIME ZONE,
  submission_reference TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add VAT settings to company_settings if not exists
ALTER TABLE company_settings 
ADD COLUMN IF NOT EXISTS vat_registration_number TEXT,
ADD COLUMN IF NOT EXISTS vat_accounting_scheme TEXT DEFAULT 'cash' CHECK (vat_accounting_scheme IN ('cash', 'standard')),
ADD COLUMN IF NOT EXISTS vat_period TEXT DEFAULT 'quarterly' CHECK (vat_period IN ('monthly', 'quarterly'));

-- Enable RLS
ALTER TABLE hmrc_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE vat_returns ENABLE ROW LEVEL SECURITY;

-- RLS policies for hmrc_connections
DROP POLICY IF EXISTS "Admins can view hmrc connections" ON hmrc_connections;
DROP POLICY IF EXISTS "Admins can manage hmrc connections" ON hmrc_connections;

CREATE POLICY "Admins can view hmrc connections" ON hmrc_connections
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can manage hmrc connections" ON hmrc_connections
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- RLS policies for vat_returns
DROP POLICY IF EXISTS "Admins can view vat returns" ON vat_returns;
DROP POLICY IF EXISTS "Admins can manage vat returns" ON vat_returns;
DROP POLICY IF EXISTS "Managers can view vat returns" ON vat_returns;

CREATE POLICY "Admins can view vat returns" ON vat_returns
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'manager'))
  );

CREATE POLICY "Admins can manage vat returns" ON vat_returns
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Helper function to get VAT connection
CREATE OR REPLACE FUNCTION get_hmrc_connection()
RETURNS SETOF hmrc_connections AS $$
  SELECT * FROM hmrc_connections WHERE is_active = true LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER;

-- Helper function to calculate VAT box values for a period
CREATE OR REPLACE FUNCTION calculate_vat_boxes(
  p_period_start DATE,
  p_period_end DATE,
  p_accounting_scheme TEXT DEFAULT 'cash'
)
RETURNS TABLE(
  box_1 NUMERIC,
  box_2 NUMERIC,
  box_3 NUMERIC,
  box_4 NUMERIC,
  box_5 NUMERIC,
  box_6 NUMERIC,
  box_7 NUMERIC
) AS $$
DECLARE
  v_box_1 NUMERIC := 0;
  v_box_2 NUMERIC := 0;
  v_box_4 NUMERIC := 0;
  v_box_6 NUMERIC := 0;
  v_box_7 NUMERIC := 0;
BEGIN
  -- Box 1: VAT due on sales (based on payment date for cash accounting)
  IF p_accounting_scheme = 'cash' THEN
    SELECT COALESCE(SUM(i.vat_amount), 0) INTO v_box_1
    FROM invoices i
    WHERE i.status = 'paid'
      AND i.paid_at >= p_period_start
      AND i.paid_at <= p_period_end;
    
    SELECT COALESCE(SUM(i.total_amount - i.vat_amount), 0) INTO v_box_6
    FROM invoices i
    WHERE i.status = 'paid'
      AND i.paid_at >= p_period_start
      AND i.paid_at <= p_period_end;
  ELSE
    -- Standard accounting: based on invoice date
    SELECT COALESCE(SUM(i.vat_amount), 0) INTO v_box_1
    FROM invoices i
    WHERE i.status IN ('sent', 'paid')
      AND i.issue_date >= p_period_start
      AND i.issue_date <= p_period_end;
    
    SELECT COALESCE(SUM(i.total_amount - i.vat_amount), 0) INTO v_box_6
    FROM invoices i
    WHERE i.status IN ('sent', 'paid')
      AND i.issue_date >= p_period_start
      AND i.issue_date <= p_period_end;
  END IF;

  -- Box 2: VAT on EC acquisitions (usually 0 for UK window cleaning)
  v_box_2 := 0;

  -- Box 3: Total VAT due
  v_box_3 := v_box_1 + v_box_2;

  -- Box 4: VAT reclaimed on expenses
  IF p_accounting_scheme = 'cash' THEN
    SELECT COALESCE(SUM(e.vat_amount), 0) INTO v_box_4
    FROM expenses e
    WHERE e.vat_reclaimable = true
      AND e.status = 'paid'
      AND e.paid_at >= p_period_start
      AND e.paid_at <= p_period_end;
    
    SELECT COALESCE(SUM(e.amount - COALESCE(e.vat_amount, 0)), 0) INTO v_box_7
    FROM expenses e
    WHERE e.status = 'paid'
      AND e.paid_at >= p_period_start
      AND e.paid_at <= p_period_end;
  ELSE
    -- Standard accounting: based on expense date
    SELECT COALESCE(SUM(e.vat_amount), 0) INTO v_box_4
    FROM expenses e
    WHERE e.vat_reclaimable = true
      AND e.status IN ('approved', 'paid')
      AND e.expense_date >= p_period_start
      AND e.expense_date <= p_period_end;
    
    SELECT COALESCE(SUM(e.amount - COALESCE(e.vat_amount, 0)), 0) INTO v_box_7
    FROM expenses e
    WHERE e.status IN ('approved', 'paid')
      AND e.expense_date >= p_period_start
      AND e.expense_date <= p_period_end;
  END IF;

  -- Box 5: Net VAT payable
  RETURN QUERY SELECT v_box_1, v_box_2, v_box_3, v_box_4, v_box_3 - v_box_4, v_box_6, v_box_7;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;