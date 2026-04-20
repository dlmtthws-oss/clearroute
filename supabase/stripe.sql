-- Stripe Payment Integration Data Model

-- Add Stripe fields to invoices table
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS stripe_payment_link_id TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS stripe_payment_link_url TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS card_payment_status TEXT DEFAULT 'none' 
  CHECK (card_payment_status IN ('none', 'pending', 'succeeded', 'failed'));

-- Create stripe_payments table
CREATE TABLE IF NOT EXISTS stripe_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  stripe_payment_intent_id TEXT UNIQUE,
  stripe_payment_link_id TEXT,
  amount NUMERIC(10,2) NOT NULL,
  currency TEXT DEFAULT 'gbp',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded', 'cancelled')),
  payment_method_type TEXT,
  customer_email TEXT,
  customer_name TEXT,
  paid_at TIMESTAMPTZ,
  failure_reason TEXT,
  refunded_at TIMESTAMPTZ,
  refund_amount NUMERIC(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_stripe_payments_invoice ON stripe_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_stripe_payments_intent ON stripe_payments(stripe_payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_stripe_payments_status ON stripe_payments(status);

-- RLS Policies
ALTER TABLE stripe_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view stripe payments" ON stripe_payments
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM invoices 
    JOIN profiles ON invoices.profiles_id = profiles.id 
    WHERE invoices.id = stripe_payments.invoice_id 
    AND profiles.user_id = auth.uid()
  )
);

-- Audit logging for Stripe payments
CREATE OR REPLACE FUNCTION create_stripe_payment_record(
  p_invoice_id UUID,
  p_intent_id TEXT,
  p_amount NUMERIC,
  p_status TEXT,
  p_customer_email TEXT DEFAULT NULL,
  p_customer_name TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_payment_id UUID;
BEGIN
  INSERT INTO stripe_payments (
    invoice_id,
    stripe_payment_intent_id,
    amount,
    status,
    customer_email,
    customer_name
  ) VALUES (
    p_invoice_id,
    p_intent_id,
    p_amount,
    p_status,
    p_customer_email,
    p_customer_name
  )
  RETURNING id INTO v_payment_id;
  
  RETURN v_payment_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update payment status on success
CREATE OR REPLACE FUNCTION mark_stripe_payment_succeeded(
  p_intent_id TEXT
) RETURNS VOID AS $$
BEGIN
  UPDATE stripe_payments
  SET status = 'succeeded', paid_at = NOW()
  WHERE stripe_payment_intent_id = p_intent_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update payment status on failure
CREATE OR REPLACE FUNCTION mark_stripe_payment_failed(
  p_intent_id TEXT,
  p_failure_reason TEXT
) RETURNS VOID AS $$
BEGIN
  UPDATE stripe_payments
  SET status = 'failed', failure_reason = p_failure_reason
  WHERE stripe_payment_intent_id = p_intent_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute
GRANT EXECUTE ON FUNCTION create_stripe_payment_record TO postgres;
GRANT EXECUTE ON FUNCTION mark_stripe_payment_succeeded TO postgres;
GRANT EXECUTE ON FUNCTION mark_stripe_payment_failed TO postgres;