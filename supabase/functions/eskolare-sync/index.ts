import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_EXECUTION_TIME_MS = 55000; // 55 seconds (leave 5s buffer for cleanup)
const BATCH_SIZE = 100; // Larger batches for efficiency
const PAGE_SIZE = 500;

// Order details specific constants
const ORDER_DETAILS_PARALLEL_REQUESTS = 10; // 10 parallel requests
const ORDER_DETAILS_BATCH_SIZE = 200; // 200 orders per execution

// Status priority configuration
const STATUS_PRIORITY = {
  // High priority - sync every 15 minutes (active orders)
  high: ['order-created', 'payment-pending', 'payment-approved'],
  // Medium priority - sync once a day (finalized but might have updates)
  medium: ['invoiced'],
  // Low priority - sync only once (final states)
  low: ['canceled', 'payment-denied', 'returned'],
};

// Max age in minutes for each priority level
const PRIORITY_MAX_AGE_MINUTES = {
  high: 15,      // Re-sync every 15 minutes
  medium: 1440,  // Re-sync once a day (24 hours)
  low: null,     // Never re-sync (only sync once)
};

interface EskolareConfig {
  connectionId: string;
  endpoint?: string;
  testOnly?: boolean;
  continueFromOffset?: boolean; // Continue from last saved offset
}

function getExternalId(record: any): string {
  // Try multiple possible ID fields in order of preference
  return record.uid?.toString() || 
         record.id?.toString() || 
         record.uuid?.toString() || 
         record.order_id?.toString() || 
         record.code?.toString() ||
         record.slug?.toString() ||
         // Only use JSON fallback if no ID field found, and use a hash-like approach
         `hash_${JSON.stringify(record).length}_${JSON.stringify(record).substring(0, 100)}`;
}

