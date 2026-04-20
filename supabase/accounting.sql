-- Invoices table
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT UNIQUE NOT NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  route_id UUID REFERENCES routes(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'viewed', 'paid', 'overdue', 'cancelled')),
  issue_date DATE DEFAULT CURRENT_DATE,
  due_date DATE,
  subtotal NUMERIC(10,2) DEFAULT 0,
  vat_amount NUMERIC(10,2) DEFAULT 0,
  total NUMERIC(10,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Invoice line items
CREATE TABLE IF NOT EXISTS invoice_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity NUMERIC(10,2) DEFAULT 1,
  unit_price NUMERIC(10,2) DEFAULT 0,
  vat_rate NUMERIC(5,2) DEFAULT 20.00,
  line_total NUMERIC(10,2) DEFAULT 0
);

-- Payments tracking
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL,
  payment_date DATE DEFAULT CURRENT_DATE,
  method TEXT CHECK (method IN ('direct_debit', 'bank_transfer', 'cash', 'cheque', 'card', 'other')),
  reference TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Expenses tracking
CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description TEXT NOT NULL,
  category TEXT CHECK (category IN ('fuel', 'equipment', 'supplies', 'insurance', 'vehicle', 'other')),
  amount NUMERIC(10,2) NOT NULL,
  vat_reclaimable BOOLEAN DEFAULT false,
  vat_amount NUMERIC(10,2),
  expense_date DATE DEFAULT CURRENT_DATE,
  supplier TEXT,
  receipt_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

-- Policies for invoices
CREATE POLICY "invoices_read" ON invoices FOR SELECT USING (true);
CREATE POLICY "invoices_insert" ON invoices FOR INSERT WITH CHECK (true);
CREATE POLICY "invoices_update" ON invoices FOR UPDATE USING (true);
CREATE POLICY "invoices_delete" ON invoices FOR DELETE USING (true);

-- Policies for line items
CREATE POLICY "line_items_read" ON invoice_line_items FOR SELECT USING (true);
CREATE POLICY "line_items_insert" ON invoice_line_items FOR INSERT WITH CHECK (true);
CREATE POLICY "line_items_update" ON invoice_line_items FOR UPDATE USING (true);
CREATE POLICY "line_items_delete" ON invoice_line_items FOR DELETE USING (true);

-- Policies for payments
CREATE POLICY "payments_read" ON payments FOR SELECT USING (true);
CREATE POLICY "payments_insert" ON payments FOR INSERT WITH CHECK (true);
CREATE POLICY "payments_update" ON payments FOR UPDATE USING (true);
CREATE POLICY "payments_delete" ON payments FOR DELETE USING (true);

-- Policies for expenses
CREATE POLICY "expenses_read" ON expenses FOR SELECT USING (true);
CREATE POLICY "expenses_insert" ON expenses FOR INSERT WITH CHECK (true);
CREATE POLICY "expenses_update" ON expenses FOR UPDATE USING (true);
CREATE POLICY "expenses_delete" ON expenses FOR DELETE USING (true);

-- Function to generate invoice numbers
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TEXT AS $$
DECLARE
  next_num INTEGER;
  year_num TEXT;
BEGIN
  SELECT COALESCE(MAX(
    NULLIF(SUBSTRING(invoice_number FROM '.[0-9]+$'), '')::INT
  ), 0) + 1 INTO next_num
  FROM invoices
  WHERE EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM NOW());
  
  year_num := EXTRACT(YEAR FROM NOW())::TEXT;
  
  RETURN 'INV-' || year_num || '-' || LPAD(next_num::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- Function to update invoice totals
CREATE OR REPLACE FUNCTION update_invoice_totals()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.invoice_id IS NOT NULL THEN
    UPDATE invoices
    SET 
      subtotal = COALESCE((
        SELECT SUM(quantity * unit_price) 
        FROM invoice_line_items 
        WHERE invoice_id = COALESCE(NEW.invoice_id, NEW.id)
      ), 0),
      vat_amount = COALESCE((
        SELECT SUM(quantity * unit_price * vat_rate / 100) 
        FROM invoice_line_items 
        WHERE invoice_id = COALESCE(NEW.invoice_id, NEW.id)
      ), 0),
      updated_at = NOW()
    WHERE id = COALESCE(NEW.invoice_id, NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for line items changes
DROP TRIGGER IF EXISTS update_invoice_on_line_item ON invoice_line_items;
CREATE TRIGGER update_invoice_on_line_item
  AFTER INSERT OR UPDATE OR DELETE ON invoice_line_items
  FOR EACH ROW EXECUTE FUNCTION update_invoice_totals();

-- Function to mark overdue invoices
CREATE OR REPLACE FUNCTION mark_overdue_invoices()
RETURNS VOID AS $$
BEGIN
  UPDATE invoices
  SET status = 'overdue'
  WHERE status = 'sent' 
    AND due_date < CURRENT_DATE
    AND NOT EXISTS (
      SELECT 1 FROM payments p 
      WHERE p.invoice_id = invoices.id
      GROUP BY p.invoice_id
      HAVING SUM(p.amount) >= invoices.total
    );
END;
$$ LANGUAGE plpgsql;