-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES workers(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN (
    'invoice_overdue', 'payment_failed', 'route_not_started',
    'payment_received', 'mandate_activated', 'mandate_cancelled',
    'route_completed', 'recurring_invoice_generated'
  )),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  is_read BOOLEAN DEFAULT false,
  action_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "notifications_read" ON notifications FOR SELECT USING (true);
CREATE POLICY "notifications_insert" ON notifications FOR INSERT WITH CHECK (true);
CREATE POLICY "notifications_update" ON notifications FOR UPDATE USING (true);
CREATE POLICY "notifications_delete" ON notifications FOR DELETE USING (true);

-- Indexes
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id);
CREATE INDEX IF NOT EXISTS notifications_created_idx ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_unread_idx ON notifications(user_id, is_read) WHERE is_read = false;

-- Notification settings table (per user preferences)
CREATE TABLE IF NOT EXISTS notification_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES workers(id) ON DELETE CASCADE UNIQUE,
  invoice_overdue BOOLEAN DEFAULT true,
  payment_failed BOOLEAN DEFAULT true,
  route_not_started BOOLEAN DEFAULT true,
  payment_received BOOLEAN DEFAULT true,
  mandate_activated BOOLEAN DEFAULT true,
  mandate_cancelled BOOLEAN DEFAULT true,
  route_completed BOOLEAN DEFAULT true,
  recurring_invoice_generated BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE notification_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "settings_read" ON notification_settings FOR SELECT USING (true);
CREATE POLICY "settings_insert" ON notification_settings FOR INSERT WITH CHECK (true);
CREATE POLICY "settings_update" ON notification_settings FOR UPDATE USING (true);

-- Helper function to create notifications
CREATE OR REPLACE FUNCTION create_notification(
  p_user_id UUID,
  p_type TEXT,
  p_title TEXT,
  p_message TEXT,
  p_entity_type TEXT DEFAULT NULL,
  p_entity_id UUID DEFAULT NULL,
  p_action_url TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  -- Check if similar unread notification already exists (prevent duplicates)
  SELECT EXISTS (
    SELECT 1 FROM notifications
    WHERE type = p_type
    AND COALESCE(user_id, -1) = COALESCE(p_user_id, -1)
    AND entity_id = p_entity_id
    AND is_read = false
    AND created_at > NOW() - INTERVAL '1 day'
  ) INTO v_exists;

  IF NOT v_exists OR v_exists IS FALSE THEN
    INSERT INTO notifications (user_id, type, title, message, entity_type, entity_id, action_url)
    VALUES (p_user_id, p_type, p_title, p_message, p_entity_type, p_entity_id, p_action_url);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to mark notification as read
CREATE OR REPLACE FUNCTION mark_notification_read(p_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE notifications SET is_read = true WHERE id = p_id;
END;
$$ LANGUAGE plpgsql;

-- Function to mark all notifications as read for user
CREATE OR REPLACE FUNCTION mark_all_notifications_read(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE notifications SET is_read = true WHERE user_id = p_user_id AND is_read = false;
END;
$$ LANGUAGE plpgsql;

-- Function to clean old notifications (run daily via pg_cron)
CREATE OR REPLACE FUNCTION cleanup_old_notifications()
RETURNS VOID AS $$
BEGIN
  DELETE FROM notifications WHERE created_at < NOW() - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql;