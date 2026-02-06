-- Create table to store parsed data from file sources
CREATE TABLE public.file_source_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_source_id UUID REFERENCES public.file_sources(id) ON DELETE CASCADE NOT NULL,
  row_index INTEGER NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (file_source_id, row_index)
);

ALTER TABLE public.file_source_data ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read file data (for API access)
CREATE POLICY "Authenticated can read file data" ON public.file_source_data
  FOR SELECT USING (auth.role() = 'authenticated' OR auth.role() = 'anon');

-- Admins can manage file data
CREATE POLICY "Admins can manage file data" ON public.file_source_data
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Add slug column to file_sources for API endpoint naming
ALTER TABLE public.file_sources ADD COLUMN slug TEXT;

-- Create index for faster queries
CREATE INDEX idx_file_source_data_file_source_id ON public.file_source_data(file_source_id);
CREATE INDEX idx_file_sources_slug ON public.file_sources(slug);