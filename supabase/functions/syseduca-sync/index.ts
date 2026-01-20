import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH_SIZE = 500;
const CACHE_CHUNK_SIZE = 5000; // Smaller chunks to avoid statement timeout
const MAX_EXECUTION_TIME = 40000; // 40 seconds (margin for safety)

interface SyncRequest {
  connectionId: string;
  ano?: number;
  forceClean?: boolean;
  startOffset?: number;
}

// Convert Brazilian number format (comma as decimal) to standard format
function parseNumber(value: string | number): number {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  const normalized = value.toString().replace(',', '.');
  return parseFloat(normalized) || 0;
}

// Generate unique external_id from escola + matricula + parcela
function getExternalId(record: any): string {
  const escola = record.escola || 'unknown';
  const matricula = record.matricula || 'unknown';
  const parcela = record.parcela || '0';
  return `${escola}_${matricula}_${parcela}`;
}

// Remove duplicates from batch based on external_id
function removeDuplicatesFromBatch(records: any[]): any[] {
  const seen = new Map<string, any>();
  for (const record of records) {
    const extId = getExternalId(record);
    seen.set(extId, record);
  }
  return Array.from(seen.values());
}

// Process a batch of records
async function processBatch(
  supabase: any,
  connectionId: string,
  records: any[],
  currentYear: number
): Promise<{ created: number; updated: number }> {
  const uniqueRecords = removeDuplicatesFromBatch(records);
  
  const rows = uniqueRecords.map(record => {
    const normalizedData = {
      ...record,
      bruto: parseNumber(record.bruto),
      descontos: parseNumber(record.descontos),
      perDesc: parseNumber(record.perDesc),
      liquido: parseNumber(record.liquido),
      valor_pago: parseNumber(record.valor_pago),
    };

    return {
      connection_id: connectionId,
      escola: record.escola || 'Não informado',
      matricula: record.matricula || '',
      ano: parseInt(record.ano) || currentYear,
      data: normalizedData,
      external_id: getExternalId(record),
    };
  });

  const { error } = await supabase
    .from('syseduca_dados')
    .upsert(rows, { 
      onConflict: 'connection_id,external_id',
      ignoreDuplicates: false 
    });

  if (error) {
    console.error('Batch upsert error:', error);
    throw error;
  }

  return { created: rows.length, updated: 0 };
}

// Clean table data for a connection and year
async function cleanTableData(
  supabase: any,
  connectionId: string,
  ano: number
): Promise<number> {
  const { error, count } = await supabase
    .from('syseduca_dados')
    .delete()
    .eq('connection_id', connectionId)
    .eq('ano', ano);
  
  if (error) {
    console.error('Clean error:', error);
    throw error;
  }

  return count || 0;
}

// Check if cache exists for this connection/year
async function cacheExists(supabase: any, connectionId: string, cacheKey: string): Promise<boolean> {
  const { count, error } = await supabase
    .from('syseduca_sync_cache')
    .select('*', { count: 'exact', head: true })
    .eq('connection_id', connectionId)
    .eq('cache_key', cacheKey);

  if (error) {
    console.error('Cache check error:', error);
    return false;
  }

  return (count || 0) > 0;
}

// Get cached data by loading all chunks and merging
async function getCache(supabase: any, connectionId: string, cacheKey: string) {
  const { data, error } = await supabase
    .from('syseduca_sync_cache')
    .select('data, total_records, chunk_index')
    .eq('connection_id', connectionId)
    .eq('cache_key', cacheKey)
    .order('chunk_index', { ascending: true });

  if (error) {
    console.error('Cache fetch error:', error);
    return null;
  }

  if (!data || data.length === 0) {
    return null;
  }

  // Merge all chunks
  const allRecords: any[] = [];
  let totalRecords = 0;
  for (const chunk of data) {
    if (Array.isArray(chunk.data)) {
      allRecords.push(...chunk.data);
    }
    totalRecords = chunk.total_records; // Same for all chunks
  }

  return { data: allRecords, total_records: totalRecords };
}

