-- Jarvis cross-device "one brain" interface
-- Enables Supabase Realtime so a single conversation is mirrored live across
-- every device a user is signed into (laptop <-> desktop <-> phone).
--
-- The ai-assistant edge function already persists both the user's message and
-- the assistant's reply into ai_messages. By publishing that table (and
-- ai_conversations) to the realtime stream, any device subscribed to the
-- active conversation receives new turns instantly - no polling, one brain.

-- Add the AI tables to the realtime publication (id must exist; created by
-- the default Supabase setup). IF EXISTS guards keep this idempotent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    -- ai_messages: live turns across devices
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = 'ai_messages'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE ai_messages;
    END IF;

    -- ai_conversations: lets a device learn when the shared "active" thread
    -- changes (new conversation started elsewhere) and follow along.
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = 'ai_conversations'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE ai_conversations;
    END IF;
  END IF;
END $$;

-- REPLICA IDENTITY FULL ensures realtime payloads include the full row so
-- clients can reconcile/dedupe optimistic messages against persisted ones.
ALTER TABLE ai_messages REPLICA IDENTITY FULL;
ALTER TABLE ai_conversations REPLICA IDENTITY FULL;

-- Note: device presence and "thinking" indicators use ephemeral Realtime
-- Presence/Broadcast channels (no table required).
