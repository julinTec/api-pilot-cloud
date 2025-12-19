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
  testOnly?: boolean;
}

// Test connection by calling /whoami/
async function testConnection(baseUrl: string, token: string): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const url = `${baseUrl}/whoami/`;
    console.log(`Testing connection: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Connection test failed: ${response.status} - ${errorText}`);
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const data = await response.json();
    console.log('Connection test successful:', data);
    return { success: true, data };
  } catch (error: any) {
    console.error('Connection test error:', error);
    return { success: false, error: error.message };
  }
}

async function fetchWithPagination(
  baseUrl: string,
  path: string,
  token: string,
  responseDataPath: string = 'results'
): Promise<{ data: any[]; isList: boolean }> {
  const allData: any[] = [];
  let offset = 0;
  const limit = 100;
  let hasMore = true;

  // Dashboard endpoint returns a single object, not a list
  if (path.includes('dashboard')) {
    const url = `${baseUrl}${path}`;
    console.log(`Fetching dashboard: ${url}`);
    
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
    console.log(`Dashboard response keys:`, Object.keys(data));
    
    // Dashboard returns an object with 'data' containing the summary
    const dashboardData = data.data || data;
    return { data: [dashboardData], isList: false };
  }

  // Regular paginated endpoints
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
      console.error(`API Error for ${path}: ${response.status} - ${errorText}`);
      throw new Error(`API Error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    console.log(`Response for ${path}: count=${data.count}, keys=${Object.keys(data)}`);
    
    // Try to get results from the specified path or common alternatives
    const results = data[responseDataPath] || data.results || data.data || [];
    
    if (!Array.isArray(results)) {
      console.log(`Response is not an array, treating as single item`);
      allData.push(results);
      hasMore = false;
    } else if (results.length === 0) {
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

  console.log(`Total fetched for ${path}: ${allData.length} records`);
  return { data: allData, isList: true };
}

async function syncEndpoint(
  supabase: any,
  connectionId: string,
  endpointSlug: string,
  baseUrl: string,
  token: string,
  path: string,
  responseDataPath: string
): Promise<{ processed: number; created: number; updated: number }> {
  const tableName = `eskolare_${endpointSlug}`;
  console.log(`Syncing endpoint: ${endpointSlug} to table: ${tableName}`);
  
  const { data: records, isList } = await fetchWithPagination(baseUrl, path, token, responseDataPath);
  
  let created = 0;
  let updated = 0;

  // Special handling for summaries (dashboard) - not a list
  if (!isList && endpointSlug === 'summaries') {
    const record = records[0];
    const reportType = 'dashboard';
    
    // Check if summary exists
    const { data: existing } = await supabase
      .from('eskolare_summaries')
      .select('id')
      .eq('connection_id', connectionId)
      .eq('report_type', reportType)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('eskolare_summaries')
        .update({ data: record, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      updated++;
    } else {
      await supabase
        .from('eskolare_summaries')
        .insert({
          connection_id: connectionId,
          report_type: reportType,
          data: record,
        });
      created++;
    }
    
    return { processed: 1, created, updated };
  }

  // Regular list-based endpoints
  for (const record of records) {
    const externalId = record.id?.toString() || record.uuid || record.order_id?.toString() || JSON.stringify(record).substring(0, 50);
    
    // Check if record exists
    const { data: existing } = await supabase
      .from(tableName)
      .select('id')
      .eq('connection_id', connectionId)
      .eq('external_id', externalId)
      .maybeSingle();

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

  console.log(`Sync complete for ${endpointSlug}: processed=${records.length}, created=${created}, updated=${updated}`);
  return { processed: records.length, created, updated };
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

    const { connectionId, endpoint, testOnly } = await req.json() as EskolareConfig;

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

    console.log(`Using base URL: ${baseUrl}, environment: ${connection.environment}`);

    // Test-only mode - just verify the connection
    if (testOnly) {
      const testResult = await testConnection(baseUrl, token);
      
      // Update connection with test result
      await supabase
        .from('api_connections')
        .update({
          last_test_at: new Date().toISOString(),
          last_test_success: testResult.success,
        })
        .eq('id', connectionId);

      return new Response(
        JSON.stringify({
          success: testResult.success,
          testResult,
          duration_ms: Date.now() - startTime,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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

    console.log(`Found ${endpoints.length} endpoints to sync`);

    const results: Record<string, any> = {};
    let totalProcessed = 0;
    let totalCreated = 0;
    let totalUpdated = 0;

    for (const ep of endpoints) {
      console.log(`Starting sync for endpoint: ${ep.slug} (${ep.path})`);
      
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
          ep.path,
          ep.response_data_path || 'results'
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

    console.log(`Sync complete. Total: processed=${totalProcessed}, created=${totalCreated}, updated=${totalUpdated}`);

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