// Save data to cache in chunks to avoid statement timeout
async function saveCache(
  supabase: any, 
  connectionId: string, 
  cacheKey: string, 
  data: any[],
  totalRecords: number
) {
  // First clear any existing cache for this key
  await supabase
    .from('syseduca_sync_cache')
    .delete()
    .eq('connection_id', connectionId)
    .eq('cache_key', cacheKey);

  // Save in chunks
  for (let i = 0; i < data.length; i += CACHE_CHUNK_SIZE) {
    const chunk = data.slice(i, i + CACHE_CHUNK_SIZE);
    const chunkIndex = Math.floor(i / CACHE_CHUNK_SIZE);
    
    console.log(`Saving cache chunk ${chunkIndex}: ${chunk.length} records`);
    
    const { error } = await supabase
      .from('syseduca_sync_cache')
      .insert({
        connection_id: connectionId,
        cache_key: cacheKey,
        data: chunk,
        total_records: totalRecords,
        chunk_index: chunkIndex,
      });

    if (error) {
      console.error(`Cache save error (chunk ${chunkIndex}):`, error);
      throw error;
    }
  }
  
  console.log(`Cache saved: ${Math.ceil(data.length / CACHE_CHUNK_SIZE)} chunks`);
}

// Clear cache after successful sync
async function clearCache(supabase: any, connectionId: string, cacheKey: string) {
  const { error } = await supabase
    .from('syseduca_sync_cache')
    .delete()
    .eq('connection_id', connectionId)
    .eq('cache_key', cacheKey);

  if (error) {
    console.error('Cache clear error:', error);
  }
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

    const body: SyncRequest = await req.json();
    const { connectionId, ano, forceClean, startOffset = 0 } = body;

    if (!connectionId) {
      return new Response(
        JSON.stringify({ error: 'connectionId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get connection details
    const { data: connection, error: connError } = await supabase
      .from('api_connections')
      .select('*, api_providers(*)')
      .eq('id', connectionId)
      .single();

    if (connError || !connection) {
      return new Response(
        JSON.stringify({ error: 'Connection not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get endpoint info
    const { data: endpoint } = await supabase
      .from('api_endpoints')
      .select('*')
      .eq('provider_id', connection.provider_id)
      .eq('slug', 'dados')
      .single();

    const currentYear = ano || new Date().getFullYear();
    const cacheKey = `year_${currentYear}`;

    // Check if cache already exists
    const hasCachedData = await cacheExists(supabase, connectionId, cacheKey);
    console.log(`Cache exists: ${hasCachedData}, startOffset: ${startOffset}, forceClean: ${forceClean}`);

    let apiData: any[];
    let totalRecords: number;

    if (hasCachedData) {
      // PHASE 2: Use cached data (fast!)
      console.log('Reading from cache...');
      const cached = await getCache(supabase, connectionId, cacheKey);
      
      if (!cached) {
        throw new Error('Cache exists but could not be read');
      }
      
      console.log(`Loaded ${cached.data.length} records from cache`);
      apiData = cached.data;
      totalRecords = cached.total_records;
    } else {
      // PHASE 1: Fetch from API and save to cache
      const baseUrl = connection.api_providers.base_url;
      const apiPath = endpoint?.path || '/dados02.asp';
      const apiUrl = `${baseUrl}${apiPath}?ano=${currentYear}`;

      console.log(`Fetching SysEduca data from: ${apiUrl}`);

      const response = await fetch(apiUrl);
      
      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (!Array.isArray(data)) {
        throw new Error('API response is not an array');
      }

      apiData = data;
      totalRecords = data.length;

      console.log(`Received ${totalRecords} records from SysEduca API`);

      // Save to cache in chunks
      console.log(`Caching ${totalRecords} records in chunks...`);
      await saveCache(supabase, connectionId, cacheKey, apiData, totalRecords);
      console.log('Data cached successfully');

      // Check if we're already out of time after fetching and caching
      const elapsedAfterFetch = Date.now() - startTime;
      console.log(`Elapsed time after fetch+cache: ${elapsedAfterFetch}ms`);
      
      if (elapsedAfterFetch > MAX_EXECUTION_TIME) {
        console.log('Timeout after fetching and caching, returning to continue processing');
        return new Response(
          JSON.stringify({
            success: true,
            completed: false,
            nextOffset: 0,
            ano: currentYear,
            totalRecords: totalRecords,
            processed: 0,
            message: 'Dados em cache, processando...',
            durationMs: elapsedAfterFetch,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Create extraction log only on first processing call (when cleaning)
    let logEntry = null;
    if (forceClean && startOffset === 0) {
      const { data: log } = await supabase
        .from('extraction_logs')
        .insert({
          connection_id: connectionId,
          endpoint_id: endpoint?.id,
          status: 'running',
          started_at: new Date().toISOString(),
        })
        .select()
        .single();
      logEntry = log;

      // Clean existing data
      const deleted = await cleanTableData(supabase, connectionId, currentYear);
      console.log(`Cleaned ${deleted} existing records for year ${currentYear}`);
    }

    // Process in batches starting from offset
    let totalProcessed = 0;
    let totalCreated = 0;
    let totalUpdated = 0;

    console.log(`Starting processing from offset ${startOffset}, total records: ${totalRecords}`);

    for (let i = startOffset; i < apiData.length; i += BATCH_SIZE) {
      // Check execution time
      if (Date.now() - startTime > MAX_EXECUTION_TIME) {
        console.log(`Timeout approaching at offset ${i}, processed ${totalProcessed} records this call`);
        
        return new Response(
          JSON.stringify({
            success: true,
            completed: false,
            nextOffset: i,
            ano: currentYear,
            totalRecords: totalRecords,
            processed: i,
            created: totalCreated,
            updated: totalUpdated,
            durationMs: Date.now() - startTime,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const batch = apiData.slice(i, i + BATCH_SIZE);
      const { created, updated } = await processBatch(supabase, connectionId, batch, currentYear);
      
      totalProcessed += batch.length;
      totalCreated += created;
      totalUpdated += updated;

      console.log(`Processed batch: ${i + batch.length}/${totalRecords} (${Math.round((i + batch.length) / totalRecords * 100)}%)`);
    }

    const duration = Date.now() - startTime;

    // Clear cache after successful completion
    console.log('Sync complete, clearing cache...');
    await clearCache(supabase, connectionId, cacheKey);

    // Update extraction log if we have one
    if (logEntry) {
      await supabase
        .from('extraction_logs')
        .update({
          status: 'success',
          records_processed: totalRecords,
          records_created: totalCreated,
          records_updated: totalUpdated,
          duration_ms: duration,
          finished_at: new Date().toISOString(),
        })
        .eq('id', logEntry.id);
    }

    // Get school summary
    const { data: schoolSummary } = await supabase
      .from('syseduca_dados')
      .select('escola')
      .eq('connection_id', connectionId)
      .eq('ano', currentYear);

    const schoolCounts: Record<string, number> = {};
    if (schoolSummary) {
      for (const row of schoolSummary) {
        schoolCounts[row.escola] = (schoolCounts[row.escola] || 0) + 1;
      }
    }

    console.log(`Sync completed: ${totalRecords} records, ${Object.keys(schoolCounts).length} schools`);

    return new Response(
      JSON.stringify({
        success: true,
        completed: true,
        ano: currentYear,
        totalRecords: totalRecords,
        processed: totalRecords,
        created: totalCreated,
        updated: totalUpdated,
        durationMs: duration,
        schools: Object.keys(schoolCounts).length,
        schoolCounts,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Sync error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMessage,
        durationMs: Date.now() - startTime 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
