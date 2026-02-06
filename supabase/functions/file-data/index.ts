// File Data API - serves file source data for Power BI
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    const slug = url.searchParams.get('slug');

    console.log(`File Data API: slug=${slug}`);

    // If no slug, list available files
    if (!slug) {
      const { data: fileSources } = await supabase
        .from('file_sources')
        .select('slug, name, description, records_count, file_type')
        .eq('status', 'ready');

      return new Response(
        JSON.stringify({
          message: 'Available file sources',
          files: fileSources,
          usage: 'GET /file-data?slug={file_slug}',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get file source by slug
    const { data: fileSource, error: fileError } = await supabase
      .from('file_sources')
      .select('id, name, slug, records_count')
      .eq('slug', slug)
      .eq('status', 'ready')
      .maybeSingle();

    if (fileError || !fileSource) {
      return new Response(
        JSON.stringify({ 
          error: `File source '${slug}' not found`,
          hint: 'Check available files using GET /file-data'
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch ALL data (no pagination limit)
    const allData: Record<string, unknown>[] = [];
    let currentOffset = 0;
    const batchSize = 1000;
    let hasMore = true;
    
    while (hasMore) {
      const { data, error } = await supabase
        .from('file_source_data')
        .select('row_index, data')
        .eq('file_source_id', fileSource.id)
        .order('row_index', { ascending: true })
        .range(currentOffset, currentOffset + batchSize - 1);

      if (error) throw error;

      if (data && data.length > 0) {
        allData.push(...data.map(row => ({ 
          row_index: row.row_index, 
          ...row.data as Record<string, unknown> 
        })));
        currentOffset += batchSize;
        hasMore = data.length === batchSize;
      } else {
        hasMore = false;
      }
    }

    console.log(`Returning ${allData.length} records for ${slug}`);

    return new Response(
      JSON.stringify({
        file: fileSource.slug,
        name: fileSource.name,
        count: allData.length,
        data: allData,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('File Data API error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
