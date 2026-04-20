-- AI Communications tables

CREATE TABLE IF NOT EXISTS communication_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  communication_type TEXT NOT NULL CHECK (communication_type IN (
    'appointment_confirmation', 'arrival_reminder', 'job_completion',
    'payment_reminder_soft', 'payment_reminder_firm', 'payment_thank_you',
    'satisfaction_follow_up', 're_engagement', 'seasonal_greeting'
  )),
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'generating', 'ready', 'approved', 'sent', 'failed', 'cancelled'
  )),
  generated_subject TEXT,
  generated_body TEXT,
  approved_by UUID REFERENCES profiles(id),
  approved_at TIMESTAMP WITH TIME ZONE,
  scheduled_send_at TIMESTAMP WITH TIME ZONE,
  sent_at TIMESTAMP WITH TIME ZONE,
  trigger_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS communication_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE UNIQUE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  email_enabled BOOLEAN DEFAULT true,
  sms_enabled BOOLEAN DEFAULT false,
  appointment_confirmations BOOLEAN DEFAULT true,
  payment_reminders BOOLEAN DEFAULT true,
  satisfaction_followups BOOLEAN DEFAULT true,
  marketing BOOLEAN DEFAULT false,
  preferred_channel TEXT DEFAULT 'email' CHECK (preferred_channel IN ('email', 'sms')),
  unsubscribed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_comm_queue_user ON communication_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_comm_queue_status ON communication_queue(status);
CREATE INDEX IF NOT EXISTS idx_comm_queue_type ON communication_queue(communication_type);
CREATE INDEX IF NOT EXISTS idx_comm_queue_scheduled ON communication_queue(scheduled_send_at);
CREATE INDEX IF NOT EXISTS idx_comm_prefs_customer ON communication_preferences(customer_id);

-- RLS
ALTER TABLE communication_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own communications" ON communication_queue
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own communications" ON communication_queue
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own communications" ON communication_queue
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own preferences" ON communication_preferences
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own preferences" ON communication_preferences
  FOR UPDATE USING (auth.uid() = user_id);

-- Helper: Get communication preferences for customer
CREATE OR REPLACE FUNCTION get_communication_prefs(cust_id UUID)
RETURNS TABLE(email_enabled BOOLEAN, sms_enabled BOOLEAN, preferred_channel TEXT, unsubscribed_at TIMESTAMP WITH TIME ZONE)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT cp.email_enabled, cp.sms_enabled, cp.preferred_channel, cp.unsubscribed_at
  FROM communication_preferences cp
  WHERE cp.customer_id = cust_id;
END;
$$;

-- Automation settings table
CREATE TABLE IF NOT EXISTS communication_automation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
  appointment_confirmation_auto BOOLEAN DEFAULT true,
  arrival_reminder_auto BOOLEAN DEFAULT true,
  job_completion_auto BOOLEAN DEFAULT true,
  payment_reminder_soft_auto BOOLEAN DEFAULT false,
  payment_reminder_firm_auto BOOLEAN DEFAULT false,
  satisfaction_followup_auto BOOLEAN DEFAULT true,
  re_engagement_auto BOOLEAN DEFAULT false,
  appointment_channel TEXT DEFAULT 'email',
  reminder_channel TEXT DEFAULT 'email',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE communication_automation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own automation" ON communication_automation
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own automation" ON communication_automation
  FOR UPDATE USING (auth.uid() = user_id);