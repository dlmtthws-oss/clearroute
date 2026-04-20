-- Recurring Invoice Templates table
CREATE TABLE IF NOT EXISTS recurring_invoice_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'fortnightly', 'monthly', 'quarterly', 'annually')),
  next_run_date DATE,
  last_run_date DATE,
  day_of_week INTEGER CHECK (day_of_week >= 0 AND day_of_week <= 6),
  day_of_month INTEGER CHECK (day_of_month >= 1 AND day_of_month <= 31),
  payment_terms INTEGER DEFAULT 30,
  auto_collect BOOLEAN DEFAULT false,
  send_on_create BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Recurring Invoice Line Items table
CREATE TABLE IF NOT EXISTS recurring_invoice_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES recurring_invoice_templates(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity NUMERIC(10,2) DEFAULT 1,
  unit_price NUMERIC(10,2) DEFAULT 0,
  vat_rate NUMERIC(5,2) DEFAULT 20.00,
  line_total NUMERIC(10,2)
);

-- Add recurring_template_id to invoices if not exists
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS recurring_template_id UUID REFERENCES recurring_invoice_templates(id);

-- Enable RLS
ALTER TABLE recurring_invoice_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_invoice_line_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "recurring_templates_read" ON recurring_invoice_templates FOR SELECT USING (true);
CREATE POLICY "recurring_templates_insert" ON recurring_invoice_templates FOR INSERT WITH CHECK (true);
CREATE POLICY "recurring_templates_update" ON recurring_invoice_templates FOR UPDATE USING (true);
CREATE POLICY "recurring_templates_delete" ON recurring_invoice_templates FOR DELETE USING (true);

CREATE POLICY "recurring_line_items_read" ON recurring_invoice_line_items FOR SELECT USING (true);
CREATE POLICY "recurring_line_items_insert" ON recurring_invoice_line_items FOR INSERT WITH CHECK (true);
CREATE POLICY "recurring_line_items_update" ON recurring_invoice_line_items FOR UPDATE USING (true);
CREATE POLICY "recurring_line_items_delete" ON recurring_invoice_line_items FOR DELETE USING (true);

-- Indexes
CREATE INDEX IF NOT EXISTS recurring_templates_customer_idx ON recurring_invoice_templates(customer_id);
CREATE INDEX IF NOT EXISTS recurring_templates_next_run_idx ON recurring_invoice_templates(next_run_date) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS recurring_line_items_template_idx ON recurring_invoice_line_items(template_id);

-- Function to calculate next run date
CREATE OR REPLACE FUNCTION calculate_next_run_date(
  p_last_run_date DATE,
  p_frequency TEXT,
  p_day_of_week INTEGER DEFAULT NULL,
  p_day_of_month INTEGER DEFAULT NULL
) RETURNS DATE AS $$
DECLARE
  v_next_date DATE;
  v_month INTEGER;
BEGIN
  IF p_last_run_date IS NULL THEN
    RETURN CURRENT_DATE;
  END IF;

  CASE p_frequency
    WHEN 'weekly' THEN
      v_next_date := p_last_run_date + 7;
    WHEN 'fortnightly' THEN
      v_next_date := p_last_run_date + 14;
    WHEN 'monthly' THEN
      v_month := EXTRACT(MONTH FROM p_last_run_date) + 1;
      IF v_month > 12 THEN
        v_month := 1;
      END IF;
      v_next_date := MAKE_DATE(EXTRACT(YEAR FROM p_last_run_date) + CASE WHEN v_month <= EXTRACT(MONTH FROM p_last_run_date) THEN 1 ELSE 0 END, v_month, COALESCE(LEAST(p_day_of_month, 28), EXTRACT(DAY FROM p_last_run_date)));
    WHEN 'quarterly' THEN
      v_month := EXTRACT(MONTH FROM p_last_run_date) + 3;
      IF v_month > 12 THEN
        v_month := v_month - 12;
      END IF;
      v_next_date := MAKE_DATE(EXTRACT(YEAR FROM p_last_run_date) + CASE WHEN v_month <= EXTRACT(MONTH FROM p_last_run_date) THEN 1 ELSE 0 END, v_month, COALESCE(LEAST(p_day_of_month, 28), EXTRACT(DAY FROM p_last_run_date)));
    WHEN 'annually' THEN
      v_next_date := MAKE_DATE(EXTRACT(YEAR FROM p_last_run_date) + 1, EXTRACT(MONTH FROM p_last_run_date), COALESCE(LEAST(p_day_of_month, 28), EXTRACT(DAY FROM p_last_run_date)));
    ELSE
      v_next_date := p_last_run_date + 30;
  END CASE;

  RETURN v_next_date;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_recurring_template_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_recurring_template_timestamp ON recurring_invoice_templates;
CREATE TRIGGER update_recurring_template_timestamp
  BEFORE UPDATE ON recurring_invoice_templates
  FOR EACH ROW EXECUTE FUNCTION update_recurring_template_updated_at();