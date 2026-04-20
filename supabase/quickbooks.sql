-- QuickBooks Online Integration Data Model

-- QuickBooks Connections Table
CREATE TABLE IF NOT EXISTS quickbooks_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  realm_id TEXT NOT NULL,
  company_name TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN DEFAULT true,
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_qbo_connections_user ON quickbooks_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_qbo_connections_active ON quickbooks_connections(is_active);

-- RLS Policies
ALTER TABLE quickbooks_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own quickbooks connections" ON quickbooks_connections
FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can insert own quickbooks connections" ON quickbooks_connections
FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own quickbooks connections" ON quickbooks_connections
FOR UPDATE USING (user_id = auth.uid());

-- Only admins can delete
CREATE POLICY "Admins can delete quickbooks connections" ON quickbooks_connections
FOR DELETE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- QuickBooks Sync Settings (user preferences)
CREATE TABLE IF NOT EXISTS quickbooks_sync_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  auto_sync_invoices BOOLEAN DEFAULT true,
  auto_sync_expenses BOOLEAN DEFAULT true,
  auto_sync_payments BOOLEAN DEFAULT true,
  income_account_id TEXT,
  income_account_name TEXT,
  bank_account_id TEXT,
  bank_account_name TEXT,
  expense_account_mappings JSONB DEFAULT '{
    "fuel": {"id": "", "name": "Vehicle"},
    "equipment": {"id": "", "name": "Equipment"},
    "supplies": {"id": "", "name": "Supplies & Materials"},
    "insurance": {"id": "", "name": "Insurance"},
    "other": {"id": "", "name": "Other Business Expenses"}
  }'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS Policies
ALTER TABLE quickbooks_sync_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own quickbooks settings" ON quickbooks_sync_settings
FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can insert own quickbooks settings" ON quickbooks_sync_settings
FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own quickbooks settings" ON quickbooks_sync_settings
FOR UPDATE USING (user_id = auth.uid());

-- QuickBooks Sync Log Table
CREATE TABLE IF NOT EXISTS quickbooks_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('invoice', 'customer', 'expense', 'payment')),
  entity_id UUID NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('to_qbo', 'from_qbo')),
  status TEXT NOT NULL CHECK (status IN ('success', 'error')),
  qbo_id TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_qbo_sync_log_user ON quickbooks_sync_log(user_id);
CREATE INDEX IF NOT EXISTS idx_qbo_sync_log_entity ON quickbooks_sync_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_qbo_sync_log_status ON quickbooks_sync_log(status);
CREATE INDEX IF NOT EXISTS idx_qbo_sync_log_created ON quickbooks_sync_log(created_at);

-- RLS Policies
ALTER TABLE quickbooks_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own quickbooks sync log" ON quickbooks_sync_log
FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "System can insert quickbooks sync log" ON quickbooks_sync_log
FOR INSERT WITH CHECK (true);

-- Add QuickBooks fields to invoices table
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS qbo_invoice_id TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS qbo_synced_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS qbo_sync_status TEXT DEFAULT 'not_synced' 
  CHECK (qbo_sync_status IN ('not_synced', 'synced', 'error'));

-- Add unique index on qbo_invoice_id for quick lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_qbo_id ON invoices(qbo_invoice_id) 
  WHERE qbo_invoice_id IS NOT NULL;

-- Add QuickBooks fields to customers table
ALTER TABLE customers ADD COLUMN IF NOT EXISTS qbo_customer_id TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS qbo_synced_at TIMESTAMPTZ;

-- Add unique index on qbo_customer_id for quick lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_qbo_id ON customers(qbo_customer_id) 
  WHERE qbo_customer_id IS NOT NULL;

-- Add QuickBooks fields to expenses table
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS qbo_bill_id TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS qbo_synced_at TIMESTAMPTZ;

-- Add unique index on qbo_bill_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_qbo_id ON expenses(qbo_bill_id) 
  WHERE qbo_bill_id IS NOT NULL;

-- Add QuickBooks fields to payments table
ALTER TABLE payments ADD COLUMN IF NOT EXISTS qbo_payment_id TEXT;

-- Grant permissions
GRANT SELECT ON quickbooks_connections TO postgres;
GRANT SELECT ON quickbooks_sync_settings TO postgres;
GRANT SELECT, INSERT, UPDATE ON quickbooks_sync_log TO postgres;

-- Function to sync customer to QuickBooks
CREATE OR REPLACE FUNCTION sync_customer_to_qbo(
  p_customer_id UUID,
  p_user_id UUID
) RETURNS TEXT AS $$
DECLARE
  v_customer RECORD;
  v_qbo_customer_id TEXT;
BEGIN
  SELECT * INTO v_customer
  FROM customers
  WHERE id = p_customer_id AND profiles_id = p_user_id;

  IF NOT FOUND THEN
    RETURN '{"error": "Customer not found"}';
  END IF;

  IF v_customer.qbo_customer_id IS NOT NULL THEN
    v_qbo_customer_id := v_customer.qbo_customer_id;
  END IF;

  RETURN jsonb_build_object(
    'qbo_customer_id', v_qbo_customer_id,
    'customer_id', p_customer_id
  )::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to sync invoice to QuickBooks
CREATE OR REPLACE FUNCTION sync_invoice_to_qbo(
  p_invoice_id UUID,
  p_user_id UUID
) RETURNS TEXT AS $$
DECLARE
  v_invoice RECORD;
  v_customer RECORD;
  v_qbo_invoice_id TEXT;
BEGIN
  SELECT i.*, c.qbo_customer_id AS customer_qbo_customer_id
  INTO v_invoice
  FROM invoices i
  LEFT JOIN customers c ON i.customers_id = c.id
  WHERE i.id = p_invoice_id AND i.profiles_id = p_user_id;

  IF NOT FOUND THEN
    RETURN '{"error": "Invoice not found"}';
  END IF;

  IF v_invoice.status NOT IN ('sent', 'paid') THEN
    RETURN '{"error": "Only sent or paid invoices can be synced to QuickBooks"}';
  END IF;

  IF v_invoice.qbo_invoice_id IS NOT NULL THEN
    v_qbo_invoice_id := v_invoice.qbo_invoice_id;
  END IF;

  RETURN jsonb_build_object(
    'qbo_invoice_id', v_qbo_invoice_id,
    'invoice_id', p_invoice_id,
    'status', v_invoice.status
  )::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to sync expense to QuickBooks
CREATE OR REPLACE FUNCTION sync_expense_to_qbo(
  p_expense_id UUID,
  p_user_id UUID
) RETURNS TEXT AS $$
DECLARE
  v_expense RECORD;
  v_qbo_bill_id TEXT;
BEGIN
  SELECT * INTO v_expense
  FROM expenses
  WHERE id = p_expense_id AND profiles_id = p_user_id;

  IF NOT FOUND THEN
    RETURN '{"error": "Expense not found"}';
  END IF;

  IF v_expense.qbo_bill_id IS NOT NULL THEN
    v_qbo_bill_id := v_expense.qbo_bill_id;
  END IF;

  RETURN jsonb_build_object(
    'qbo_bill_id', v_qbo_bill_id,
    'expense_id', p_expense_id
  )::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION sync_customer_to_qbo TO postgres;
GRANT EXECUTE ON FUNCTION sync_invoice_to_qbo TO postgres;
GRANT EXECUTE ON FUNCTION sync_expense_to_qbo TO postgres;