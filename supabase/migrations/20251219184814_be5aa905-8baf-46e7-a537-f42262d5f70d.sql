-- Enum para tipos de autenticação
CREATE TYPE public.auth_type AS ENUM ('bearer_token', 'api_key', 'basic_auth', 'oauth2');

-- Enum para status
CREATE TYPE public.sync_status AS ENUM ('active', 'paused', 'error');

-- Enum para status de execução
CREATE TYPE public.execution_status AS ENUM ('pending', 'running', 'success', 'error');

-- Tabela de provedores de API
CREATE TABLE public.api_providers (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    base_url TEXT NOT NULL,
    base_url_dev TEXT,
    logo_url TEXT,
    description TEXT,
    auth_type auth_type NOT NULL DEFAULT 'bearer_token',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Tabela de conexões (credenciais por provedor)
CREATE TABLE public.api_connections (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    provider_id UUID NOT NULL REFERENCES public.api_providers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    credentials JSONB NOT NULL DEFAULT '{}',
    environment TEXT NOT NULL DEFAULT 'production',
    status sync_status NOT NULL DEFAULT 'active',
    last_test_at TIMESTAMP WITH TIME ZONE,
    last_test_success BOOLEAN,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Tabela de endpoints por provedor
CREATE TABLE public.api_endpoints (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    provider_id UUID NOT NULL REFERENCES public.api_providers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    path TEXT NOT NULL,
    method TEXT NOT NULL DEFAULT 'GET',
    description TEXT,
    pagination_type TEXT DEFAULT 'offset',
    pagination_param TEXT DEFAULT 'offset',
    page_size_param TEXT DEFAULT 'limit',
    default_page_size INTEGER DEFAULT 100,
    response_data_path TEXT DEFAULT 'data',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE(provider_id, slug)
);

-- Tabela de configuração de extração por endpoint
CREATE TABLE public.extraction_configs (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    connection_id UUID NOT NULL REFERENCES public.api_connections(id) ON DELETE CASCADE,
    endpoint_id UUID NOT NULL REFERENCES public.api_endpoints(id) ON DELETE CASCADE,
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    sync_frequency_minutes INTEGER NOT NULL DEFAULT 60,
    last_sync_at TIMESTAMP WITH TIME ZONE,
    next_sync_at TIMESTAMP WITH TIME ZONE,
    extra_params JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE(connection_id, endpoint_id)
);

-- Tabela de logs de execução
CREATE TABLE public.extraction_logs (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    connection_id UUID NOT NULL REFERENCES public.api_connections(id) ON DELETE CASCADE,
    endpoint_id UUID REFERENCES public.api_endpoints(id) ON DELETE SET NULL,
    status execution_status NOT NULL DEFAULT 'pending',
    records_processed INTEGER DEFAULT 0,
    records_created INTEGER DEFAULT 0,
    records_updated INTEGER DEFAULT 0,
    duration_ms INTEGER,
    error_message TEXT,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    finished_at TIMESTAMP WITH TIME ZONE
);

-- Tabelas específicas Eskolare
CREATE TABLE public.eskolare_orders (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    connection_id UUID NOT NULL REFERENCES public.api_connections(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE(connection_id, external_id)
);

CREATE TABLE public.eskolare_payments (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    connection_id UUID NOT NULL REFERENCES public.api_connections(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE(connection_id, external_id)
);

CREATE TABLE public.eskolare_cancellations (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    connection_id UUID NOT NULL REFERENCES public.api_connections(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE(connection_id, external_id)
);

CREATE TABLE public.eskolare_partnerships (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    connection_id UUID NOT NULL REFERENCES public.api_connections(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE(connection_id, external_id)
);

CREATE TABLE public.eskolare_summaries (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    connection_id UUID NOT NULL REFERENCES public.api_connections(id) ON DELETE CASCADE,
    report_type TEXT NOT NULL,
    data JSONB NOT NULL,
    period_start DATE,
    period_end DATE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.api_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extraction_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extraction_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eskolare_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eskolare_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eskolare_cancellations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eskolare_partnerships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eskolare_summaries ENABLE ROW LEVEL SECURITY;

-- Public read policies for API providers and endpoints (reference data)
CREATE POLICY "Anyone can view api providers" ON public.api_providers FOR SELECT USING (true);
CREATE POLICY "Anyone can view api endpoints" ON public.api_endpoints FOR SELECT USING (true);

-- Public policies for connections and data (no auth required for this app)
CREATE POLICY "Anyone can manage connections" ON public.api_connections FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can manage extraction configs" ON public.extraction_configs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can view extraction logs" ON public.extraction_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can manage eskolare orders" ON public.eskolare_orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can manage eskolare payments" ON public.eskolare_payments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can manage eskolare cancellations" ON public.eskolare_cancellations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can manage eskolare partnerships" ON public.eskolare_partnerships FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can manage eskolare summaries" ON public.eskolare_summaries FOR ALL USING (true) WITH CHECK (true);

-- Insert Eskolare as first provider
INSERT INTO public.api_providers (name, slug, base_url, base_url_dev, description, auth_type) VALUES (
    'Eskolare',
    'eskolare',
    'https://api.eskolare.com/api/external/v1',
    'https://api.dev.eskolare.com/api/external/v1',
    'API de integração Eskolare para gestão de pedidos, pagamentos, cancelamentos e parcerias',
    'bearer_token'
);

-- Insert Eskolare endpoints
INSERT INTO public.api_endpoints (provider_id, name, slug, path, method, description, response_data_path) VALUES
((SELECT id FROM public.api_providers WHERE slug = 'eskolare'), 'Pedidos', 'orders', '/orders/', 'GET', 'Lista todos os pedidos', 'results'),
((SELECT id FROM public.api_providers WHERE slug = 'eskolare'), 'Pagamentos', 'payments', '/orders/payment/', 'GET', 'Lista todos os pagamentos', 'results'),
((SELECT id FROM public.api_providers WHERE slug = 'eskolare'), 'Cancelamentos', 'cancellations', '/orders/cancellation/', 'GET', 'Lista todos os cancelamentos', 'results'),
((SELECT id FROM public.api_providers WHERE slug = 'eskolare'), 'Parcerias', 'partnerships', '/partnerships/', 'GET', 'Lista todas as parcerias', 'results'),
((SELECT id FROM public.api_providers WHERE slug = 'eskolare'), 'Resumo', 'summaries', '/dashboard/', 'GET', 'Dados consolidados do dashboard', 'data');

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create triggers for automatic timestamp updates
CREATE TRIGGER update_api_providers_updated_at BEFORE UPDATE ON public.api_providers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_api_connections_updated_at BEFORE UPDATE ON public.api_connections FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_extraction_configs_updated_at BEFORE UPDATE ON public.extraction_configs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_eskolare_orders_updated_at BEFORE UPDATE ON public.eskolare_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_eskolare_payments_updated_at BEFORE UPDATE ON public.eskolare_payments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_eskolare_cancellations_updated_at BEFORE UPDATE ON public.eskolare_cancellations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_eskolare_partnerships_updated_at BEFORE UPDATE ON public.eskolare_partnerships FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_eskolare_summaries_updated_at BEFORE UPDATE ON public.eskolare_summaries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();