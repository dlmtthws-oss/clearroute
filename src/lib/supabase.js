import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

// Guard against missing environment configuration. Passing undefined to
// createClient throws synchronously at import time, which crashes the whole
// app to a blank white screen before anything renders. Instead, fall back to
// harmless placeholders and log a clear error so the app still boots (the
// login screen shows) and the real problem is obvious in the console.
if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.error(
    '[ClearRoute] Missing Supabase env vars: set REACT_APP_SUPABASE_URL and ' +
      'REACT_APP_SUPABASE_ANON_KEY for this deployment.'
  );
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'public-anon-key-placeholder'
);
