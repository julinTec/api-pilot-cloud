-- Índice composto para acelerar filtros e agrupamentos por escola
CREATE INDEX IF NOT EXISTS idx_syseduca_dados_connection_ano_escola 
ON public.syseduca_dados(connection_id, ano, escola);

-- Função RPC para retornar resumo agregado por escola
CREATE OR REPLACE FUNCTION public.syseduca_school_summary(
  p_connection_id uuid,
  p_ano integer
)
RETURNS TABLE (
  escola text,
  registros bigint,
  alunos bigint,
  total_bruto numeric,
  total_pago numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT 
    escola,
    count(*) as registros,
    count(distinct matricula) as alunos,
    coalesce(sum(
      (nullif(data->>'bruto', ''))::numeric
    ), 0) as total_bruto,
    coalesce(sum(
      (nullif(data->>'valor_pago', ''))::numeric
    ), 0) as total_pago
  FROM syseduca_dados
  WHERE connection_id = p_connection_id
    AND ano = p_ano
  GROUP BY escola
  ORDER BY escola;
$$;