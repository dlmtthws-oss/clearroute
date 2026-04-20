-- Bank Connection OAuth Tokens (temporary storage)
CREATE TABLE IF NOT EXISTS bank_connection_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  code_verifier TEXT NOT NULL,
  auth_state TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Clean up old tokens after 10 minutes
CREATE OR REPLACE FUNCTION cleanup_bank_tokens()
RETURNS void AS $$
BEGIN
  DELETE FROM bank_connection_tokens 
  WHERE created_at < NOW() - INTERVAL '10 minutes';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Grant pg_cron permissions
GRANT USAGE ON SCHEMA cron TO postgres;

-- Daily sync at 07:00 UTC
SELECT cron.schedule(
  'daily-bank-sync',
  '0 7 * * *',
  $$
  SELECT sync_all_bank_connections();
  $$
);

-- Function to sync all active bank connections
CREATE OR REPLACE FUNCTION sync_all_bank_connections()
RETURNS void AS $$
DECLARE
  conn RECORD;
  sync_result JSON;
BEGIN
  FOR conn IN 
    SELECT id, user_id 
    FROM bank_connections 
    WHERE is_active = true
  LOOP
    BEGIN
      -- Call the edge function via HTTP would require additional setup
      -- For now, log that sync is needed
      INSERT INTO notifications (user_id, title, body, type)
      VALUES (
        conn.user_id,
        'Bank Sync Required',
        'Please sync your bank account manually',
        'info'
      )
      ON CONFLICT DO NOTHING;
      
    EXCEPTION WHEN OTHERS THEN
      -- Log error but continue with other connections
      RAISE NOTICE 'Sync failed for connection %: %', conn.id, SQLERRM;
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION sync_all_bank_connections() TO postgres;
GRANT EXECUTE ON FUNCTION cleanup_bank_tokens() TO postgres;

-- Auto-cleanup tokens every 5 minutes
SELECT cron.schedule(
  'cleanup-bank-tokens',
  '*/5 * * * *',
  'SELECT cleanup_bank_tokens();'
);
