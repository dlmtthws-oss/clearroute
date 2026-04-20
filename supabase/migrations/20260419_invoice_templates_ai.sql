-- Migration: Create invoice_templates_ai table
-- Date: 2026-04-19

CREATE TABLE IF NOT EXISTS invoice_templates_ai (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  service_type TEXT,
  description_template TEXT NOT NULL,
  typical_quantity NUMERIC(10, 2),
  typical_unit_price NUMERIC(10, 2),
  usage_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMP WITH TIME ZONE,
  created_by TEXT CHECK (created_by IN ('ai', 'user')) DEFAULT 'ai',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_invoice_templates_ai_customer ON invoice_templates_ai(customer_id);
CREATE INDEX idx_invoice_templates_ai_service ON invoice_templates_ai(service_type);
CREATE INDEX idx_invoice_templates_ai_active ON invoice_templates_ai(is_active) WHERE is_active = true;

-- Insert default AI templates for window cleaning services
INSERT INTO invoice_templates_ai (service_type, description_template, typical_quantity, typical_unit_price, created_by) VALUES
  ('Window Cleaning', 'Window Cleaning — External', 1, 45.00, 'ai'),
  ('Window Cleaning', 'Window Cleaning — Internal and External', 1, 85.00, 'ai'),
  ('Gutter Cleaning', 'Gutter Cleaning', 1, 75.00, 'ai'),
  ('Conservatory', 'Conservatory Roof Cleaning', 1, 120.00, 'ai'),
  ('Solar Panels', 'Solar Panel Cleaning', 1, 65.00, 'ai'),
  ('Frame Cleaning', 'Frame and Sill Cleaning', 1, 35.00, 'ai')
ON CONFLICT DO NOTHING;