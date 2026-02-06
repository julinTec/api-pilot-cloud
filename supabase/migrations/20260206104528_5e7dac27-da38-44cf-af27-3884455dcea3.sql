-- Create table for user file source access permissions
CREATE TABLE public.user_file_access (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    file_source_id uuid NOT NULL REFERENCES public.file_sources(id) ON DELETE CASCADE,
    can_view boolean DEFAULT true,
    can_manage boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    UNIQUE (user_id, file_source_id)
);

-- Enable RLS
ALTER TABLE public.user_file_access ENABLE ROW LEVEL SECURITY;

-- Admins can manage all file access permissions
CREATE POLICY "Admins can manage file access"
ON public.user_file_access
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Users can view their own access entries
CREATE POLICY "Users can view own file access"
ON public.user_file_access
FOR SELECT
USING (user_id = auth.uid());