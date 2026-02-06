import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Parse CSV content
function parseCSV(content: string): { headers: string[], rows: Record<string, any>[] } {
  const lines = content.trim().split('\n');
  if (lines.length === 0) return { headers: [], rows: [] };

  // Detect delimiter (comma or semicolon)
  const firstLine = lines[0];
  const delimiter = firstLine.includes(';') ? ';' : ',';

  const headers = firstLine.split(delimiter).map(h => h.trim().replace(/^["']|["']$/g, ''));
  const rows: Record<string, any>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(delimiter).map(v => v.trim().replace(/^["']|["']$/g, ''));
    if (values.length === headers.length) {
      const row: Record<string, any> = {};
      headers.forEach((header, index) => {
        let value: any = values[index];
        // Try to parse numbers
        if (value !== '' && !isNaN(Number(value.replace(',', '.')))) {
          value = Number(value.replace(',', '.'));
        }
        row[header] = value;
      });
      rows.push(row);
    }
  }

  return { headers, rows };
}

// Parse Parquet content using hyparquet (lightweight, no native deps)
async function parseParquet(fileData: Blob): Promise<Record<string, any>[]> {
  const { parquetMetadataAsync, parquetRead } = await import("npm:hyparquet@1.7.1");
  
  const arrayBuffer = await fileData.arrayBuffer();
  
  // First get metadata to extract column names
  const metadata = await parquetMetadataAsync(arrayBuffer);
  const columnNames = metadata.schema
    .filter((s: any) => s.name !== 'schema') // Filter out root schema element
    .map((s: any) => s.name);
  
  return new Promise((resolve, reject) => {
    try {
      parquetRead({
        file: arrayBuffer,
        onComplete: (data: any[][]) => {
          if (!data || data.length === 0) {
            resolve([]);
            return;
          }
          
          const numRows = data[0]?.length || 0;
          const rows: Record<string, any>[] = [];
          
          for (let rowIdx = 0; rowIdx < numRows; rowIdx++) {
            const row: Record<string, any> = {};
            for (let colIdx = 0; colIdx < data.length; colIdx++) {
              const colName = columnNames[colIdx] || `col_${colIdx}`;
              row[colName] = data[colIdx][rowIdx];
            }
            rows.push(row);
          }
          resolve(rows);
        },
      });
    } catch (err) {
      reject(err);
    }
  });
}

// Generate slug from name
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { fileSourceId } = await req.json();

    if (!fileSourceId) {
      return new Response(
        JSON.stringify({ error: 'fileSourceId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Processing file source: ${fileSourceId}`);

    // Get file source info
    const { data: fileSource, error: fileError } = await supabase
      .from('file_sources')
      .select('*')
      .eq('id', fileSourceId)
      .single();

    if (fileError || !fileSource) {
      return new Response(
        JSON.stringify({ error: 'File source not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update status to processing
    await supabase
      .from('file_sources')
      .update({ status: 'processing' })
      .eq('id', fileSourceId);

    // Download file from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('file-sources')
      .download(fileSource.file_path);

    if (downloadError || !fileData) {
      await supabase
        .from('file_sources')
        .update({ status: 'error' })
        .eq('id', fileSourceId);

      return new Response(
        JSON.stringify({ error: 'Failed to download file', details: downloadError?.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let rows: Record<string, any>[] = [];
    const fileType = fileSource.file_type;

    // Parse based on file type
    if (fileType === 'csv') {
      const content = await fileData.text();
      const parsed = parseCSV(content);
      rows = parsed.rows;
      console.log(`Parsed CSV: ${rows.length} rows, headers: ${parsed.headers.join(', ')}`);
    } else if (fileType === 'excel') {
      // For Excel files, we'll read as text and try to parse
      // Note: Full Excel parsing would require a library like SheetJS
      // For now, we handle simple tab-separated or CSV-like Excel exports
      const content = await fileData.text();
      const parsed = parseCSV(content);
      rows = parsed.rows;
      console.log(`Parsed Excel as CSV: ${rows.length} rows`);
    } else if (fileType === 'parquet') {
      // Parse Parquet file
      try {
        rows = await parseParquet(fileData);
        console.log(`Parsed Parquet: ${rows.length} rows`);
      } catch (parquetError: any) {
        console.error('Parquet parsing error:', parquetError);
        await supabase
          .from('file_sources')
          .update({ status: 'error' })
          .eq('id', fileSourceId);

        return new Response(
          JSON.stringify({ error: `Failed to parse Parquet file: ${parquetError.message}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else {
      // Unknown format
      await supabase
        .from('file_sources')
        .update({ status: 'error' })
        .eq('id', fileSourceId);

      return new Response(
        JSON.stringify({ error: `File type '${fileType}' is not supported` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (rows.length === 0) {
      await supabase
        .from('file_sources')
        .update({ status: 'error' })
        .eq('id', fileSourceId);

      return new Response(
        JSON.stringify({ error: 'No data rows found in file' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Delete existing data for this file source
    await supabase
      .from('file_source_data')
      .delete()
      .eq('file_source_id', fileSourceId);

    // Insert data in batches
    const BATCH_SIZE = 100;
    let insertedCount = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE).map((row, index) => ({
        file_source_id: fileSourceId,
        row_index: i + index,
        data: row,
      }));

      const { error: insertError } = await supabase
        .from('file_source_data')
        .insert(batch);

      if (insertError) {
        console.error(`Error inserting batch at row ${i}:`, insertError);
        throw insertError;
      }

      insertedCount += batch.length;
      console.log(`Inserted ${insertedCount}/${rows.length} rows`);
    }

    // Generate slug if not exists
    const slug = fileSource.slug || generateSlug(fileSource.name);

    // Update file source with success status and record count
    await supabase
      .from('file_sources')
      .update({
        status: 'ready',
        slug,
        records_count: rows.length,
        last_processed_at: new Date().toISOString(),
      })
      .eq('id', fileSourceId);

    console.log(`File processing complete: ${rows.length} records`);

    return new Response(
      JSON.stringify({
        success: true,
        records_count: rows.length,
        slug,
        api_url: `/api-data?provider=files&endpoint=${slug}`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Process file error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
