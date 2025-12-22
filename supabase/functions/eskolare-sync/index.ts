import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Configuration
const MAX_EXECUTION_TIME_MS = 55000; // 55 seconds (leave 5s buffer)
const BATCH_SIZE = 100;
const PAGE_SIZE = 500;

// Order details specific constants
const ORDER_DETAILS_PARALLEL_REQUESTS = 10;
const ORDER_DETAILS_BATCH_SIZE = 200;

// PRIORITY ORDER - Execute endpoints in this exact order
const ENDPOINT_PRIORITY = [
  'orders',        // 1º - Base de tudo
  'showcases',     // 2º - Catálogos
  'payments',      // 3º - Pagamentos
  'partnerships',  // 4º - Parcerias
  'grades',        // 5º - Séries
  'categories',    // 6º - Categorias
  'cancellations', // 7º - Cancelamentos
  'withdrawals',   // 8º - Saques
  'order-details', // 9º - Detalhes (depende de orders)
  'transactions',  // 10º - Maior volume, por último
];

// Status priority for order-details
const STATUS_PRIORITY = {
  high: ['order-created', 'payment-pending', 'payment-approved'],
  medium: ['invoiced'],
  low: ['canceled', 'payment-denied', 'returned'],
};

const PRIORITY_MAX_AGE_MINUTES = {
  high: 15,
  medium: 1440,
  low: null,
};

interface SyncRequest {
  connectionId: string;
  endpoint?: string;      // If specified, sync only this endpoint
  testOnly?: boolean;
  forceReset?: boolean;   // Reset progress and start from zero
}

interface EndpointStatus {
  slug: string;
  name: string;
  priority: number;
  isComplete: boolean;
  lastOffset: number;
  totalRecords: number;
  lastSyncAt: string | null;
  recordsInDb: number;
}

function getExternalId(record: any): string {
  return record.uid?.toString() || 
         record.id?.toString() || 
         record.uuid?.toString() || 
         record.order_id?.toString() || 
         record.code?.toString() ||
         record.slug?.toString() ||
         `hash_${JSON.stringify(record).length}_${JSON.stringify(record).substring(0, 100)}`;
}

function removeDuplicatesFromBatch(records: any[]): any[] {
  const seen = new Map<string, any>();
  for (const record of records) {
    const externalId = getExternalId(record);
    seen.set(externalId, record);
  }
  return Array.from(seen.values());
}

