-- Company Logo Storage Setup

-- Enable Storage
-- Create storage bucket for company assets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('company-assets', 'company-assets', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'])
ON CONFLICT (id) DO NOTHING;

-- Allow public access to company-assets
CREATE POLICY "Public Access to company-assets" ON storage.objects
FOR SELECT USING (bucket_id = 'company-assets');

-- Allow authenticated uploads
CREATE POLICY "Authenticated can upload to company-assets" ON storage.objects
FOR INSERT WITH CHECK (bucket_id = 'company-assets' AND auth.role() = 'authenticated');

-- Add logo_url to profiles if not exists
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- Add company_name and other fields if not exists
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS default_vat_rate NUMERIC(5,2) DEFAULT 20.00;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS default_payment_terms INTEGER DEFAULT 30;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS primary_colour TEXT DEFAULT '#2563EB';