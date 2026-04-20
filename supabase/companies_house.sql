-- Companies House and VAT Validation Data Model

-- Add business fields to customers table
ALTER TABLE customers ADD COLUMN IF NOT EXISTS company_number TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_business BOOLEAN DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS vat_number TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS vat_validated BOOLEAN DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS vat_validated_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS registered_address_line_1 TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS registered_address_line_2 TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS registered_city TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS registered_postcode TEXT;

-- Create index for company number search
CREATE INDEX IF NOT EXISTS idx_customers_company_number ON customers(company_number);

-- Create index for VAT number search
CREATE INDEX IF NOT EXISTS idx_customers_vat_number ON customers(vat_number);

-- VAT validation cache table
CREATE TABLE IF NOT EXISTS vat_validation_cache (
  vat_number TEXT PRIMARY KEY,
  is_valid BOOLEAN,
  company_name TEXT,
  address TEXT,
  validated_at TIMESTAMPTZ DEFAULT NOW()
);

-- TTL for VAT cache (24 hours)
CREATE OR REPLACE FUNCTION clean_vat_cache()
RETURNS void AS $$
BEGIN
  DELETE FROM vat_validation_cache 
  WHERE validated_at < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute
GRANT EXECUTE ON FUNCTION clean_vat_cache() TO postgres;

-- Add customer lookup audit log
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id);