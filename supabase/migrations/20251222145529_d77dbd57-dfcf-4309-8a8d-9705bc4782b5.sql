-- Create table for order details
CREATE TABLE public.eskolare_order_details (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  connection_id UUID NOT NULL,
  external_id TEXT NOT NULL, -- order_number
  order_uid TEXT, -- uid do pedido original para referência
  order_status TEXT, -- status do pedido para controle de prioridade
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  details_synced_at TIMESTAMPTZ DEFAULT now(), -- Quando os detalhes foram sincronizados
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(connection_id, external_id)
);

-- Enable RLS
ALTER TABLE public.eskolare_order_details ENABLE ROW LEVEL SECURITY;

-- Create policy for managing order details
CREATE POLICY "Anyone can manage eskolare order details"
ON public.eskolare_order_details
FOR ALL
USING (true)
WITH CHECK (true);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_eskolare_order_details_updated_at
BEFORE UPDATE ON public.eskolare_order_details
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for faster queries by status and sync time
CREATE INDEX idx_eskolare_order_details_status ON public.eskolare_order_details(order_status);
CREATE INDEX idx_eskolare_order_details_synced_at ON public.eskolare_order_details(details_synced_at);
CREATE INDEX idx_eskolare_order_details_connection ON public.eskolare_order_details(connection_id);