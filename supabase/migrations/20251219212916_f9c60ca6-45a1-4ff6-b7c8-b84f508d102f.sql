-- Add unique constraints on (connection_id, external_id) for all eskolare_* tables to enable efficient upserts

-- eskolare_cancellations
CREATE UNIQUE INDEX IF NOT EXISTS idx_eskolare_cancellations_connection_external 
ON public.eskolare_cancellations (connection_id, external_id);

-- eskolare_categories
CREATE UNIQUE INDEX IF NOT EXISTS idx_eskolare_categories_connection_external 
ON public.eskolare_categories (connection_id, external_id);

-- eskolare_grades
CREATE UNIQUE INDEX IF NOT EXISTS idx_eskolare_grades_connection_external 
ON public.eskolare_grades (connection_id, external_id);

-- eskolare_orders
CREATE UNIQUE INDEX IF NOT EXISTS idx_eskolare_orders_connection_external 
ON public.eskolare_orders (connection_id, external_id);

-- eskolare_partnerships
CREATE UNIQUE INDEX IF NOT EXISTS idx_eskolare_partnerships_connection_external 
ON public.eskolare_partnerships (connection_id, external_id);

-- eskolare_payments
CREATE UNIQUE INDEX IF NOT EXISTS idx_eskolare_payments_connection_external 
ON public.eskolare_payments (connection_id, external_id);

-- eskolare_showcases
CREATE UNIQUE INDEX IF NOT EXISTS idx_eskolare_showcases_connection_external 
ON public.eskolare_showcases (connection_id, external_id);

-- eskolare_transactions
CREATE UNIQUE INDEX IF NOT EXISTS idx_eskolare_transactions_connection_external 
ON public.eskolare_transactions (connection_id, external_id);

-- eskolare_withdrawals
CREATE UNIQUE INDEX IF NOT EXISTS idx_eskolare_withdrawals_connection_external 
ON public.eskolare_withdrawals (connection_id, external_id);