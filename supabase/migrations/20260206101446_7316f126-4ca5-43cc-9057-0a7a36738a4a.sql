-- Create RPC function to get all file source data
CREATE OR REPLACE FUNCTION public.get_file_data(p_slug TEXT)
RETURNS TABLE(row_data JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_file_source_id UUID;
BEGIN
  -- Get file source ID by slug
  SELECT id INTO v_file_source_id
  FROM file_sources
  WHERE slug = p_slug AND status = 'ready';

  IF v_file_source_id IS NULL THEN
    RAISE EXCEPTION 'File source not found: %', p_slug;
  END IF;

  -- Return all data rows
  RETURN QUERY
  SELECT data
  FROM file_source_data
  WHERE file_source_id = v_file_source_id
  ORDER BY row_index;
END;
$$;