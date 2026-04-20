-- Quotes table
CREATE TABLE IF NOT EXISTS quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number TEXT UNIQUE NOT NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  prospect_name TEXT,
  prospect_email TEXT,
  prospect_address TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'expired', 'superseded')),
  issue_date DATE DEFAULT CURRENT_DATE,
  expiry_date DATE,
  subtotal NUMERIC(10,2) DEFAULT 0,
  vat_amount NUMERIC(10,2) DEFAULT 0,
  total NUMERIC(10,2) DEFAULT 0,
  notes TEXT,
  internal_notes TEXT,
  converted_to_invoice_id UUID REFERENCES invoices(id),
  created_by UUID REFERENCES workers(id),
  decline_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Quote line items
CREATE TABLE IF NOT EXISTS quote_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID REFERENCES quotes(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity NUMERIC(10,2) DEFAULT 1,
  unit_price NUMERIC(10,2) DEFAULT 0,
  vat_rate NUMERIC(5,2) DEFAULT 20.00,
  line_total NUMERIC(10,2)
);

-- Enable RLS
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_line_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "quotes_read" ON quotes FOR SELECT USING (true);
CREATE POLICY "quotes_insert" ON quotes FOR INSERT WITH CHECK (true);
CREATE POLICY "quotes_update" ON quotes FOR UPDATE USING (true);
CREATE POLICY "quotes_delete" ON quotes FOR DELETE USING (true);

CREATE POLICY "quote_items_read" ON quote_line_items FOR SELECT USING (true);
CREATE POLICY "quote_items_insert" ON quote_line_items FOR INSERT WITH CHECK (true);
CREATE POLICY "quote_items_update" ON quote_line_items FOR UPDATE USING (true);
CREATE POLICY "quote_items_delete" ON quote_line_items FOR DELETE USING (true);

-- Indexes
CREATE INDEX IF NOT EXISTS quotes_customer_idx ON quotes(customer_id);
CREATE INDEX IF NOT EXISTS quotes_status_idx ON quotes(status);
CREATE INDEX IF NOT EXISTS quotes_expiry_idx ON quotes(expiry_date);
CREATE INDEX IF NOT EXISTS quote_items_quote_idx ON quote_line_items(quote_id);

-- Function to generate quote number
CREATE OR REPLACE FUNCTION generate_quote_number()
RETURNS TEXT AS $$
DECLARE
  next_num INTEGER;
  year_num TEXT;
BEGIN
  SELECT COALESCE(MAX(
    NULLIF(SUBSTRING(quote_number FROM '.[0-9]+$'), '')::INT
  ), 0) + 1 INTO next_num
  FROM quotes
  WHERE EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM NOW());
  
  year_num := EXTRACT(YEAR FROM NOW())::TEXT;
  
  RETURN 'QUO-' || year_num || '-' || LPAD(next_num::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- Function to update quote totals
CREATE OR REPLACE FUNCTION update_quote_totals()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.quote_id IS NOT NULL THEN
    UPDATE quotes
    SET 
      subtotal = COALESCE((
        SELECT SUM(quantity * unit_price) 
        FROM quote_line_items 
        WHERE quote_id = COALESCE(NEW.quote_id, NEW.id)
      ), 0),
      vat_amount = COALESCE((
        SELECT SUM(quantity * unit_price * vat_rate / 100) 
        FROM quote_line_items 
        WHERE quote_id = COALESCE(NEW.quote_id, NEW.id)
      ), 0),
      updated_at = NOW()
    WHERE id = COALESCE(NEW.quote_id, NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for line items changes
DROP TRIGGER IF EXISTS update_quote_on_line_item ON quote_line_items;
CREATE TRIGGER update_quote_on_line_item
  AFTER INSERT OR UPDATE OR DELETE ON quote_line_items
  FOR EACH ROW EXECUTE FUNCTION update_quote_totals();

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_quote_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_quote_timestamp ON quotes;
CREATE TRIGGER update_quote_timestamp
  BEFORE UPDATE ON quotes
  FOR EACH ROW EXECUTE FUNCTION update_quote_updated_at();

-- Function to convert quote to invoice
CREATE OR REPLACE FUNCTION convert_quote_to_invoice(p_quote_id UUID)
RETURNS UUID AS $$
DECLARE
  v_invoice_id UUID;
  v_invoice_number TEXT;
  v_customer_id UUID;
BEGIN
  -- Get quote data
  SELECT customer_id, prospect_name, prospect_email, prospect_address
  INTO v_customer_id
  FROM quotes WHERE id = p_quote_id;
  
  -- Generate invoice number
  v_invoice_number := (SELECT generate_invoice_number());
  
  -- Create invoice
  INSERT INTO invoices (invoice_number, customer_id, status, issue_date, due_date, subtotal, vat_amount, total)
  SELECT 
    v_invoice_number,
    COALESCE(v_customer_id, NULL),
    'draft',
    CURRENT_DATE,
    CURRENT_DATE + (SELECT default_payment_terms FROM company_settings LIMIT 1),
    q.subtotal,
    q.vat_amount,
    q.total
  FROM quotes q WHERE q.id = p_quote_id
  RETURNING id INTO v_invoice_id;
  
  -- Copy line items
  INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, vat_rate, line_total)
  SELECT 
    v_invoice_id,
    description,
    quantity,
    unit_price,
    vat_rate,
    line_total
  FROM quote_line_items WHERE quote_id = p_quote_id;
  
  -- Update quote
  UPDATE quotes
  SET converted_to_invoice_id = v_invoice_id, status = 'accepted', updated_at = NOW()
  WHERE id = p_quote_id;
  
  RETURN v_invoice_id;
END;
$$ LANGUAGE plpgsql;