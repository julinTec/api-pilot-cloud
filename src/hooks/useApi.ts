import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ApiProvider, ApiConnection, ApiEndpoint, ExtractionConfig, ExtractionLog } from '@/types/api';

export function useProviders() {
  return useQuery({
    queryKey: ['providers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('api_providers')
        .select('*')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data as ApiProvider[];
    },
  });
}

export function useConnections() {
  return useQuery({
    queryKey: ['connections'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('api_connections')
        .select('*, api_providers(*)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as ApiConnection[];
    },
  });
}

export function useCreateConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (connection: { provider_id: string; name: string; credentials: Record<string, any>; environment: string }) => {
      const { data, error } = await supabase
        .from('api_connections')
        .insert([connection])
        .select('*, api_providers(*)')
        .single();
      if (error) throw error;
      return data as ApiConnection;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
  });
}

export function useEndpoints(providerId?: string) {
  return useQuery({
    queryKey: ['endpoints', providerId],
    queryFn: async () => {
      let query = supabase.from('api_endpoints').select('*').eq('is_active', true).order('name');
      if (providerId) query = query.eq('provider_id', providerId);
      const { data, error } = await query;
      if (error) throw error;
      return data as ApiEndpoint[];
    },
  });
}

export function useExtractionLogs(connectionId?: string, limit = 50) {
  return useQuery({
    queryKey: ['extraction-logs', connectionId, limit],
    queryFn: async () => {
      let query = supabase
        .from('extraction_logs')
        .select('*, api_endpoints(*)')
        .order('started_at', { ascending: false })
        .limit(limit);
      if (connectionId) query = query.eq('connection_id', connectionId);
      const { data, error } = await query;
      if (error) throw error;
      return data as ExtractionLog[];
    },
  });
}

export function useSyncConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ connectionId, endpoint }: { connectionId: string; endpoint?: string }) => {
      const { data, error } = await supabase.functions.invoke('eskolare-sync', {
        body: { connectionId, endpoint },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['extraction-logs'] });
      queryClient.invalidateQueries({ queryKey: ['table-data'] });
      queryClient.invalidateQueries({ queryKey: ['table-counts'] });
    },
  });
}

export function useTestConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (connectionId: string) => {
      const { data, error } = await supabase.functions.invoke('eskolare-sync', {
        body: { connectionId, testOnly: true },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
  });
}
