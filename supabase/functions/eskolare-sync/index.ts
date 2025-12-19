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

// Test connection by calling /orders/?limit=1
async function testConnection(baseUrl: string, token: string): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const url = `${baseUrl}/orders/?limit=1`;
    console.log(`[TEST] Testing connection to: ${url}`);
    console.log(`[TEST] Token format: Bearer ${token.substring(0, 10)}...${token.substring(token.length - 5)}`);
    
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    console.log(`[TEST] Request headers:`, JSON.stringify(headers, null, 2));
    
    const response = await fetch(url, { headers });

    console.log(`[TEST] Response status: ${response.status}`);
    console.log(`[TEST] Response headers:`, JSON.stringify(Object.fromEntries(response.headers.entries()), null, 2));

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[TEST] Connection test failed: ${response.status}`);
      console.error(`[TEST] Error body: ${errorText.substring(0, 500)}`);
      return { success: false, error: `HTTP ${response.status}: ${errorText.substring(0, 200)}` };
    }

    const data = await response.json();
    console.log('[TEST] Connection test successful:', JSON.stringify(data, null, 2));
    return { success: true, data };
  } catch (error: any) {
    console.error('[TEST] Connection test exception:', error);
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

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  // Regular paginated endpoints
  while (hasMore) {
    const url = `${baseUrl}${path}?limit=${limit}&offset=${offset}`;
    console.log(`[FETCH] Paginated URL: ${url}`);
    
    const response = await fetch(url, { headers });
    
    console.log(`[FETCH] Response status for ${path}: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[FETCH] API Error for ${path}: ${response.status}`);
      console.error(`[FETCH] Error body: ${errorText.substring(0, 500)}`);
      throw new Error(`Endpoint ${path} retornou erro ${response.status}: ${errorText.substring(0, 100)}`);
    }

    const data = await response.json();
    console.log(`[FETCH] Response for ${path}: count=${data.count}, keys=${Object.keys(data)}`);
    
    const results = data[responseDataPath] || data.results || data.data || [];
    
    if (!Array.isArray(results)) {
      console.log(`[FETCH] Response is not an array, treating as single item`);
      allData.push(results);
      hasMore = false;
    } else if (results.length === 0) {
      console.log(`[FETCH] No more results for ${path}`);
      hasMore = false;
    } else {
      allData.push(...results);
      offset += limit;
      console.log(`[FETCH] Fetched ${results.length} records, total: ${allData.length}`);
      
      if (results.length < limit || (data.count && allData.length >= data.count)) {
        hasMore = false;
      }
    }
  }

  console.log(`[FETCH] Total fetched for ${path}: ${allData.length} records`);
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

  // Regular list-based endpoints
  for (const record of records) {
    // Try multiple ID fields that might be present
    const externalId = record.id?.toString() || 
                       record.uuid?.toString() || 
                       record.order_id?.toString() || 
                       record.code?.toString() ||
                       record.slug?.toString() ||
                       JSON.stringify(record).substring(0, 50);
    
    try {
      // Check if record exists
      const { data: existing } = await supabase
        .from(tableName)
        .select('id')
        .eq('connection_id', connectionId)
        .eq('external_id', externalId)
        .maybeSingle();

      if (existing) {
        // Update existing record
        const { error: updateError } = await supabase
          .from(tableName)
          .update({ data: record, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
        
        if (updateError) {
          console.error(`Error updating record ${externalId}:`, updateError);
        } else {
          updated++;
        }
      } else {
        // Insert new record
        const { error: insertError } = await supabase
          .from(tableName)
          .insert({
            connection_id: connectionId,
            external_id: externalId,
            data: record,
          });
        
        if (insertError) {
          console.error(`Error inserting record ${externalId}:`, insertError);
        } else {
          created++;
        }
      }
    } catch (recordError: any) {
      console.error(`Error processing record ${externalId}:`, recordError);
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
