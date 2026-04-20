-- Receipt Storage Setup

-- Create private bucket for receipts
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('receipts', 'receipts', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload receipts
CREATE POLICY "Authenticated can upload receipts" ON storage.objects
FOR INSERT WITH CHECK (bucket_id = 'receipts' AND auth.role() = 'authenticated');

-- Allow authenticated users to view their own receipts
CREATE POLICY "Users can view own receipts" ON storage.objects
FOR SELECT USING (bucket_id = 'receipts' AND auth.role() = 'authenticated');

-- Allow authenticated users to update their own receipts
CREATE POLICY "Users can update own receipts" ON storage.objects
FOR UPDATE USING (bucket_id = 'receipts' AND auth.role() = 'authenticated');

-- Allow authenticated users to delete their own receipts
CREATE POLICY "Users can delete own receipts" ON storage.objects
FOR DELETE USING (bucket_id = 'receipts' AND auth.role() = 'authenticated');

-- Add receipt_url column to expenses table if not exists
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_url TEXT;

-- Add scanned_data column to store OCR results for review
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS scanned_data JSONB;
