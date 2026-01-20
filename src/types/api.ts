export interface ApiProvider {
  id: string;
  name: string;
  slug: string;
  base_url: string;
  base_url_dev: string | null;
  logo_url: string | null;
  description: string | null;
  auth_type: 'bearer_token' | 'api_key' | 'basic_auth' | 'oauth2';
  is_active: boolean;
  requires_auth: boolean;
  created_at: string;
  updated_at: string;
}

export interface ApiConnection {
  id: string;
  provider_id: string;
  name: string;
  credentials: Record<string, any>;
  environment: 'production' | 'development';
  status: 'active' | 'paused' | 'error';
  last_test_at: string | null;
  last_test_success: boolean | null;
  created_at: string;
  updated_at: string;
  api_providers?: ApiProvider;
}

export interface ApiEndpoint {
  id: string;
  provider_id: string;
  name: string;
  slug: string;
  path: string;
  method: string;
  description: string | null;
  pagination_type: string | null;
  pagination_param: string | null;
  page_size_param: string | null;
  default_page_size: number | null;
  response_data_path: string | null;
  is_active: boolean;
  created_at: string;
}

export interface ExtractionConfig {
  id: string;
  connection_id: string;
  endpoint_id: string;
  is_enabled: boolean;
  sync_frequency_minutes: number;
  last_sync_at: string | null;
  next_sync_at: string | null;
  extra_params: Record<string, any>;
  created_at: string;
  updated_at: string;
  api_endpoints?: ApiEndpoint;
}

export interface ExtractionLog {
  id: string;
  connection_id: string;
  endpoint_id: string | null;
  status: 'pending' | 'running' | 'success' | 'error';
  records_processed: number;
  records_created: number;
  records_updated: number;
  duration_ms: number | null;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
  api_endpoints?: ApiEndpoint;
  api_connections?: ApiConnection;
}
