import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EskolareConfig {
  connectionId: string;
  endpoint?: string;
}

async function fetchWithPagination(
  baseUrl: string,
  path: string,
  token: string,
  dataPath: string = 'results'
): Promise<any[]> {
  const allData: any[] = [];
  let offset = 0;
  const limit = 100;
  let hasMore = true;

  while (hasMore) {
    const url = `${baseUrl}${path}?limit=${limit}&offset=${offset}`;
    console.log(`Fetching: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const results = data[dataPath] || data.data || [];
    
    if (results.length === 0) {
      hasMore = false;
    } else {
      allData.push(...results);
      offset += limit;
      
      // Check if we've reached the end
      if (results.length < limit || (data.count && allData.length >= data.count)) {
        hasMore = false;
      }
    }
  }

  return allData;
}

async function syncEndpoint(
  supabase: any,
  connectionId: string,
  endpointSlug: string,
  baseUrl: string,
  token: string,
  path: string
): Promise<{ processed: number; created: number; updated: number }> {
  const tableName = `eskolare_${endpointSlug}`;
  const data = await fetchWithPagination(baseUrl, path, token);
  
  let created = 0;
  let updated = 0;

  for (const record of data) {
    const externalId = record.id?.toString() || record.uuid || JSON.stringify(record).substring(0, 50);
    
    // Check if record exists
    const { data: existing } = await supabase
      .from(tableName)
      .select('id')
      .eq('connection_id', connectionId)
      .eq('external_id', externalId)
      .single();

    if (existing) {
      // Update existing record
      await supabase
        .from(tableName)
        .update({ data: record, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      updated++;
    } else {
      // Insert new record
      await supabase
        .from(tableName)
        .insert({
          connection_id: connectionId,
          external_id: externalId,
          data: record,
        });
      created++;
    }
  }

  return { processed: data.length, created, updated };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { connectionId, endpoint } = await req.json() as EskolareConfig;

    if (!connectionId) {
      throw new Error('connectionId is required');
    }

    // Get connection details
    const { data: connection, error: connError } = await supabase
      .from('api_connections')
      .select('*, api_providers(*)')
      .eq('id', connectionId)
      .single();

    if (connError || !connection) {
      throw new Error(`Connection not found: ${connError?.message}`);
    }

    const token = connection.credentials?.token;
    if (!token) {
      throw new Error('No token found in connection credentials');
    }

    const baseUrl = connection.environment === 'development' 
      ? connection.api_providers.base_url_dev 
      : connection.api_providers.base_url;

    // Get endpoints to sync
    const endpointsQuery = supabase
      .from('api_endpoints')
      .select('*')
      .eq('provider_id', connection.provider_id)
      .eq('is_active', true);

    if (endpoint) {
      endpointsQuery.eq('slug', endpoint);
    }

    const { data: endpoints, error: endpointsError } = await endpointsQuery;

    if (endpointsError || !endpoints?.length) {
      throw new Error(`No endpoints found: ${endpointsError?.message}`);
    }

    const results: Record<string, any> = {};
    let totalProcessed = 0;
    let totalCreated = 0;
    let totalUpdated = 0;

    for (const ep of endpoints) {
      // Create log entry
      const { data: logEntry } = await supabase
        .from('extraction_logs')
        .insert({
          connection_id: connectionId,
          endpoint_id: ep.id,
          status: 'running',
        })
        .select()
        .single();

      try {
        const result = await syncEndpoint(
          supabase,
          connectionId,
          ep.slug,
          baseUrl,
          token,
          ep.path
        );

        results[ep.slug] = result;
        totalProcessed += result.processed;
        totalCreated += result.created;
        totalUpdated += result.updated;

        // Update log entry with success
        await supabase
          .from('extraction_logs')
          .update({
            status: 'success',
            records_processed: result.processed,
            records_created: result.created,
            records_updated: result.updated,
            duration_ms: Date.now() - startTime,
            finished_at: new Date().toISOString(),
          })
          .eq('id', logEntry.id);

        // Update extraction config
        await supabase
          .from('extraction_configs')
          .update({
            last_sync_at: new Date().toISOString(),
            next_sync_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          })
          .eq('connection_id', connectionId)
          .eq('endpoint_id', ep.id);

      } catch (epError: any) {
        console.error(`Error syncing ${ep.slug}:`, epError);
        results[ep.slug] = { error: epError.message };

        // Update log entry with error
        await supabase
          .from('extraction_logs')
          .update({
            status: 'error',
            error_message: epError.message,
            duration_ms: Date.now() - startTime,
            finished_at: new Date().toISOString(),
          })
          .eq('id', logEntry.id);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        duration_ms: Date.now() - startTime,
        total: { processed: totalProcessed, created: totalCreated, updated: totalUpdated },
        endpoints: results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Sync error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
