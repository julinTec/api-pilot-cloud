export type AppRole = 'admin' | 'user';

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserRole {
  id: string;
  user_id: string;
  role: AppRole;
}

export interface UserConnectionAccess {
  id: string;
  user_id: string;
  connection_id: string;
  can_view: boolean;
  can_sync: boolean;
  can_manage: boolean;
  created_at: string;
}

export interface FileSource {
  id: string;
  name: string;
  description: string | null;
  file_type: string;
  file_path: string;
  file_size_bytes: number | null;
  column_mapping: Record<string, any>;
  metadata: Record<string, any>;
  status: 'pending' | 'processing' | 'ready' | 'error';
  records_count: number;
  last_processed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuthState {
  user: Profile | null;
  role: AppRole | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}
