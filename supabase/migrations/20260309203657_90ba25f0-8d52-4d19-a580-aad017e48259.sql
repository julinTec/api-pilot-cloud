
-- Add policy to allow users to view file_sources they have access to via user_file_access
CREATE POLICY "Users can view files with granted access"
ON public.file_sources
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_file_access
    WHERE user_file_access.file_source_id = file_sources.id
      AND user_file_access.user_id = auth.uid()
      AND user_file_access.can_view = true
  )
);

-- Also add policy for file_source_data so users can read data from files they have access to
CREATE POLICY "Users can read data from accessible files"
ON public.file_source_data
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_file_access
    WHERE user_file_access.file_source_id = file_source_data.file_source_id
      AND user_file_access.user_id = auth.uid()
      AND user_file_access.can_view = true
  )
);