// Remove duplicate records from a batch based on external_id
function removeDuplicatesFromBatch(records: any[]): any[] {
  const seen = new Map<string, any>();
  for (const record of records) {
    const externalId = getExternalId(record);
    // Keep the last occurrence (most recent data)
    seen.set(externalId, record);
  }
  return Array.from(seen.values());
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

// Process and upsert a batch of records with duplicate handling
async function processBatch(
  supabase: any,
  tableName: string,
  connectionId: string,
  records: any[]
): Promise<{ created: number; updated: number }> {
  // Remove duplicates from the batch first
  const uniqueRecords = removeDuplicatesFromBatch(records);
  
  const batchData = uniqueRecords.map(record => ({
    connection_id: connectionId,
    external_id: getExternalId(record),
    data: record,
    updated_at: new Date().toISOString(),
  }));

  // Get existing records to determine created vs updated counts
  const externalIds = batchData.map(r => r.external_id);
  const { data: existingRecords } = await supabase
    .from(tableName)
    .select('external_id')
    .eq('connection_id', connectionId)
    .in('external_id', externalIds);
  
  const existingIds = new Set((existingRecords || []).map((r: any) => r.external_id));
  const created = batchData.filter(r => !existingIds.has(r.external_id)).length;
  const updated = batchData.length - created;

  // Perform upsert using the unique index
  const { error: upsertError } = await supabase
    .from(tableName)
    .upsert(batchData, { 
      onConflict: 'connection_id,external_id',
      ignoreDuplicates: false 
    });

  if (upsertError) {
    throw upsertError;
  }

  return { created, updated };
}

// Get extraction config with progress info
async function getExtractionConfig(
  supabase: any,
  connectionId: string,
  endpointId: string
): Promise<{ lastOffset: number; isComplete: boolean; totalRecords: number } | null> {
  const { data, error } = await supabase
    .from('extraction_configs')
    .select('last_offset, is_complete, total_records')
    .eq('connection_id', connectionId)
    .eq('endpoint_id', endpointId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return {
    lastOffset: data.last_offset || 0,
    isComplete: data.is_complete ?? true,
    totalRecords: data.total_records || 0,
  };
}

// Update extraction config progress
async function updateExtractionProgress(
  supabase: any,
  connectionId: string,
  endpointId: string,
  offset: number,
  isComplete: boolean,
  totalRecords: number
): Promise<void> {
  // First try to update
  const { data: updated, error: updateError } = await supabase
    .from('extraction_configs')
    .update({
      last_offset: offset,
      is_complete: isComplete,
      total_records: totalRecords,
      last_sync_at: new Date().toISOString(),
      next_sync_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(), // 15 minutes for order-details
      updated_at: new Date().toISOString(),
    })
    .eq('connection_id', connectionId)
    .eq('endpoint_id', endpointId)
    .select();

  // If no rows updated, insert a new config
  if (!updated || updated.length === 0) {
    await supabase
      .from('extraction_configs')
      .insert({
        connection_id: connectionId,
        endpoint_id: endpointId,
        last_offset: offset,
        is_complete: isComplete,
        total_records: totalRecords,
        last_sync_at: new Date().toISOString(),
        next_sync_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      });
  }
}

// Get orders that need their details synced, prioritized by status
async function getOrdersNeedingDetails(
  supabase: any,
  connectionId: string,
  limit: number
): Promise<{ orderNumber: string; orderUid: string; status: string; priority: string }[]> {
  const ordersToSync: { orderNumber: string; orderUid: string; status: string; priority: string }[] = [];
  
  // Helper function to get orders by priority
  async function getOrdersByPriority(
    priority: string,
    statuses: string[],
    maxAgeMinutes: number | null
  ): Promise<void> {
    const remainingSlots = limit - ordersToSync.length;
    if (remainingSlots <= 0) return;

    // Get all orders with these statuses
    const { data: orders, error: ordersError } = await supabase
      .from('eskolare_orders')
      .select('external_id, data')
      .eq('connection_id', connectionId);

    if (ordersError || !orders) {
      console.error(`[PRIORITY] Error fetching orders:`, ordersError);
      return;
    }

    // Filter orders by status
    const filteredOrders = orders.filter((order: any) => {
      const orderStatus = order.data?.status || order.data?.order_status;
      return statuses.includes(orderStatus);
    });

    if (filteredOrders.length === 0) return;

    // Get order numbers
    const orderNumbers = filteredOrders.map((o: any) => o.data?.order_number?.toString() || o.external_id);

    // Get existing order details
    const { data: existingDetails } = await supabase
      .from('eskolare_order_details')
      .select('external_id, details_synced_at')
      .eq('connection_id', connectionId)
      .in('external_id', orderNumbers);

    const existingDetailsMap = new Map(
      (existingDetails || []).map((d: any) => [d.external_id, d.details_synced_at])
    );

    const now = new Date();
    const cutoffTime = maxAgeMinutes !== null 
      ? new Date(now.getTime() - maxAgeMinutes * 60 * 1000)
      : null;

    // Filter orders that need sync
    for (const order of filteredOrders) {
      if (ordersToSync.length >= limit) break;

      const orderNumber = order.data?.order_number?.toString() || order.external_id;
      const orderUid = order.data?.uid?.toString() || order.external_id;
      const orderStatus = order.data?.status || order.data?.order_status || 'unknown';
      const existingSyncTime = existingDetailsMap.get(orderNumber);

      let needsSync = false;
      if (!existingSyncTime) {
        // Never synced
        needsSync = true;
      } else if (maxAgeMinutes !== null && cutoffTime && typeof existingSyncTime === 'string') {
        // Check if sync is stale
        const syncTime = new Date(existingSyncTime);
        needsSync = syncTime < cutoffTime;
      }
      // For low priority (maxAgeMinutes === null), don't re-sync if already exists

      if (needsSync) {
        ordersToSync.push({
          orderNumber,
          orderUid,
          status: orderStatus,
          priority,
        });
      }
    }

    console.log(`[PRIORITY] ${priority}: Found ${ordersToSync.length} orders needing sync (from ${filteredOrders.length} with matching status)`);
  }

  // Process priorities in order
  await getOrdersByPriority('high', STATUS_PRIORITY.high, PRIORITY_MAX_AGE_MINUTES.high);
  await getOrdersByPriority('medium', STATUS_PRIORITY.medium, PRIORITY_MAX_AGE_MINUTES.medium);
  await getOrdersByPriority('low', STATUS_PRIORITY.low, PRIORITY_MAX_AGE_MINUTES.low);

  console.log(`[PRIORITY] Total orders to sync: ${ordersToSync.length} (high priority first)`);
  return ordersToSync;
}

// Fetch order details from API
async function fetchOrderDetails(
  baseUrl: string,
  token: string,
  orderNumber: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const url = `${baseUrl}/orders/${orderNumber}/`;
    
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    
    const response = await fetch(url, { headers });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `HTTP ${response.status}: ${errorText.substring(0, 100)}` };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// Process order details in parallel
async function processOrderDetailsParallel(
  supabase: any,
  connectionId: string,
  baseUrl: string,
  token: string,
  orders: { orderNumber: string; orderUid: string; status: string; priority: string }[],
  startTime: number
): Promise<{ processed: number; created: number; updated: number; errors: number; timedOut: boolean }> {
  let processed = 0;
  let created = 0;
  let updated = 0;
  let errors = 0;
  let timedOut = false;

  // Process in chunks of PARALLEL_REQUESTS
  for (let i = 0; i < orders.length; i += ORDER_DETAILS_PARALLEL_REQUESTS) {
    // Check timeout
    const elapsed = Date.now() - startTime;
    if (elapsed > MAX_EXECUTION_TIME_MS) {
      console.log(`[ORDER-DETAILS] Timeout at ${processed} orders processed`);
      timedOut = true;
      break;
    }

    const chunk = orders.slice(i, i + ORDER_DETAILS_PARALLEL_REQUESTS);
    console.log(`[ORDER-DETAILS] Processing chunk ${Math.floor(i / ORDER_DETAILS_PARALLEL_REQUESTS) + 1}: ${chunk.length} orders in parallel`);

    // Fetch all order details in parallel
    const fetchPromises = chunk.map(order => 
      fetchOrderDetails(baseUrl, token, order.orderNumber)
        .then(result => ({ ...result, order }))
    );

    const results = await Promise.all(fetchPromises);

    // Prepare batch for upsert
    const successfulResults = results.filter(r => r.success && r.data);
    const failedResults = results.filter(r => !r.success);

    if (failedResults.length > 0) {
      console.log(`[ORDER-DETAILS] ${failedResults.length} failed in this chunk`);
      errors += failedResults.length;
    }

    if (successfulResults.length > 0) {
      // Get existing records to count created vs updated
      const orderNumbers = successfulResults.map(r => r.order.orderNumber);
      const { data: existingDetails } = await supabase
        .from('eskolare_order_details')
        .select('external_id')
        .eq('connection_id', connectionId)
        .in('external_id', orderNumbers);

      const existingIds = new Set((existingDetails || []).map((d: any) => d.external_id));

      // Prepare upsert data
      const upsertData = successfulResults.map(r => ({
        connection_id: connectionId,
        external_id: r.order.orderNumber,
        order_uid: r.order.orderUid,
        order_status: r.order.status,
        data: r.data,
        details_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      // Count created vs updated
      const newCreated = upsertData.filter(d => !existingIds.has(d.external_id)).length;
      const newUpdated = upsertData.length - newCreated;

      // Upsert batch
      const { error: upsertError } = await supabase
        .from('eskolare_order_details')
        .upsert(upsertData, {
          onConflict: 'connection_id,external_id',
          ignoreDuplicates: false,
        });

      if (upsertError) {
        console.error(`[ORDER-DETAILS] Upsert error:`, upsertError.message);
        errors += upsertData.length;
      } else {
        created += newCreated;
        updated += newUpdated;
        processed += successfulResults.length;
      }
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  return { processed, created, updated, errors, timedOut };
}

// Sync order details endpoint (special handling)
async function syncOrderDetails(
  supabase: any,
  connectionId: string,
  endpointId: string,
  baseUrl: string,
  token: string,
  startTime: number,
  logEntryId: string
): Promise<{ processed: number; created: number; updated: number; timedOut: boolean; totalRecords: number; finalOffset: number; isComplete: boolean }> {
  console.log(`[ORDER-DETAILS] Starting intelligent sync for order details`);

  // Get orders that need their details synced (prioritized by status)
  const ordersToSync = await getOrdersNeedingDetails(supabase, connectionId, ORDER_DETAILS_BATCH_SIZE);

  if (ordersToSync.length === 0) {
    console.log(`[ORDER-DETAILS] No orders need sync at this time`);
    return {
      processed: 0,
      created: 0,
      updated: 0,
      timedOut: false,
      totalRecords: 0,
      finalOffset: 0,
      isComplete: true,
    };
  }

  // Log priority distribution
  const highPriority = ordersToSync.filter(o => o.priority === 'high').length;
  const mediumPriority = ordersToSync.filter(o => o.priority === 'medium').length;
  const lowPriority = ordersToSync.filter(o => o.priority === 'low').length;
  console.log(`[ORDER-DETAILS] Priority distribution: high=${highPriority}, medium=${mediumPriority}, low=${lowPriority}`);

  // Process orders in parallel
  const result = await processOrderDetailsParallel(
    supabase,
    connectionId,
    baseUrl,
    token,
    ordersToSync,
    startTime
  );

  // Update progress in log
  await supabase
    .from('extraction_logs')
    .update({
      records_processed: result.processed,
      records_created: result.created,
      records_updated: result.updated,
      duration_ms: Date.now() - startTime,
      error_message: result.errors > 0 
        ? `${result.errors} errors during sync` 
        : null,
    })
    .eq('id', logEntryId);

  // Determine if complete (all orders that needed sync were processed)
  const isComplete = !result.timedOut && result.processed >= ordersToSync.length;

  // Update extraction config
  await updateExtractionProgress(
    supabase,
    connectionId,
    endpointId,
    result.processed,
    isComplete,
    ordersToSync.length
  );

  console.log(`[ORDER-DETAILS] Complete: processed=${result.processed}, created=${result.created}, updated=${result.updated}, errors=${result.errors}, timedOut=${result.timedOut}`);

  return {
    processed: result.processed,
    created: result.created,
    updated: result.updated,
    timedOut: result.timedOut,
    totalRecords: ordersToSync.length,
    finalOffset: result.processed,
    isComplete,
  };
}

// Sync endpoint with streaming processing and incremental support
async function syncEndpointStreaming(
  supabase: any,
  connectionId: string,
  endpointId: string,
  endpointSlug: string,
  baseUrl: string,
  token: string,
  path: string,
  responseDataPath: string,
  startTime: number,
  logEntryId: string,
  continueFromOffset: boolean = false
): Promise<{ processed: number; created: number; updated: number; timedOut: boolean; totalRecords: number; finalOffset: number; isComplete: boolean }> {
  const tableName = `eskolare_${endpointSlug}`;
  console.log(`[SYNC] Streaming sync for: ${endpointSlug} to table: ${tableName}`);
  
  // Get last progress if continuing
  let startOffset = 0;
  let previousTotalRecords = 0;
  if (continueFromOffset) {
    const config = await getExtractionConfig(supabase, connectionId, endpointId);
    if (config && !config.isComplete) {
      // Continue from where we left off (use lastOffset as starting point for API)
      startOffset = config.lastOffset;
      previousTotalRecords = config.totalRecords;
      console.log(`[SYNC] Continuing from offset ${startOffset} (was incomplete, total: ${previousTotalRecords})`);
    } else if (config?.isComplete) {
      // If complete, start fresh
      startOffset = 0;
      console.log(`[SYNC] Starting fresh (previous sync was complete)`);
    }
  }
  
  let offset = startOffset;
  let hasMore = true;
  let totalRecords = 0;
  let processed = 0;
  let created = 0;
  let updated = 0;
  let timedOut = false;
  let pendingRecords: any[] = [];

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  while (hasMore && !timedOut) {
    // Check timeout before fetching
    const elapsed = Date.now() - startTime;
    if (elapsed > MAX_EXECUTION_TIME_MS) {
      console.log(`[SYNC] Timeout at offset ${offset}, processed ${processed} records`);
      timedOut = true;
      break;
    }

    // Fetch next page
    const url = `${baseUrl}${path}?limit=${PAGE_SIZE}&offset=${offset}`;
    console.log(`[FETCH] URL: ${url}`);
    
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Endpoint ${path} retornou erro ${response.status}: ${errorText.substring(0, 100)}`);
    }

    const data = await response.json();
    const results = data[responseDataPath] || data.results || data.data || [];
    
    if (!Array.isArray(results)) {
      pendingRecords.push(results);
      hasMore = false;
    } else if (results.length === 0) {
      // API returned empty results - we're done
      console.log(`[FETCH] No more results from API, stopping`);
      hasMore = false;
    } else {
      // Update total from API count (this is the authoritative count)
      if (data.count && data.count > 0) {
        totalRecords = data.count;
      }
      
      // Remove duplicates before adding to pending
      const uniqueResults = removeDuplicatesFromBatch(results);
      pendingRecords.push(...uniqueResults);
      
      console.log(`[FETCH] Got ${results.length} records (${uniqueResults.length} unique after dedup), pending: ${pendingRecords.length}, offset: ${offset}/${totalRecords}`);
      
      // Increment offset AFTER logging
      offset += PAGE_SIZE;
      
      // ONLY stop when we've fetched past the total count from API
      // Do NOT use results.length < PAGE_SIZE as stop condition (API may return duplicates)
      if (totalRecords > 0 && offset >= totalRecords) {
        console.log(`[FETCH] Reached end: offset ${offset} >= total ${totalRecords}`);
        hasMore = false;
      }
    }

    // Process pending records in batches while we have enough
    while (pendingRecords.length >= BATCH_SIZE && !timedOut) {
      const elapsed = Date.now() - startTime;
      if (elapsed > MAX_EXECUTION_TIME_MS) {
        console.log(`[SYNC] Timeout during batch processing at ${processed} records`);
        timedOut = true;
        break;
      }

      const batch = pendingRecords.splice(0, BATCH_SIZE);
      try {
        const result = await processBatch(supabase, tableName, connectionId, batch);
        created += result.created;
        updated += result.updated;
        processed += batch.length;
        console.log(`[SYNC] Processed batch: ${processed} total (${result.created} new, ${result.updated} updated)`);
      } catch (batchError: any) {
        console.error(`[SYNC] Batch error:`, batchError.message);
        // Continue with next batch instead of stopping
      }

      // Update log entry with progress periodically (every 200 records for faster feedback)
      if (processed % 200 === 0) {
        await supabase
          .from('extraction_logs')
          .update({
            records_processed: processed,
            records_created: created,
            records_updated: updated,
            duration_ms: Date.now() - startTime,
            error_message: `Em progresso: ${processed}/${totalRecords || '?'} (offset: ${offset})`,
          })
          .eq('id', logEntryId);
          
        // Save progress more frequently to extraction_configs
        await updateExtractionProgress(supabase, connectionId, endpointId, offset, false, totalRecords);
      }
    }
  }

  // Process remaining records
  while (pendingRecords.length > 0 && !timedOut) {
    const elapsed = Date.now() - startTime;
    if (elapsed > MAX_EXECUTION_TIME_MS) {
      console.log(`[SYNC] Timeout processing remaining records at ${processed}`);
      timedOut = true;
      break;
    }

    const batch = pendingRecords.splice(0, BATCH_SIZE);
    try {
      const result = await processBatch(supabase, tableName, connectionId, batch);
      created += result.created;
      updated += result.updated;
      processed += batch.length;
    } catch (batchError: any) {
      console.error(`[SYNC] Final batch error:`, batchError.message);
    }
  }

  // Only mark complete if we fetched all data AND processed everything
  // If totalRecords > 0, we need offset >= totalRecords to be complete
  const fetchedAll = totalRecords > 0 ? offset >= totalRecords : !hasMore;
  const processedAll = pendingRecords.length === 0;
  const isComplete = !timedOut && fetchedAll && processedAll;
  
  // Save final progress - use the actual offset we reached
  await updateExtractionProgress(supabase, connectionId, endpointId, offset, isComplete, totalRecords);

  console.log(`[SYNC] Complete for ${endpointSlug}: processed=${processed}/${totalRecords}, offset=${offset}, created=${created}, updated=${updated}, timedOut=${timedOut}, fetchedAll=${fetchedAll}, isComplete=${isComplete}`);
  return { processed, created, updated, timedOut, totalRecords, finalOffset: offset, isComplete };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  let supabase: any;
  let logEntry: any = null;
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    supabase = createClient(supabaseUrl, supabaseKey);

    const { connectionId, endpoint, testOnly, continueFromOffset = true } = await req.json() as EskolareConfig;

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

    console.log(`Found ${endpoints.length} endpoint(s) to sync`);

    const results: Record<string, any> = {};
    let totalProcessed = 0;
    let totalCreated = 0;
    let totalUpdated = 0;
    let hadTimeout = false;
    let allComplete = true;

    for (const ep of endpoints) {
      // Check global timeout
      const elapsed = Date.now() - startTime;
      if (elapsed > MAX_EXECUTION_TIME_MS) {
        console.log(`[MAIN] Global timeout after ${elapsed}ms, stopping before ${ep.slug}`);
        hadTimeout = true;
        allComplete = false;
        break;
      }

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
        let result;
        
        // Special handling for order-details endpoint
        if (ep.slug === 'order-details') {
          result = await syncOrderDetails(
            supabase,
            connectionId,
            ep.id,
            baseUrl,
            token,
            startTime,
            logEntry.id
          );
        } else {
          result = await syncEndpointStreaming(
            supabase,
            connectionId,
            ep.id,
            ep.slug,
            baseUrl,
            token,
            ep.path,
            ep.response_data_path || 'results',
            startTime,
            logEntry.id,
            continueFromOffset
          );
        }

        results[ep.slug] = result;
        totalProcessed += result.processed;
        totalCreated += result.created;
        totalUpdated += result.updated;

        if (result.timedOut) {
          hadTimeout = true;
        }
        
        if (!result.isComplete) {
          allComplete = false;
        }

        // Update log entry with final status
        await supabase
          .from('extraction_logs')
          .update({
            status: result.isComplete ? 'success' : 'error',
            records_processed: result.processed,
            records_created: result.created,
            records_updated: result.updated,
            duration_ms: Date.now() - startTime,
            finished_at: new Date().toISOString(),
            error_message: !result.isComplete 
              ? `Incompleto - processado ${result.processed}/${result.totalRecords} (offset: ${result.finalOffset}). Continuará na próxima execução.` 
              : null,
          })
          .eq('id', logEntry.id);

        if (result.timedOut) {
          break;
        }

      } catch (epError: any) {
        console.error(`Error syncing ${ep.slug}:`, epError);
        results[ep.slug] = { error: epError.message };
        allComplete = false;

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

    // Consider success if we processed any records, even if not all complete
    const isSuccess = allComplete || totalProcessed > 0;
    const isPartial = !allComplete && totalProcessed > 0;

    console.log(`Sync complete. Total: processed=${totalProcessed}, created=${totalCreated}, updated=${totalUpdated}, hadTimeout=${hadTimeout}, allComplete=${allComplete}, isPartial=${isPartial}`);

    return new Response(
      JSON.stringify({
        success: isSuccess,
        partial: isPartial,
        message: isPartial 
          ? 'Sincronização parcial. Continuará automaticamente na próxima execução.' 
          : undefined,
        duration_ms: Date.now() - startTime,
        total: { processed: totalProcessed, created: totalCreated, updated: totalUpdated },
        endpoints: results,
        hadTimeout,
        allComplete,
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
