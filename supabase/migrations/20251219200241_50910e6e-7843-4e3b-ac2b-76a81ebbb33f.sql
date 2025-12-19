-- 1. Atualizar Base URL do Provider Eskolare
UPDATE api_providers 
SET 
  base_url = 'https://api.eskolare.com/api/integrations/eskolare',
  base_url_dev = 'https://api.dev.eskolare.com/api/integrations/eskolare',
  updated_at = now()
WHERE slug = 'eskolare';

-- 2. Corrigir paths dos endpoints existentes
UPDATE api_endpoints SET path = '/cancellations/', response_data_path = 'results' WHERE slug = 'cancellations';
UPDATE api_endpoints SET path = '/institutions/partnerships/', response_data_path = 'results' WHERE slug = 'partnerships';
UPDATE api_endpoints SET path = '/payments/', response_data_path = 'results' WHERE slug = 'payments';
UPDATE api_endpoints SET path = '/orders/', response_data_path = 'results' WHERE slug = 'orders';

-- 3. Desativar endpoint summaries (não existe na API)
UPDATE api_endpoints SET is_active = false WHERE slug = 'summaries';

-- 4. Obter o provider_id do Eskolare para os novos endpoints
-- Adicionar novos endpoints
INSERT INTO api_endpoints (provider_id, name, slug, path, method, response_data_path, pagination_type, pagination_param, page_size_param, default_page_size, is_active)
SELECT 
  id as provider_id,
  'Grades' as name,
  'grades' as slug,
  '/institutions/grades/' as path,
  'GET' as method,
  'results' as response_data_path,
  'offset' as pagination_type,
  'offset' as pagination_param,
  'limit' as page_size_param,
  100 as default_page_size,
  true as is_active
FROM api_providers WHERE slug = 'eskolare'
ON CONFLICT DO NOTHING;

INSERT INTO api_endpoints (provider_id, name, slug, path, method, response_data_path, pagination_type, pagination_param, page_size_param, default_page_size, is_active)
SELECT 
  id as provider_id,
  'Showcases' as name,
  'showcases' as slug,
  '/institutions/showcases/' as path,
  'GET' as method,
  'results' as response_data_path,
  'offset' as pagination_type,
  'offset' as pagination_param,
  'limit' as page_size_param,
  100 as default_page_size,
  true as is_active
FROM api_providers WHERE slug = 'eskolare'
ON CONFLICT DO NOTHING;

INSERT INTO api_endpoints (provider_id, name, slug, path, method, response_data_path, pagination_type, pagination_param, page_size_param, default_page_size, is_active)
SELECT 
  id as provider_id,
  'Withdrawals' as name,
  'withdrawals' as slug,
  '/financial/withdrawals/' as path,
  'GET' as method,
  'results' as response_data_path,
  'offset' as pagination_type,
  'offset' as pagination_param,
  'limit' as page_size_param,
  100 as default_page_size,
  true as is_active
FROM api_providers WHERE slug = 'eskolare'
ON CONFLICT DO NOTHING;

INSERT INTO api_endpoints (provider_id, name, slug, path, method, response_data_path, pagination_type, pagination_param, page_size_param, default_page_size, is_active)
SELECT 
  id as provider_id,
  'Transactions' as name,
  'transactions' as slug,
  '/financial/transactions/' as path,
  'GET' as method,
  'results' as response_data_path,
  'offset' as pagination_type,
  'offset' as pagination_param,
  'limit' as page_size_param,
  100 as default_page_size,
  true as is_active
FROM api_providers WHERE slug = 'eskolare'
ON CONFLICT DO NOTHING;

INSERT INTO api_endpoints (provider_id, name, slug, path, method, response_data_path, pagination_type, pagination_param, page_size_param, default_page_size, is_active)
SELECT 
  id as provider_id,
  'Categories' as name,
  'categories' as slug,
  '/catalog/categories/' as path,
  'GET' as method,
  'results' as response_data_path,
  'offset' as pagination_type,
  'offset' as pagination_param,
  'limit' as page_size_param,
  100 as default_page_size,
  true as is_active
FROM api_providers WHERE slug = 'eskolare'
ON CONFLICT DO NOTHING;

-- 5. Criar novas tabelas para os endpoints adicionais

-- Tabela grades
CREATE TABLE IF NOT EXISTS public.eskolare_grades (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  connection_id UUID NOT NULL REFERENCES api_connections(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(connection_id, external_id)
);

ALTER TABLE public.eskolare_grades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can manage eskolare grades" ON public.eskolare_grades
  FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_eskolare_grades_updated_at
  BEFORE UPDATE ON public.eskolare_grades
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tabela showcases
CREATE TABLE IF NOT EXISTS public.eskolare_showcases (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  connection_id UUID NOT NULL REFERENCES api_connections(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(connection_id, external_id)
);

ALTER TABLE public.eskolare_showcases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can manage eskolare showcases" ON public.eskolare_showcases
  FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_eskolare_showcases_updated_at
  BEFORE UPDATE ON public.eskolare_showcases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tabela withdrawals
CREATE TABLE IF NOT EXISTS public.eskolare_withdrawals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  connection_id UUID NOT NULL REFERENCES api_connections(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(connection_id, external_id)
);

ALTER TABLE public.eskolare_withdrawals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can manage eskolare withdrawals" ON public.eskolare_withdrawals
  FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_eskolare_withdrawals_updated_at
  BEFORE UPDATE ON public.eskolare_withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tabela transactions
CREATE TABLE IF NOT EXISTS public.eskolare_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  connection_id UUID NOT NULL REFERENCES api_connections(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(connection_id, external_id)
);

ALTER TABLE public.eskolare_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can manage eskolare transactions" ON public.eskolare_transactions
  FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_eskolare_transactions_updated_at
  BEFORE UPDATE ON public.eskolare_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tabela categories
CREATE TABLE IF NOT EXISTS public.eskolare_categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  connection_id UUID NOT NULL REFERENCES api_connections(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(connection_id, external_id)
);

ALTER TABLE public.eskolare_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can manage eskolare categories" ON public.eskolare_categories
  FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_eskolare_categories_updated_at
  BEFORE UPDATE ON public.eskolare_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();