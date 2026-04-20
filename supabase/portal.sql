-- Add portal columns to customers if not exist
ALTER TABLE customers ADD COLUMN IF NOT EXISTS portal_token TEXT UNIQUE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS portal_enabled BOOLEAN DEFAULT true;

-- Generate portal token for existing customers that don't have one
UPDATE customers
SET portal_token = gen_random_uuid()
WHERE portal_token IS NULL OR portal_token = '';

-- Make portal_token not null for future inserts
ALTER TABLE customers ALTER COLUMN portal_token SET NOT NULL;

-- Index for portal lookup
CREATE INDEX IF NOT EXISTS customers_portal_token_idx ON customers(portal_token) WHERE portal_enabled = true;

-- Function to generate portal token
CREATE OR REPLACE FUNCTION generate_portal_token()
RETURNS TEXT AS $$
BEGIN
  RETURN gen_random_uuid()::TEXT;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to regenerate portal token
CREATE OR REPLACE FUNCTION regenerate_customer_portal_token(p_customer_id UUID)
RETURNS TEXT AS $$
DECLARE
  new_token TEXT;
BEGIN
  new_token := gen_random_uuid()::TEXT;
  
  UPDATE customers
  SET portal_token = new_token
  WHERE id = p_customer_id;
  
  RETURN new_token;
END;
$$ LANGUAGE plpgsql;