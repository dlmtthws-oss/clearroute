-- Xero Accounting Integration Data Model

-- Xero Connections Table
CREATE TABLE IF NOT EXISTS xero_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  tenant_name TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN DEFAULT true,
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_xero_connections_user ON xero_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_xero_connections_active ON xero_connections(is_active);

-- RLS Policies
ALTER TABLE xero_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own xero connections" ON xero_connections
FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can insert own xero connections" ON xero_connections
FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own xero connections" ON xero_connections
FOR UPDATE USING (user_id = auth.uid());

-- Only admins can delete
CREATE POLICY "Admins can delete xero connections" ON xero_connections
FOR DELETE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Xero Sync Settings (user preferences)
CREATE TABLE IF NOT EXISTS xero_sync_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  auto_sync_invoices BOOLEAN DEFAULT true,
  auto_sync_expenses BOOLEAN DEFAULT true,
  auto_sync_payments BOOLEAN DEFAULT true,
  account_code_mappings JSONB DEFAULT '{
    "fuel": "449",
    "equipment": "720",
    "supplies": "400",
    "insurance": "478",
    "other": "404"
  }'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS Policies
ALTER TABLE xero_sync_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own xero settings" ON xero_sync_settings
FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can insert own xero settings" ON xero_sync_settings
FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own xero settings" ON xero_sync_settings
FOR UPDATE USING (user_id = auth.uid());

-- Xero Sync Log Table
CREATE TABLE IF NOT EXISTS xero_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('invoice', 'customer', 'expense', 'payment')),
  entity_id UUID NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('to_xero', 'from_xero')),
  status TEXT NOT NULL CHECK (status IN ('success', 'error')),
  xero_id TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_xero_sync_log_user ON xero_sync_log(user_id);
CREATE INDEX IF NOT EXISTS idx_xero_sync_log_entity ON xero_sync_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_xero_sync_log_status ON xero_sync_log(status);
CREATE INDEX IF NOT EXISTS idx_xero_sync_log_created ON xero_sync_log(created_at);

-- RLS Policies
ALTER TABLE xero_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own xero sync log" ON xero_sync_log
FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "System can insert xero sync log" ON xero_sync_log
FOR INSERT WITH CHECK (true);

-- Add Xero fields to invoices table
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS xero_invoice_id TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS xero_synced_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS xero_sync_status TEXT DEFAULT 'not_synced' 
  CHECK (xero_sync_status IN ('not_synced', 'synced', 'error'));

-- Add unique index on xero_invoice_id for quick lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_xero_id ON invoices(xero_invoice_id) 
  WHERE xero_invoice_id IS NOT NULL;

-- Add Xero fields to customers table
ALTER TABLE customers ADD COLUMN IF NOT EXISTS xero_contact_id TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS xero_synced_at TIMESTAMPTZ;

-- Add unique index on xero_contact_id for quick lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_xero_id ON customers(xero_contact_id) 
  WHERE xero_contact_id IS NOT NULL;

-- Add Xero fields to expenses table
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS xero_bill_id TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS xero_synced_at TIMESTAMPTZ;

-- Add unique index on xero_bill_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_xero_id ON expenses(xero_bill_id) 
  WHERE xero_bill_id IS NOT NULL;

-- Add Xero fields to payments table
ALTER TABLE payments ADD COLUMN IF NOT EXISTS xero_payment_id TEXT;

-- Grant permissions
GRANT SELECT ON xero_connections TO postgres;
GRANT SELECT ON xero_sync_settings TO postgres;
GRANT SELECT, INSERT, UPDATE ON xero_sync_log TO postgres;

-- Function to sync customer to Xero
CREATE OR REPLACE FUNCTION sync_customer_to_xero(
  p_customer_id UUID,
  p_user_id UUID
) RETURNS TEXT AS $$
DECLARE
  v_customer RECORD;
  v_xero_contact_id TEXT;
  v_result TEXT;
BEGIN
  -- Get customer data
  SELECT * INTO v_customer
  FROM customers
  WHERE id = p_customer_id AND profiles_id = p_user_id;

  IF NOT FOUND THEN
    RETURN '{"error": "Customer not found"}';
  END IF;

  -- Check if contact already exists in Xero
  IF v_customer.xero_contact_id IS NOT NULL THEN
    v_xero_contact_id := v_customer.xero_contact_id;
  END IF;

  RETURN jsonb_build_object(
    'xero_contact_id', v_xero_contact_id,
    'customer_id', p_customer_id
  )::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to sync invoice to Xero
CREATE OR REPLACE FUNCTION sync_invoice_to_xero(
  p_invoice_id UUID,
  p_user_id UUID
) RETURNS TEXT AS $$
DECLARE
  v_invoice RECORD;
  v_customer RECORD;
  v_xero_invoice_id TEXT;
  v_result TEXT;
BEGIN
  -- Get invoice data
  SELECT i.*, c.xero_contact_id AS customer_xero_contact_id
  INTO v_invoice
  FROM invoices i
  LEFT JOIN customers c ON i.customers_id = c.id
  WHERE i.id = p_invoice_id AND i.profiles_id = p_user_id;

  IF NOT FOUND THEN
    RETURN '{"error": "Invoice not found"}';
  END IF;

  -- Only sync sent or paid invoices
  IF v_invoice.status NOT IN ('sent', 'paid') THEN
    RETURN '{"error": "Only sent or paid invoices can be synced to Xero"}';
  END IF;

  -- Check if invoice already exists in Xero
  IF v_invoice.xero_invoice_id IS NOT NULL THEN
    v_xero_invoice_id := v_invoice.xero_invoice_id;
  END IF;

  RETURN jsonb_build_object(
    'xero_invoice_id', v_xero_invoice_id,
    'invoice_id', p_invoice_id,
    'status', v_invoice.status
  )::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to sync expense to Xero
CREATE OR REPLACE FUNCTION sync_expense_to_xero(
  p_expense_id UUID,
  p_user_id UUID
) RETURNS TEXT AS $$
DECLARE
  v_expense RECORD;
  v_xero_bill_id TEXT;
BEGIN
  -- Get expense data
  SELECT * INTO v_expense
  FROM expenses
  WHERE id = p_expense_id AND profiles_id = p_user_id;

  IF NOT FOUND THEN
    RETURN '{"error": "Expense not found"}';
  END IF;

  -- Check if bill already exists in Xero
  IF v_expense.xero_bill_id IS NOT NULL THEN
    v_xero_bill_id := v_expense.xero_bill_id;
  END IF;

  RETURN jsonb_build_object(
    'xero_bill_id', v_xero_bill_id,
    'expense_id', p_expense_id
  )::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION sync_customer_to_xero TO postgres;
GRANT EXECUTE ON FUNCTION sync_invoice_to_xero TO postgres;
GRANT EXECUTE ON FUNCTION sync_expense_to_xero TO postgres;