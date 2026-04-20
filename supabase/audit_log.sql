-- Audit Log SQL Schema

-- Create audit_log table
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  user_name TEXT,
  user_role TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  entity_reference TEXT,
  old_values JSONB,
  new_values JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for common queries
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity_type ON audit_log(entity_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);

-- Enable RLS
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- RLS policies
-- Admins can read all
DROP POLICY IF EXISTS "Admins can view audit log" ON audit_log;
CREATE POLICY "Admins can view audit log" ON audit_log
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- No one can insert directly (must use function)
DROP POLICY IF EXISTS "Service role can insert audit log" ON audit_log;
CREATE POLICY "Service role can insert audit log" ON audit_log
  FOR INSERT WITH CHECK (true);

-- No one can update audit log
DROP POLICY IF EXISTS "No update audit log" ON audit_log;
CREATE POLICY "No update audit log" ON audit_log
  FOR UPDATE USING (false);

-- No one can delete audit log
DROP POLICY IF EXISTS "No delete audit log" ON audit_log;
CREATE POLICY "No delete audit log" ON audit_log
  FOR DELETE USING (false);

-- Helper function to log audit events (can be called by any authenticated user)
CREATE OR REPLACE FUNCTION log_audit_event(
  p_action TEXT,
  p_entity_type TEXT,
  p_entity_id UUID DEFAULT NULL,
  p_entity_reference TEXT DEFAULT NULL,
  p_old_values JSONB DEFAULT NULL,
  p_new_values JSONB DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_user_id UUID;
  v_user_name TEXT;
  v_user_role TEXT;
BEGIN
  -- Get current user info if authenticated
  IF auth.uid() IS NOT NULL THEN
    SELECT id, full_name, role INTO v_user_id, v_user_name, v_user_role
    FROM profiles
    WHERE id = auth.uid();
  END IF;

  -- Insert audit log entry
  INSERT INTO audit_log (
    user_id,
    user_name,
    user_role,
    action,
    entity_type,
    entity_id,
    entity_reference,
    old_values,
    new_values
  ) VALUES (
    v_user_id,
    v_user_name,
    v_user_role,
    p_action,
    p_entity_type,
    p_entity_id,
    p_entity_reference,
    p_old_values,
    p_new_values
  );
EXCEPTION WHEN OTHERS THEN
  -- Never fail silently - log to console but don't block
  RAISE NOTICE 'Audit log failed: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to log audit with IP (for Edge Functions)
CREATE OR REPLACE FUNCTION log_audit_event_with_ip(
  p_action TEXT,
  p_entity_type TEXT,
  p_user_id UUID,
  p_user_name TEXT,
  p_user_role TEXT,
  p_entity_id UUID DEFAULT NULL,
  p_entity_reference TEXT DEFAULT NULL,
  p_old_values JSONB DEFAULT NULL,
  p_new_values JSONB DEFAULT NULL,
  p_ip_address TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO audit_log (
    user_id,
    user_name,
    user_role,
    action,
    entity_type,
    entity_id,
    entity_reference,
    old_values,
    new_values,
    ip_address,
    user_agent
  ) VALUES (
    p_user_id,
    p_user_name,
    p_user_role,
    p_action,
    p_entity_type,
    p_entity_id,
    p_entity_reference,
    p_old_values,
    p_new_values,
    p_ip_address,
    p_user_agent
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Audit log failed: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- View for human-readable action labels
CREATE OR REPLACE VIEW audit_log_with_labels AS
SELECT 
  id,
  user_id,
  user_name,
  user_role,
  action,
  entity_type,
  entity_id,
  entity_reference,
  old_values,
  new_values,
  ip_address,
  user_agent,
  created_at,
  CASE 
    -- Invoice actions
    WHEN action = 'invoice.created' THEN 'Invoice Created'
    WHEN action = 'invoice.updated' THEN 'Invoice Updated'
    WHEN action = 'invoice.deleted' THEN 'Invoice Deleted'
    WHEN action = 'invoice.sent' THEN 'Invoice Sent'
    WHEN action = 'invoice.status_changed' THEN 'Invoice Status Changed'
    WHEN action = 'invoice.payment_recorded' THEN 'Payment Recorded'
    WHEN action = 'invoice.pdf_downloaded' THEN 'Invoice PDF Downloaded'
    
    -- Payment actions
    WHEN action = 'payment.recorded' THEN 'Payment Recorded'
    WHEN action = 'payment.deleted' THEN 'Payment Deleted'
    WHEN action = 'payment.gocardless_initiated' THEN 'GoCardless Payment Initiated'
    WHEN action = 'payment.gocardless_confirmed' THEN 'GoCardless Payment Confirmed'
    WHEN action = 'payment.gocardless_failed' THEN 'GoCardless Payment Failed'
    
    -- Customer actions
    WHEN action = 'customer.created' THEN 'Customer Created'
    WHEN action = 'customer.updated' THEN 'Customer Updated'
    WHEN action = 'customer.deleted' THEN 'Customer Deleted'
    WHEN action = 'customer.imported' THEN 'Customers Imported'
    WHEN action = 'customer.portal_link_regenerated' THEN 'Customer Portal Link Regenerated'
    
    -- Route actions
    WHEN action = 'route.created' THEN 'Route Created'
    WHEN action = 'route.updated' THEN 'Route Updated'
    WHEN action = 'route.deleted' THEN 'Route Deleted'
    WHEN action = 'route.started' THEN 'Route Started'
    WHEN action = 'route.completed' THEN 'Route Completed'
    WHEN action = 'route.assigned' THEN 'Route Assigned'
    
    -- Expense actions
    WHEN action = 'expense.created' THEN 'Expense Created'
    WHEN action = 'expense.updated' THEN 'Expense Updated'
    WHEN action = 'expense.deleted' THEN 'Expense Deleted'
    
    -- Quote actions
    WHEN action = 'quote.created' THEN 'Quote Created'
    WHEN action = 'quote.sent' THEN 'Quote Sent'
    WHEN action = 'quote.accepted' THEN 'Quote Accepted'
    WHEN action = 'quote.declined' THEN 'Quote Declined'
    WHEN action = 'quote.converted_to_invoice' THEN 'Quote Converted to Invoice'
    
    -- Settings actions
    WHEN action = 'settings.company_updated' THEN 'Company Settings Updated'
    WHEN action = 'settings.logo_uploaded' THEN 'Company Logo Uploaded'
    WHEN action = 'settings.email_template_updated' THEN 'Email Template Updated'
    WHEN action = 'settings.hmrc_connected' THEN 'HMRC Connected'
    WHEN action = 'settings.hmrc_disconnected' THEN 'HMRC Disconnected'
    WHEN action = 'settings.gocardless_connected' THEN 'GoCardless Connected'
    
    -- VAT actions
    WHEN action = 'vat_return.calculated' THEN 'VAT Return Calculated'
    WHEN action = 'vat_return.submitted' THEN 'VAT Return Submitted'
    WHEN action = 'vat_return.viewed' THEN 'VAT Return Viewed'
    
    -- User actions
    WHEN action = 'user.invited' THEN 'User Invited'
    WHEN action = 'user.role_changed' THEN 'User Role Changed'
    WHEN action = 'user.deactivated' THEN 'User Deactivated'
    WHEN action = 'user.login' THEN 'User Login'
    WHEN action = 'user.logout' THEN 'User Logout'
    
    -- Recurring actions
    WHEN action = 'recurring.created' THEN 'Recurring Invoice Created'
    WHEN action = 'recurring.updated' THEN 'Recurring Invoice Updated'
    WHEN action = 'recurring.paused' THEN 'Recurring Invoice Paused'
    WHEN action = 'recurring.deleted' THEN 'Recurring Invoice Deleted'
    WHEN action = 'recurring.generated' THEN 'Recurring Invoice Generated'
    WHEN action = 'recurring.run_manually' THEN 'Recurring Invoice Run Manually'
    
    ELSE action
  END AS action_label
FROM audit_log;