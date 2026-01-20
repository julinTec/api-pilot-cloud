-- 1. Criar tabela para dados do SysEduca
CREATE TABLE public.syseduca_dados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL,
  escola TEXT NOT NULL,
  matricula TEXT NOT NULL,
  ano INTEGER NOT NULL,
  data JSONB NOT NULL DEFAULT '{}',
  external_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(connection_id, external_id)
);

-- Habilitar RLS
ALTER TABLE public.syseduca_dados ENABLE ROW LEVEL SECURITY;

-- Policy para acesso
CREATE POLICY "Anyone can manage syseduca dados" 
ON public.syseduca_dados 
FOR ALL 
USING (true) 
WITH CHECK (true);

-- Índices para performance
CREATE INDEX idx_syseduca_dados_escola ON public.syseduca_dados(escola);
CREATE INDEX idx_syseduca_dados_ano ON public.syseduca_dados(ano);
CREATE INDEX idx_syseduca_dados_connection ON public.syseduca_dados(connection_id);
CREATE INDEX idx_syseduca_dados_matricula ON public.syseduca_dados(matricula);

-- Trigger para updated_at
CREATE TRIGGER update_syseduca_dados_updated_at
BEFORE UPDATE ON public.syseduca_dados
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Inserir SysEduca como provider
INSERT INTO public.api_providers (name, slug, base_url, auth_type, description, is_active)
VALUES (
  'SysEduca',
  'syseduca', 
  'https://www.syseduca.com.br/api',
  'api_key',
  'Sistema educacional - dados de matrículas e pagamentos por escola',
  true
);

-- 3. Inserir endpoint de dados
INSERT INTO public.api_endpoints (provider_id, name, slug, path, method, description, pagination_type, is_active)
VALUES (
  (SELECT id FROM public.api_providers WHERE slug = 'syseduca'),
  'Dados Financeiros',
  'dados',
  '/dados02.asp',
  'GET',
  'Dados de matrículas, parcelas e pagamentos segregados por escola',
  'none',
  true
);