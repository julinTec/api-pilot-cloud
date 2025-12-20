-- Habilitar extensões necessárias para agendamento automático
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Adicionar colunas para controle de progresso de sincronização incremental
ALTER TABLE extraction_configs 
ADD COLUMN IF NOT EXISTS last_offset INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS is_complete BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS total_records INTEGER DEFAULT 0;