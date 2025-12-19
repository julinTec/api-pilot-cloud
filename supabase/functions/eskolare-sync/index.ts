import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_EXECUTION_TIME_MS = 50000; // 50 seconds (leave 10s buffer)
const BATCH_SIZE = 50;

interface EskolareConfig {
  connectionId: string;
  endpoint?: string;
  testOnly?: boolean;
}

function getExternalId(record: any): string {
  return record.id?.toString() || 
         record.uuid?.toString() || 
         record.order_id?.toString() || 
         record.code?.toString() ||
         record.slug?.toString() ||
         JSON.stringify(record).substring(0, 50);
}

// Test connection by calling /orders/?limit=1
async function testConnection(baseUrl: string, token: string): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const url = `${baseUrl}/orders/?limit=1`;
    console.log(`[TEST] Testing connection to: ${url}`);
    
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    
    const response = await fetch(url, { headers });

    console.log(`[TEST] Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[TEST] Connection test failed: ${response.status}`);
      return { success: false, error: `HTTP ${response.status}: ${errorText.substring(0, 200)}` };
    }

    const data = await response.json();
    console.log('[TEST] Connection test successful');
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

  while (hasMore) {
    const url = `${baseUrl}${path}?limit=${limit}&offset=${offset}`;
    console.log(`[FETCH] Paginated URL: ${url}`);
    
    const response = await fetch(url, { headers });
    
    console.log(`[FETCH] Response status for ${path}: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[FETCH] API Error for ${path}: ${response.status}`);
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
  responseDataPath: string,
  startTime: number
): Promise<{ processed: number; created: number; updated: number; timedOut: boolean }> {
  const tableName = `eskolare_${endpointSlug}`;
  console.log(`[SYNC] Syncing endpoint: ${endpointSlug} to table: ${tableName}`);
  
  const { data: records } = await fetchWithPagination(baseUrl, path, token, responseDataPath);
  
  let processed = 0;
  let created = 0;
  let updated = 0;
  let timedOut = false;

  // Process in batches using upsert
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    // Check timeout before processing batch
    const elapsed = Date.now() - startTime;
    if (elapsed > MAX_EXECUTION_TIME_MS) {
      console.log(`[SYNC] Timeout approaching after ${elapsed}ms, processed ${processed}/${records.length} records`);
      timedOut = true;
      break;
    }

    const batch = records.slice(i, i + BATCH_SIZE);
    const batchData = batch.map(record => ({
      connection_id: connectionId,
      external_id: getExternalId(record),
      data: record,
      updated_at: new Date().toISOString(),
    }));

    try {
      // First, get existing records to determine created vs updated counts
      const externalIds = batchData.map(r => r.external_id);
      const { data: existingRecords } = await supabase
        .from(tableName)
        .select('external_id')
        .eq('connection_id', connectionId)
        .in('external_id', externalIds);
      
      const existingIds = new Set((existingRecords || []).map((r: any) => r.external_id));
      const newCount = batchData.filter(r => !existingIds.has(r.external_id)).length;
      const updateCount = batchData.length - newCount;

      // Perform upsert using the unique index
      const { error: upsertError } = await supabase
        .from(tableName)
        .upsert(batchData, { 
          onConflict: 'connection_id,external_id',
          ignoreDuplicates: false 
        });

      if (upsertError) {
        console.error(`[SYNC] Error upserting batch at offset ${i}:`, upsertError);
      } else {
        created += newCount;
        updated += updateCount;
        processed += batch.length;
        console.log(`[SYNC] Batch ${i / BATCH_SIZE + 1}: upserted ${batch.length} records (${newCount} new, ${updateCount} updated)`);
      }
    } catch (batchError: any) {
      console.error(`[SYNC] Error processing batch at offset ${i}:`, batchError);
    }
  }

  console.log(`[SYNC] Sync complete for ${endpointSlug}: processed=${processed}/${records.length}, created=${created}, updated=${updated}, timedOut=${timedOut}`);
  return { processed, created, updated, timedOut };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  let supabase: any;
  let logEntry: any = null;
  let currentEndpoint: string = '';
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    supabase = createClient(supabaseUrl, supabaseKey);

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

    // Test-only mode
    if (testOnly) {
      const testResult = await testConnection(baseUrl, token);
      
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
    let hadTimeout = false;

    for (const ep of endpoints) {
      // Check global timeout
      const elapsed = Date.now() - startTime;
      if (elapsed > MAX_EXECUTION_TIME_MS) {
        console.log(`[MAIN] Global timeout after ${elapsed}ms, stopping before ${ep.slug}`);
        hadTimeout = true;
        break;
      }

      currentEndpoint = ep.slug;
      console.log(`Starting sync for endpoint: ${ep.slug} (${ep.path})`);
      
      // Create log entry
      const { data: newLogEntry } = await supabase
        .from('extraction_logs')
        .insert({
          connection_id: connectionId,
          endpoint_id: ep.id,
          status: 'running',
        })
        .select()
        .single();
      
      logEntry = newLogEntry;

      try {
        const result = await syncEndpoint(
          supabase,
          connectionId,
          ep.slug,
          baseUrl,
          token,
          ep.path,
          ep.response_data_path || 'results',
          startTime
        );

        results[ep.slug] = result;
        totalProcessed += result.processed;
        totalCreated += result.created;
        totalUpdated += result.updated;

        if (result.timedOut) {
          hadTimeout = true;
        }

        // Update log entry
        await supabase
          .from('extraction_logs')
          .update({
            status: result.timedOut ? 'error' : 'success',
            records_processed: result.processed,
            records_created: result.created,
            records_updated: result.updated,
            duration_ms: Date.now() - startTime,
            finished_at: new Date().toISOString(),
            error_message: result.timedOut ? 'Timeout - processamento parcial' : null,
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

        if (result.timedOut) {
          break;
        }

      } catch (epError: any) {
        console.error(`Error syncing ${ep.slug}:`, epError);
        results[ep.slug] = { error: epError.message };

        if (logEntry) {
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
    }

    console.log(`Sync complete. Total: processed=${totalProcessed}, created=${totalCreated}, updated=${totalUpdated}, hadTimeout=${hadTimeout}`);

    return new Response(
      JSON.stringify({
        success: !hadTimeout,
        duration_ms: Date.now() - startTime,
        total: { processed: totalProcessed, created: totalCreated, updated: totalUpdated },
        endpoints: results,
        hadTimeout,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Sync error:', error);
    
    // Ensure log entry is updated on error
    if (supabase && logEntry) {
      try {
        await supabase
          .from('extraction_logs')
          .update({
            status: 'error',
            error_message: error.message,
            duration_ms: Date.now() - startTime,
            finished_at: new Date().toISOString(),
          })
          .eq('id', logEntry.id);
      } catch (logError) {
        console.error('Error updating log entry:', logError);
      }
    }
    
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
