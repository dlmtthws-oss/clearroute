-- Jarvis as coordinator: automation registry + run log
--
-- Turns Jarvis from a read-only assistant into a coordinator that can trigger
-- the user's own "programs" and AI agents, implemented as n8n workflows
-- (self-hosted). Capabilities are DATA, not code: add a row here + build the
-- matching n8n workflow, and Jarvis can use it. The ai-assistant edge function
-- reads this registry so Claude knows what it can coordinate; the
-- jarvis-dispatch edge function actually calls the workflow's webhook.

CREATE TABLE IF NOT EXISTS jarvis_automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  -- What Claude sees to decide when to use it:
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'program' CHECK (category IN ('program', 'agent', 'data')),
  -- How jarvis-dispatch reaches the n8n workflow. webhook_path is appended to
  -- the N8N_WEBHOOK_BASE_URL secret, e.g. '/webhook/chase-overdue'.
  webhook_path TEXT NOT NULL,
  http_method TEXT NOT NULL DEFAULT 'POST' CHECK (http_method IN ('POST', 'GET', 'PUT')),
  -- JSON Schema describing the params Claude should collect before running.
  input_schema JSONB NOT NULL DEFAULT '{"type":"object","properties":{}}'::jsonb,
  -- Guardrail: when true (default), Jarvis proposes and the user must confirm
  -- in the UI before jarvis-dispatch fires. Set false only for safe read-only
  -- workflows you want to auto-run.
  requires_confirmation BOOLEAN NOT NULL DEFAULT true,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jarvis_action_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  automation_id UUID REFERENCES jarvis_automations(id) ON DELETE SET NULL,
  automation_name TEXT,
  params JSONB,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'error')),
  result JSONB,
  error TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jarvis_automations_user ON jarvis_automations(user_id);
CREATE INDEX IF NOT EXISTS idx_jarvis_automations_enabled ON jarvis_automations(enabled);
CREATE INDEX IF NOT EXISTS idx_jarvis_action_runs_user ON jarvis_action_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_jarvis_action_runs_created ON jarvis_action_runs(created_at DESC);

ALTER TABLE jarvis_automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE jarvis_action_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='jarvis_automations' AND policyname='Users manage own automations') THEN
    CREATE POLICY "Users manage own automations" ON jarvis_automations
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='jarvis_action_runs' AND policyname='Users view own action runs') THEN
    CREATE POLICY "Users view own action runs" ON jarvis_action_runs
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='jarvis_action_runs' AND policyname='Users insert own action runs') THEN
    CREATE POLICY "Users insert own action runs" ON jarvis_action_runs
      FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- Live action-run updates can flow across devices too.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='jarvis_action_runs') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE jarvis_action_runs;
  END IF;
END $$;
ALTER TABLE jarvis_action_runs REPLICA IDENTITY FULL;
