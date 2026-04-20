-- Onboarding SQL Schema

-- Add onboarding fields to company_settings
ALTER TABLE company_settings 
ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS onboarding_step INTEGER DEFAULT 0;

-- Create onboarding_checklist table
CREATE TABLE IF NOT EXISTS onboarding_checklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  step TEXT NOT NULL,
  completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE onboarding_checklist ENABLE ROW LEVEL SECURITY;

-- RLS policies for onboarding_checklist
DROP POLICY IF EXISTS "Users can view own checklist" ON onboarding_checklist;
DROP POLICY IF EXISTS "Users can insert own checklist" ON onboarding_checklist;
DROP POLICY IF EXISTS "Users can update own checklist" ON onboarding_checklist;

CREATE POLICY "Users can view own checklist" ON onboarding_checklist
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can insert own checklist" ON onboarding_checklist
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own checklist" ON onboarding_checklist
  FOR UPDATE USING (user_id = auth.uid());

-- Company settings RLS update for onboarding
DROP POLICY IF EXISTS "Users can update company onboarding" ON company_settings;
CREATE POLICY "Users can update company onboarding" ON company_settings
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );