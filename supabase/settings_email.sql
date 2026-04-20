-- Company Settings table
CREATE TABLE IF NOT EXISTS company_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL DEFAULT 'My Company',
  address_line_1 TEXT,
  address_line_2 TEXT,
  city TEXT DEFAULT 'London',
  county TEXT,
  postcode TEXT,
  country TEXT DEFAULT 'United Kingdom',
  phone TEXT,
  email TEXT,
  website TEXT,
  vat_number TEXT,
  company_number TEXT,
  logo_url TEXT,
  primary_colour TEXT DEFAULT '#2563EB',
  default_payment_terms INTEGER DEFAULT 30,
  default_vat_rate NUMERIC(5,2) DEFAULT 20.00,
  invoice_prefix TEXT DEFAULT 'INV-',
  invoice_starting_number INTEGER DEFAULT 1,
  invoice_footer_text TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Email Templates table
CREATE TABLE IF NOT EXISTS email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_type TEXT UNIQUE NOT NULL CHECK (template_type IN ('invoice', 'overdue_reminder', 'payment_confirmation', 'payment_failed')),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Email Log table
CREATE TABLE IF NOT EXISTS email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_type TEXT,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  to_email TEXT NOT NULL,
  subject TEXT,
  status TEXT DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  error_message TEXT
);

-- Insert default settings (only if empty)
INSERT INTO company_settings (company_name)
SELECT 'ClearRoute Ltd' WHERE NOT EXISTS (SELECT 1 FROM company_settings);

-- Insert default email templates
INSERT INTO email_templates (template_type, subject, body) VALUES
('invoice', 'Invoice {{invoice_number}} from {{company_name}}', 'Dear {{customer_name}},

Please find attached your invoice {{invoice_number}} for the amount of {{invoice_total}}.

Payment is due by {{due_date}}.

View your invoice and manage your account online: {{portal_link}}

If you have any questions please don't hesitate to get in touch.

Kind regards,
{{company_name}}'),
('overdue_reminder', 'Payment Reminder — Invoice {{invoice_number}} Overdue', 'Dear {{customer_name}},

This is a friendly reminder that invoice {{invoice_number}} for {{invoice_total}} was due on {{due_date}} and remains unpaid.

Please arrange payment at your earliest convenience.

Kind regards,
{{company_name}}'),
('payment_confirmation', 'Payment Received — Invoice {{invoice_number}}', 'Dear {{customer_name}},

Thank you — we have received your payment of {{invoice_total}} for invoice {{invoice_number}}.

Kind regards,
{{company_name}}'),
('payment_failed', 'Direct Debit Failed — Invoice {{invoice_number}}', 'Dear {{customer_name}},

Unfortunately your direct debit payment of {{invoice_total}} for invoice {{invoice_number}} was unsuccessful.

Please contact us to arrange alternative payment.

Kind regards,
{{company_name}}')
ON CONFLICT (template_type) DO NOTHING;

-- Enable RLS
ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_log ENABLE ROW LEVEL SECURITY;

-- Company Settings policies
CREATE POLICY "settings_read" ON company_settings FOR SELECT USING (true);
CREATE POLICY "settings_insert" ON company_settings FOR INSERT WITH CHECK (true);
CREATE POLICY "settings_update" ON company_settings FOR UPDATE USING (true);

-- Email Templates policies
CREATE POLICY "templates_read" ON email_templates FOR SELECT USING (true);
CREATE POLICY "templates_insert" ON email_templates FOR INSERT WITH CHECK (true);
CREATE POLICY "templates_update" ON email_templates FOR UPDATE USING (true);

-- Email Log policies
CREATE POLICY "log_read" ON email_log FOR SELECT USING (true);
CREATE POLICY "log_insert" ON email_log FOR INSERT WITH CHECK (true);

-- Storage bucket for company assets
INSERT INTO storage.buckets (id, name, public) VALUES ('company-assets', 'company-assets', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "company_assets_upload" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'company-assets');
CREATE POLICY "company_assets_read" ON storage.objects FOR SELECT USING (bucket_id = 'company-assets');
CREATE POLICY "company_assets_update" ON storage.objects FOR UPDATE USING (bucket_id = 'company-assets');
CREATE POLICY "company_assets_delete" ON storage.objects FOR DELETE USING (bucket_id = 'company-assets');