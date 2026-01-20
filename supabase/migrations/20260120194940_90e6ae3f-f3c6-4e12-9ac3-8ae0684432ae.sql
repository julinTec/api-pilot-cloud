-- Allow chunked caching to avoid statement timeouts when saving large JSON arrays
ALTER TABLE public.syseduca_sync_cache
ADD COLUMN IF NOT EXISTS chunk_index integer NOT NULL DEFAULT 0;

-- Replace unique constraint (connection_id, cache_key) -> (connection_id, cache_key, chunk_index)
ALTER TABLE public.syseduca_sync_cache
DROP CONSTRAINT IF EXISTS syseduca_sync_cache_connection_id_cache_key_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'syseduca_sync_cache_connection_id_cache_key_chunk_index_key'
  ) THEN
    ALTER TABLE public.syseduca_sync_cache
      ADD CONSTRAINT syseduca_sync_cache_connection_id_cache_key_chunk_index_key
      UNIQUE (connection_id, cache_key, chunk_index);
  END IF;
END $$;

-- Update index to include chunk ordering
DROP INDEX IF EXISTS public.idx_syseduca_cache_lookup;
CREATE INDEX IF NOT EXISTS idx_syseduca_cache_lookup
  ON public.syseduca_sync_cache(connection_id, cache_key, chunk_index);