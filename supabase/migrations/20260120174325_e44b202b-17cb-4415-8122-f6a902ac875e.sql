-- Add requires_auth column to api_providers
ALTER TABLE public.api_providers 
ADD COLUMN requires_auth BOOLEAN NOT NULL DEFAULT true;

-- Mark SysEduca as not requiring authentication
UPDATE public.api_providers 
SET requires_auth = false 
WHERE slug = 'syseduca';