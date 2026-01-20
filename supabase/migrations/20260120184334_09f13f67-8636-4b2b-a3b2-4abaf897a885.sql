-- Create cache table for SysEduca API data
CREATE TABLE IF NOT EXISTS public.syseduca_sync_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL,
  cache_key TEXT NOT NULL,
  data JSONB NOT NULL,
  total_records INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(connection_id, cache_key)
);

-- Index for fast lookup
CREATE INDEX idx_syseduca_cache_lookup 
  ON public.syseduca_sync_cache(connection_id, cache_key);

-- Enable RLS
ALTER TABLE public.syseduca_sync_cache ENABLE ROW LEVEL SECURITY;

-- Policy for edge functions (service role)
CREATE POLICY "Service role can manage syseduca cache"
  ON public.syseduca_sync_cache
  FOR ALL
  USING (true)
  WITH CHECK (true);