async function testConnection(baseUrl: string, token: string): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const url = `${baseUrl}/orders/?limit=1`;
    console.log(`[TEST] Testing connection to: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
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

// Get status of all endpoints for a connection
async function getEndpointsStatus(
  supabase: any,
  connectionId: string,
  providerId: string
): Promise<EndpointStatus[]> {
  // Get all endpoints
  const { data: endpoints } = await supabase
    .from('api_endpoints')
    .select('*')
    .eq('provider_id', providerId)
    .eq('is_active', true);

  if (!endpoints) return [];

  // Get extraction configs
  const { data: configs } = await supabase
    .from('extraction_configs')
    .select('*')
    .eq('connection_id', connectionId);

  const configMap = new Map((configs || []).map((c: any) => [c.endpoint_id, c]));

  // Get record counts from database
  const statusList: EndpointStatus[] = [];

  for (const ep of endpoints) {
    const config = configMap.get(ep.id) as any;
    const tableName = `eskolare_${ep.slug}`;
    
    // Get count from database
    const { count } = await supabase
      .from(tableName)
      .select('*', { count: 'exact', head: true })
      .eq('connection_id', connectionId);

    const priorityIndex = ENDPOINT_PRIORITY.indexOf(ep.slug);

    statusList.push({
      slug: ep.slug,
      name: ep.name,
      priority: priorityIndex >= 0 ? priorityIndex + 1 : 99,
      isComplete: config?.is_complete ?? true,
      lastOffset: config?.last_offset ?? 0,
      totalRecords: config?.total_records ?? 0,
      lastSyncAt: config?.last_sync_at ?? null,
      recordsInDb: count ?? 0,
    });
  }

  // Sort by priority
  statusList.sort((a, b) => a.priority - b.priority);

  return statusList;
}

// Get next endpoint that needs sync (based on priority)
async function getNextPendingEndpoint(
  supabase: any,
  connectionId: string,
  providerId: string
): Promise<string | null> {
  const statuses = await getEndpointsStatus(supabase, connectionId, providerId);
  
  for (const status of statuses) {
    // Check if endpoint needs sync
    if (!status.isComplete) {
      console.log(`[PRIORITY] Next pending: ${status.slug} (incomplete, offset: ${status.lastOffset}/${status.totalRecords})`);
      return status.slug;
    }
    
    // Check if sync is stale (older than 30 minutes for complete syncs)
    if (status.lastSyncAt) {
      const lastSync = new Date(status.lastSyncAt);
      const ageMinutes = (Date.now() - lastSync.getTime()) / 60000;
      
      // If more than 30 minutes old and has records, might need re-sync
      if (ageMinutes > 30 && status.totalRecords > 0 && status.recordsInDb < status.totalRecords) {
        console.log(`[PRIORITY] ${status.slug} is stale or incomplete (db: ${status.recordsInDb}, api: ${status.totalRecords})`);
        return status.slug;
      }
    }
  }

  console.log('[PRIORITY] All endpoints are complete and up-to-date');
  return null;
}

// Process and upsert a batch of records
async function processBatch(
  supabase: any,
  tableName: string,
  connectionId: string,
  records: any[]
): Promise<{ created: number; updated: number }> {
  const uniqueRecords = removeDuplicatesFromBatch(records);
  
  const batchData = uniqueRecords.map(record => ({
    connection_id: connectionId,
    external_id: getExternalId(record),
    data: record,
    updated_at: new Date().toISOString(),
  }));

  const externalIds = batchData.map(r => r.external_id);
  const { data: existingRecords } = await supabase
    .from(tableName)
    .select('external_id')
    .eq('connection_id', connectionId)
    .in('external_id', externalIds);
  
  const existingIds = new Set((existingRecords || []).map((r: any) => r.external_id));
  const created = batchData.filter(r => !existingIds.has(r.external_id)).length;
  const updated = batchData.length - created;

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

// Get extraction config
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

  if (error || !data) return null;

  return {
    lastOffset: data.last_offset || 0,
    isComplete: data.is_complete ?? true,
    totalRecords: data.total_records || 0,
  };
}

// Update extraction progress
async function updateExtractionProgress(
  supabase: any,
  connectionId: string,
  endpointId: string,
  offset: number,
  isComplete: boolean,
  totalRecords: number
): Promise<void> {
  const { data: updated } = await supabase
    .from('extraction_configs')
    .update({
      last_offset: offset,
      is_complete: isComplete,
      total_records: totalRecords,
      last_sync_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('connection_id', connectionId)
    .eq('endpoint_id', endpointId)
    .select();

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
      });
  }
}

// Reset extraction progress (for force reset)
async function resetExtractionProgress(
  supabase: any,
  connectionId: string,
  endpointId: string
): Promise<void> {
  await supabase
    .from('extraction_configs')
    .update({
      last_offset: 0,
      is_complete: false,
      total_records: 0,
      updated_at: new Date().toISOString(),
    })
    .eq('connection_id', connectionId)
    .eq('endpoint_id', endpointId);
}

// Validate sync completeness
async function validateSyncCompleteness(
  supabase: any,
  tableName: string,
  connectionId: string,
  expectedTotal: number
): Promise<{ isValid: boolean; actualCount: number; expectedCount: number }> {
  const { count } = await supabase
    .from(tableName)
    .select('*', { count: 'exact', head: true })
    .eq('connection_id', connectionId);

  const actualCount = count ?? 0;
  const isValid = actualCount >= expectedTotal;

  console.log(`[VALIDATION] ${tableName}: ${actualCount}/${expectedTotal} - ${isValid ? 'COMPLETE ✓' : 'INCOMPLETE'}`);

  return { isValid, actualCount, expectedCount: expectedTotal };
}

// Sync a single endpoint completely
async function syncSingleEndpoint(
  supabase: any,
  connectionId: string,
  endpoint: any,
  baseUrl: string,
  token: string,
  startTime: number,
  forceReset: boolean = false
): Promise<{ 
  processed: number; 
  created: number; 
  updated: number; 
  timedOut: boolean; 
  totalRecords: number; 
  finalOffset: number; 
  isComplete: boolean;
  validation: { isValid: boolean; actualCount: number; expectedCount: number } | null;
}> {
  const tableName = `eskolare_${endpoint.slug}`;
  console.log(`[SYNC] Starting sync for: ${endpoint.slug} -> ${tableName}`);

  // Reset if forced
  if (forceReset) {
    console.log(`[SYNC] Force reset requested for ${endpoint.slug}`);
    await resetExtractionProgress(supabase, connectionId, endpoint.id);
  }

  // Get current progress
  const config = await getExtractionConfig(supabase, connectionId, endpoint.id);
  
  // Determine starting offset
  let startOffset = 0;
  if (config && !forceReset) {
    if (!config.isComplete) {
      startOffset = config.lastOffset;
      console.log(`[SYNC] Continuing from offset ${startOffset}/${config.totalRecords}`);
    } else {
      console.log(`[SYNC] Previous sync was complete, starting fresh`);
    }
  }

  let offset = startOffset;
  let hasMore = true;
  let totalRecords = config?.totalRecords || 0;
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

  // Main fetch loop
  while (hasMore && !timedOut) {
    const elapsed = Date.now() - startTime;
    if (elapsed > MAX_EXECUTION_TIME_MS) {
      console.log(`[SYNC] Timeout at offset ${offset}, processed ${processed} records`);
      timedOut = true;
      break;
    }

    const url = `${baseUrl}${endpoint.path}?limit=${PAGE_SIZE}&offset=${offset}`;
    console.log(`[FETCH] ${url}`);
    
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 100)}`);
    }

    const data = await response.json();
    const responseDataPath = endpoint.response_data_path || 'results';
    const results = data[responseDataPath] || data.results || data.data || [];
    
    if (!Array.isArray(results)) {
      pendingRecords.push(results);
      hasMore = false;
    } else if (results.length === 0) {
      console.log(`[FETCH] No more results, stopping`);
      hasMore = false;
    } else {
      if (data.count && data.count > 0) {
        totalRecords = data.count;
      }
      
      const uniqueResults = removeDuplicatesFromBatch(results);
      pendingRecords.push(...uniqueResults);
      
      console.log(`[FETCH] Got ${results.length} records (${uniqueResults.length} unique), total: ${pendingRecords.length}, offset: ${offset}/${totalRecords}`);
      
      offset += PAGE_SIZE;
      
      if (totalRecords > 0 && offset >= totalRecords) {
        console.log(`[FETCH] Reached end: offset ${offset} >= total ${totalRecords}`);
        hasMore = false;
      }
    }

    // Process batches while we have enough
    while (pendingRecords.length >= BATCH_SIZE && !timedOut) {
      const elapsed = Date.now() - startTime;
      if (elapsed > MAX_EXECUTION_TIME_MS) {
        console.log(`[SYNC] Timeout during batch processing`);
        timedOut = true;
        break;
      }

      const batch = pendingRecords.splice(0, BATCH_SIZE);
      try {
        const result = await processBatch(supabase, tableName, connectionId, batch);
        created += result.created;
        updated += result.updated;
        processed += batch.length;
        console.log(`[SYNC] Batch processed: ${processed} total (${result.created} new, ${result.updated} updated)`);
      } catch (batchError: any) {
        console.error(`[SYNC] Batch error:`, batchError.message);
      }
    }

    // Save progress periodically
    if (processed % 500 === 0 && processed > 0) {
      await updateExtractionProgress(supabase, connectionId, endpoint.id, offset, false, totalRecords);
    }
  }

  // Process remaining records
  while (pendingRecords.length > 0 && !timedOut) {
    const elapsed = Date.now() - startTime;
    if (elapsed > MAX_EXECUTION_TIME_MS) {
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

  // Determine completion status
  const fetchedAll = totalRecords > 0 ? offset >= totalRecords : !hasMore;
  const processedAll = pendingRecords.length === 0;
  const isComplete = !timedOut && fetchedAll && processedAll;

  // Save final progress
  await updateExtractionProgress(supabase, connectionId, endpoint.id, offset, isComplete, totalRecords);

  // Validate completeness if sync finished
  let validation = null;
  if (isComplete && totalRecords > 0) {
    validation = await validateSyncCompleteness(supabase, tableName, connectionId, totalRecords);
  }

  console.log(`[SYNC] Finished ${endpoint.slug}: processed=${processed}/${totalRecords}, offset=${offset}, complete=${isComplete}`);

  return { 
    processed, 
    created, 
    updated, 
    timedOut, 
    totalRecords, 
    finalOffset: offset, 
    isComplete,
    validation,
  };
}

// Get orders needing details sync
async function getOrdersNeedingDetails(
  supabase: any,
  connectionId: string,
  limit: number
): Promise<{ orderNumber: string; orderUid: string; status: string; priority: string }[]> {
  const ordersToSync: { orderNumber: string; orderUid: string; status: string; priority: string }[] = [];
  
  async function getOrdersByPriority(
    priority: string,
    statuses: string[],
    maxAgeMinutes: number | null
  ): Promise<void> {
    const remainingSlots = limit - ordersToSync.length;
    if (remainingSlots <= 0) return;

    const { data: orders } = await supabase
      .from('eskolare_orders')
      .select('external_id, data')
      .eq('connection_id', connectionId);

    if (!orders) return;

    const filteredOrders = orders.filter((order: any) => {
      const orderStatus = order.data?.status || order.data?.order_status;
      return statuses.includes(orderStatus);
    });

    if (filteredOrders.length === 0) return;

    const orderNumbers = filteredOrders.map((o: any) => o.data?.order_number?.toString() || o.external_id);

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

    for (const order of filteredOrders) {
      if (ordersToSync.length >= limit) break;

      const orderNumber = order.data?.order_number?.toString() || order.external_id;
      const orderUid = order.data?.uid?.toString() || order.external_id;
      const orderStatus = order.data?.status || order.data?.order_status || 'unknown';
      const existingSyncTime = existingDetailsMap.get(orderNumber);

      let needsSync = false;
      if (!existingSyncTime) {
        needsSync = true;
      } else if (maxAgeMinutes !== null && cutoffTime && typeof existingSyncTime === 'string') {
        const syncTime = new Date(existingSyncTime);
        needsSync = syncTime < cutoffTime;
      }

      if (needsSync) {
        ordersToSync.push({ orderNumber, orderUid, status: orderStatus, priority });
      }
    }

    console.log(`[PRIORITY] ${priority}: Found ${ordersToSync.length} orders needing sync`);
  }

  await getOrdersByPriority('high', STATUS_PRIORITY.high, PRIORITY_MAX_AGE_MINUTES.high);
  await getOrdersByPriority('medium', STATUS_PRIORITY.medium, PRIORITY_MAX_AGE_MINUTES.medium);
  await getOrdersByPriority('low', STATUS_PRIORITY.low, PRIORITY_MAX_AGE_MINUTES.low);

  return ordersToSync;
}

// Fetch order details
async function fetchOrderDetails(
  baseUrl: string,
  token: string,
  orderNumber: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const response = await fetch(`${baseUrl}/orders/${orderNumber}/`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `HTTP ${response.status}: ${errorText.substring(0, 100)}` };
    }

    return { success: true, data: await response.json() };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// Sync order details
async function syncOrderDetails(
  supabase: any,
  connectionId: string,
  endpointId: string,
  baseUrl: string,
  token: string,
  startTime: number
): Promise<{ 
  processed: number; 
  created: number; 
  updated: number; 
  timedOut: boolean; 
  totalRecords: number; 
  finalOffset: number; 
  isComplete: boolean;
  validation: null;
}> {
  console.log(`[ORDER-DETAILS] Starting sync`);

  const ordersToSync = await getOrdersNeedingDetails(supabase, connectionId, ORDER_DETAILS_BATCH_SIZE);

  if (ordersToSync.length === 0) {
    console.log(`[ORDER-DETAILS] No orders need sync`);
    return {
      processed: 0, created: 0, updated: 0, timedOut: false,
      totalRecords: 0, finalOffset: 0, isComplete: true, validation: null,
    };
  }

  const highPriority = ordersToSync.filter(o => o.priority === 'high').length;
  const mediumPriority = ordersToSync.filter(o => o.priority === 'medium').length;
  const lowPriority = ordersToSync.filter(o => o.priority === 'low').length;
  console.log(`[ORDER-DETAILS] Priority: high=${highPriority}, medium=${mediumPriority}, low=${lowPriority}`);

  let processed = 0;
  let created = 0;
  let updated = 0;
  let errors = 0;
  let timedOut = false;

  // Process in parallel chunks
  for (let i = 0; i < ordersToSync.length; i += ORDER_DETAILS_PARALLEL_REQUESTS) {
    const elapsed = Date.now() - startTime;
    if (elapsed > MAX_EXECUTION_TIME_MS) {
      console.log(`[ORDER-DETAILS] Timeout at ${processed} orders`);
      timedOut = true;
      break;
    }

    const chunk = ordersToSync.slice(i, i + ORDER_DETAILS_PARALLEL_REQUESTS);
    console.log(`[ORDER-DETAILS] Chunk ${Math.floor(i / ORDER_DETAILS_PARALLEL_REQUESTS) + 1}: ${chunk.length} orders`);

    const results = await Promise.all(
      chunk.map(order => 
        fetchOrderDetails(baseUrl, token, order.orderNumber)
          .then(result => ({ ...result, order }))
      )
    );

    const successfulResults = results.filter(r => r.success && r.data);
    errors += results.filter(r => !r.success).length;

    if (successfulResults.length > 0) {
      const orderNumbers = successfulResults.map(r => r.order.orderNumber);
      const { data: existingDetails } = await supabase
        .from('eskolare_order_details')
        .select('external_id')
        .eq('connection_id', connectionId)
        .in('external_id', orderNumbers);

      const existingIds = new Set((existingDetails || []).map((d: any) => d.external_id));

      const upsertData = successfulResults.map(r => ({
        connection_id: connectionId,
        external_id: r.order.orderNumber,
        order_uid: r.order.orderUid,
        order_status: r.order.status,
        data: r.data,
        details_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      const newCreated = upsertData.filter(d => !existingIds.has(d.external_id)).length;
      const newUpdated = upsertData.length - newCreated;

      const { error: upsertError } = await supabase
        .from('eskolare_order_details')
        .upsert(upsertData, { onConflict: 'connection_id,external_id', ignoreDuplicates: false });

      if (!upsertError) {
        created += newCreated;
        updated += newUpdated;
        processed += successfulResults.length;
      } else {
        console.error(`[ORDER-DETAILS] Upsert error:`, upsertError.message);
        errors += upsertData.length;
      }
    }

    await new Promise(resolve => setTimeout(resolve, 50));
  }

  const isComplete = !timedOut && processed >= ordersToSync.length;

  await updateExtractionProgress(supabase, connectionId, endpointId, processed, isComplete, ordersToSync.length);

  console.log(`[ORDER-DETAILS] Complete: processed=${processed}, created=${created}, updated=${updated}, errors=${errors}`);

  return {
    processed, created, updated, timedOut,
    totalRecords: ordersToSync.length,
    finalOffset: processed,
    isComplete,
    validation: null,
  };
}

// Main handler
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

    const { connectionId, endpoint, testOnly, forceReset = false } = await req.json() as SyncRequest;

    if (!connectionId) {
      throw new Error('connectionId is required');
    }

    // Get connection
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
      throw new Error('No token in credentials');
    }

    const baseUrl = connection.environment === 'development' 
      ? connection.api_providers.base_url_dev 
      : connection.api_providers.base_url;

    console.log(`[MAIN] Base URL: ${baseUrl}, environment: ${connection.environment}`);

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
        JSON.stringify({ success: testResult.success, testResult, duration_ms: Date.now() - startTime }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // If no endpoint specified, get status of all endpoints
    if (!endpoint) {
      const statuses = await getEndpointsStatus(supabase, connectionId, connection.provider_id);
      const nextPending = await getNextPendingEndpoint(supabase, connectionId, connection.provider_id);
      
      return new Response(
        JSON.stringify({
          success: true,
          endpoints: statuses,
          nextPending,
          message: nextPending 
            ? `Próximo endpoint a sincronizar: ${nextPending}` 
            : 'Todos os endpoints estão sincronizados',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get specific endpoint
    const { data: ep, error: epError } = await supabase
      .from('api_endpoints')
      .select('*')
      .eq('provider_id', connection.provider_id)
      .eq('slug', endpoint)
      .eq('is_active', true)
      .single();

    if (epError || !ep) {
      throw new Error(`Endpoint not found: ${endpoint}`);
    }

    console.log(`[MAIN] Syncing single endpoint: ${ep.slug} (${ep.path})`);

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

    // Sync the endpoint
    let result;
    if (ep.slug === 'order-details') {
      result = await syncOrderDetails(supabase, connectionId, ep.id, baseUrl, token, startTime);
    } else {
      result = await syncSingleEndpoint(supabase, connectionId, ep, baseUrl, token, startTime, forceReset);
    }

    // Update log entry
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
          ? `Incompleto: ${result.processed}/${result.totalRecords} (offset: ${result.finalOffset})` 
          : null,
      })
      .eq('id', logEntry.id);

    return new Response(
      JSON.stringify({
        success: true,
        endpoint: ep.slug,
        ...result,
        duration_ms: Date.now() - startTime,
        message: result.isComplete 
          ? `Sync completo: ${result.processed} registros` 
          : `Sync parcial: ${result.processed}/${result.totalRecords}. Continuará na próxima execução.`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[MAIN] Error:', error);
    
    if (supabase && logEntry) {
      await supabase
        .from('extraction_logs')
        .update({
          status: 'error',
          error_message: error.message,
          duration_ms: Date.now() - startTime,
          finished_at: new Date().toISOString(),
        })
        .eq('id', logEntry.id);
    }
    
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
