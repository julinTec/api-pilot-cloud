import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH_SIZE = 500;
const MAX_EXECUTION_TIME = 45000; // 45 seconds

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
  // Replace comma with period for decimal
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
  records: any[]
): Promise<{ created: number; updated: number }> {
  const uniqueRecords = removeDuplicatesFromBatch(records);
  
  const rows = uniqueRecords.map(record => {
    // Normalize numeric fields
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
      ano: parseInt(record.ano) || new Date().getFullYear(),
      data: normalizedData,
      external_id: getExternalId(record),
    };
  });

  const { error, count } = await supabase
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

// Clean table data for a connection
async function cleanTableData(
  supabase: any,
  connectionId: string,
  ano?: number
): Promise<number> {
  let query = supabase
    .from('syseduca_dados')
    .delete()
    .eq('connection_id', connectionId);

  if (ano) {
    query = query.eq('ano', ano);
  }

  const { error, count } = await query;
  
  if (error) {
    console.error('Clean error:', error);
    throw error;
  }

  return count || 0;
}

serve(async (req) => {
  // Handle CORS
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

    // Create extraction log
    const { data: logEntry, error: logError } = await supabase
      .from('extraction_logs')
      .insert({
        connection_id: connectionId,
        endpoint_id: endpoint?.id,
        status: 'running',
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (logError) {
      console.error('Error creating log:', logError);
    }

    const currentYear = ano || new Date().getFullYear();
    const baseUrl = connection.api_providers.base_url;
    const apiPath = endpoint?.path || '/dados02.asp';
    const apiUrl = `${baseUrl}${apiPath}?ano=${currentYear}`;

    console.log(`Fetching SysEduca data from: ${apiUrl}`);

    // Fetch data from API
    const response = await fetch(apiUrl);
    
    if (!response.ok) {
      throw new Error(`API returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
      throw new Error('API response is not an array');
    }

    console.log(`Received ${data.length} records from SysEduca API`);

    // Clean existing data only on first call (startOffset === 0)
    if (forceClean && startOffset === 0) {
      const deleted = await cleanTableData(supabase, connectionId, currentYear);
      console.log(`Cleaned ${deleted} existing records for year ${currentYear}`);
    }

    // Process in batches starting from offset
    let totalProcessed = 0;
    let totalCreated = 0;
    let totalUpdated = 0;

    for (let i = startOffset; i < data.length; i += BATCH_SIZE) {
      // Check execution time
      if (Date.now() - startTime > MAX_EXECUTION_TIME) {
        console.log(`Timeout approaching, processed ${totalProcessed} of ${data.length} records from offset ${startOffset}`);
        
        // Return partial result with next offset
        return new Response(
          JSON.stringify({
            success: true,
            completed: false,
            nextOffset: i,
            ano: currentYear,
            totalRecords: data.length,
            processed: totalProcessed,
            created: totalCreated,
            updated: totalUpdated,
            durationMs: Date.now() - startTime,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const batch = data.slice(i, i + BATCH_SIZE);
      const { created, updated } = await processBatch(supabase, connectionId, batch);
      
      totalProcessed += batch.length;
      totalCreated += created;
      totalUpdated += updated;

      console.log(`Processed batch ${Math.floor(i / BATCH_SIZE) + 1}: ${i + batch.length}/${data.length}`);
    }

    const duration = Date.now() - startTime;

    // Update extraction log
    if (logEntry) {
      await supabase
        .from('extraction_logs')
        .update({
          status: totalProcessed >= data.length ? 'success' : 'partial',
          records_processed: totalProcessed,
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

    return new Response(
      JSON.stringify({
        success: true,
        completed: true,
        ano: currentYear,
        totalRecords: data.length,
        processed: startOffset + totalProcessed,
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
