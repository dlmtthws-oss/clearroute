-- TrueLayer Bank Feed Data Model

-- Bank Connections Table
CREATE TABLE IF NOT EXISTS bank_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  bank_name TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_number_last4 TEXT,
  sort_code TEXT,
  currency TEXT DEFAULT 'GBP',
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  last_synced_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  truelayer_connection_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bank Transactions Table
CREATE TABLE IF NOT EXISTS bank_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID REFERENCES bank_connections(id) ON DELETE CASCADE,
  truelayer_transaction_id TEXT UNIQUE,
  date DATE NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  currency TEXT DEFAULT 'GBP',
  transaction_type TEXT CHECK (transaction_type IN ('credit', 'debit')),
  merchant_name TEXT,
  category TEXT,
  reconciliation_status TEXT DEFAULT 'unmatched' CHECK (reconciliation_status IN ('unmatched', 'matched', 'ignored', 'needs_review')),
  matched_invoice_id UUID REFERENCES invoices(id),
  matched_expense_id UUID REFERENCES expenses(id),
  matched_at TIMESTAMPTZ,
  matched_by UUID REFERENCES profiles(id),
  ignore_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_bank_transactions_connection ON bank_transactions(connection_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_status ON bank_transactions(reconciliation_status);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_date ON bank_transactions(date);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_matched_invoice ON bank_transactions(matched_invoice_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_matched_expense ON bank_transactions(matched_expense_id);

-- RLS Policies for bank_connections
ALTER TABLE bank_connections ENABLE ROW LEVEL SECURITY;

-- Users can view their own connections
CREATE POLICY "Users can view own bank connections" ON bank_connections
FOR SELECT USING (user_id = auth.uid());

-- Users can insert their own connections
CREATE POLICY "Users can create bank connections" ON bank_connections
FOR INSERT WITH CHECK (user_id = auth.uid());

-- Users can update their own connections
CREATE POLICY "Users can update own bank connections" ON bank_connections
FOR UPDATE USING (user_id = auth.uid());

-- Only admins can delete
CREATE POLICY "Admins can delete bank connections" ON bank_connections
FOR DELETE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- RLS Policies for bank_transactions
ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;

-- Users can view transactions from their connections
CREATE POLICY "Users can view own bank transactions" ON bank_transactions
FOR SELECT USING (
  connection_id IN (SELECT id FROM bank_connections WHERE user_id = auth.uid())
);

-- System can insert transactions
CREATE POLICY "System can insert bank transactions" ON bank_transactions
FOR INSERT WITH CHECK (true);

-- Users can update transactions they can see
CREATE POLICY "Users can update own bank transactions" ON bank_transactions
FOR UPDATE USING (
  connection_id IN (SELECT id FROM bank_connections WHERE user_id = auth.uid())
);

-- Admin audit log for bank actions
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS bank_transaction_id UUID REFERENCES bank_transactions(id);

-- Function to match bank transaction to invoice
CREATE OR REPLACE FUNCTION match_bank_transaction_to_invoice(
  p_transaction_id UUID,
  p_invoice_id UUID,
  p_user_id UUID
) RETURNS VOID AS $$
BEGIN
  UPDATE bank_transactions
  SET 
    reconciliation_status = 'matched',
    matched_invoice_id = p_invoice_id,
    matched_at = NOW(),
    matched_by = p_user_id
  WHERE id = p_transaction_id;
  
  INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_values, new_values)
  SELECT 
    p_user_id,
    'bank_transaction.matched_to_invoice',
    'bank_transaction',
    p_transaction_id,
    NULL,
    json_build_object('invoice_id', p_invoice_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to match bank transaction to expense
CREATE OR REPLACE FUNCTION match_bank_transaction_to_expense(
  p_transaction_id UUID,
  p_expense_id UUID,
  p_user_id UUID
) RETURNS VOID AS $$
BEGIN
  UPDATE bank_transactions
  SET 
    reconciliation_status = 'matched',
    matched_expense_id = p_expense_id,
    matched_at = NOW(),
    matched_by = p_user_id
  WHERE id = p_transaction_id;
  
  INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_values, new_values)
  SELECT 
    p_user_id,
    'bank_transaction.matched_to_expense',
    'bank_transaction',
    p_transaction_id,
    NULL,
    json_build_object('expense_id', p_expense_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to ignore bank transaction
CREATE OR REPLACE FUNCTION ignore_bank_transaction(
  p_transaction_id UUID,
  p_ignore_reason TEXT,
  p_user_id UUID
) RETURNS VOID AS $$
BEGIN
  UPDATE bank_transactions
  SET 
    reconciliation_status = 'ignored',
    ignore_reason = p_ignore_reason,
    matched_at = NOW(),
    matched_by = p_user_id
  WHERE id = p_transaction_id;
  
  INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_values, new_values)
  SELECT 
    p_user_id,
    'bank_transaction.ignored',
    'bank_transaction',
    p_transaction_id,
    NULL,
    json_build_object('ignore_reason', p_ignore_reason);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to unmatch bank transaction
CREATE OR REPLACE FUNCTION unmatch_bank_transaction(
  p_transaction_id UUID,
  p_user_id UUID
) RETURNS VOID AS $$
DECLARE
  v_old_data JSONB;
BEGIN
  SELECT to_jsonb(*) INTO v_old_data
  FROM bank_transactions
  WHERE id = p_transaction_id;
  
  UPDATE bank_transactions
  SET 
    reconciliation_status = 'unmatched',
    matched_invoice_id = NULL,
    matched_expense_id = NULL,
    matched_at = NULL,
    matched_by = NULL,
    ignore_reason = NULL
  WHERE id = p_transaction_id;
  
  INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_values, new_values)
  SELECT 
    p_user_id,
    'bank_transaction.unmatched',
    'bank_transaction',
    p_transaction_id,
    v_old_data,
    NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
