// API Data Edge Function - serves data for Power BI and external consumers
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
    const pathParts = url.pathname.split('/').filter(Boolean);
    
    // Expected path: /api-data/{provider}/{endpoint}
    // After function name extraction: provider = pathParts[0], endpoint = pathParts[1]
    const provider = url.searchParams.get('provider') || pathParts[0];
    const endpoint = url.searchParams.get('endpoint') || pathParts[1];
    const connectionId = url.searchParams.get('connection_id');
    const limit = parseInt(url.searchParams.get('limit') || '1000');
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const startDate = url.searchParams.get('start_date');
    const endDate = url.searchParams.get('end_date');
    const fetchAll = url.searchParams.get('all') === 'true';

    console.log(`API Request: provider=${provider}, endpoint=${endpoint}, fetchAll=${fetchAll}, limit=${limit}, offset=${offset}`);

    // If no provider specified, return available providers including file sources
    if (!provider) {
      const { data: providers } = await supabase
        .from('api_providers')
        .select('slug, name, description')
        .eq('is_active', true);

      const { data: fileSources } = await supabase
        .from('file_sources')
        .select('slug, name, description')
        .eq('status', 'ready');

      return new Response(
        JSON.stringify({
          message: 'Available providers',
          providers,
          file_sources: fileSources,
          usage: 'GET /api-data?provider={provider}&endpoint={endpoint} OR GET /api-data?provider=files&endpoint={file_slug}',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle file sources (provider = "files")
    if (provider === 'files') {
      if (!endpoint) {
        // List available file sources
        const { data: fileSources } = await supabase
          .from('file_sources')
          .select('slug, name, description, records_count, file_type')
          .eq('status', 'ready');

        return new Response(
          JSON.stringify({
            provider: 'files',
            endpoints: fileSources,
            usage: 'GET /api-data?provider=files&endpoint={file_slug}',
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Get file source by slug
      const { data: fileSource, error: fileError } = await supabase
        .from('file_sources')
        .select('id, name, slug, records_count')
        .eq('slug', endpoint)
        .eq('status', 'ready')
        .maybeSingle();

      if (fileError || !fileSource) {
        return new Response(
          JSON.stringify({ 
            error: `File source '${endpoint}' not found or not ready`,
            hint: 'Check available file sources using GET /api-data?provider=files'
          }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Fetch all data if requested
      if (fetchAll) {
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
            allData.push(...data.map(row => ({ row_index: row.row_index, ...row.data as Record<string, unknown> })));
            currentOffset += batchSize;
            hasMore = data.length === batchSize;
          } else {
            hasMore = false;
          }
        }

        return new Response(
          JSON.stringify({
            provider: 'files',
            endpoint: fileSource.slug,
            name: fileSource.name,
            count: allData.length,
            all_records: true,
            data: allData,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Paginated query
      const { data, error, count } = await supabase
        .from('file_source_data')
        .select('row_index, data', { count: 'exact' })
        .eq('file_source_id', fileSource.id)
        .order('row_index', { ascending: true })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      const flattenedData = data?.map(row => ({ row_index: row.row_index, ...row.data as Record<string, unknown> }));
      const totalCount = count || 0;
      const hasMoreData = offset + limit < totalCount;

      return new Response(
        JSON.stringify({
          provider: 'files',
          endpoint: fileSource.slug,
          name: fileSource.name,
          count: totalCount,
          limit,
          offset,
          has_more: hasMoreData,
          next_offset: hasMoreData ? offset + limit : null,
          data: flattenedData,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // If no endpoint specified, return available endpoints for provider
    if (!endpoint) {
      const { data: providerData } = await supabase
        .from('api_providers')
        .select('id, name')
        .eq('slug', provider)
        .maybeSingle();

      if (!providerData) {
        return new Response(
          JSON.stringify({ error: `Provider '${provider}' not found` }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: endpoints } = await supabase
        .from('api_endpoints')
        .select('slug, name, description')
        .eq('provider_id', providerData.id)
        .eq('is_active', true);

      return new Response(
        JSON.stringify({
          provider: providerData.name,
          endpoints,
          usage: `GET /api-data?provider=${provider}&endpoint={endpoint}`,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch data from the appropriate table (normalize endpoint: replace hyphens with underscores)
    const normalizedEndpoint = endpoint.replace(/-/g, '_');
    const tableName = `${provider}_${normalizedEndpoint}`;
    
    // Get optional escola filter for SysEduca
    const escolaFilter = url.searchParams.get('escola');
    
    // If fetchAll is true, we need to paginate through all records
    if (fetchAll) {
      console.log(`Fetching all records from ${tableName}...`);
      
      const allData: Record<string, unknown>[] = [];
      let currentOffset = 0;
      const batchSize = 1000;
      let hasMore = true;
      
      while (hasMore) {
        let query = supabase
          .from(tableName)
          .select('*')
          .range(currentOffset, currentOffset + batchSize - 1);

        if (connectionId) {
          query = query.eq('connection_id', connectionId);
        }

        if (startDate) {
          query = query.gte('created_at', startDate);
        }

        if (endDate) {
          query = query.lte('created_at', endDate);
        }

        // Filter by escola for SysEduca
        if (escolaFilter && provider === 'syseduca') {
          query = query.eq('escola', escolaFilter);
        }

        const { data, error } = await query;

        if (error) {
          if (error.message.includes('does not exist')) {
            return new Response(
              JSON.stringify({ 
                error: `Endpoint '${endpoint}' not found for provider '${provider}'`,
                hint: 'Check available endpoints using GET /api-data?provider=' + provider
              }),
              { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          throw error;
        }

        if (data && data.length > 0) {
          allData.push(...data);
          currentOffset += batchSize;
          hasMore = data.length === batchSize;
          console.log(`Fetched ${allData.length} records so far...`);
        } else {
          hasMore = false;
        }
      }

      console.log(`Total records fetched: ${allData.length}`);

      // Flatten data for Power BI compatibility
      const flattenedData = allData.map(row => ({
        id: (row as Record<string, unknown>).id,
        external_id: (row as Record<string, unknown>).external_id,
        connection_id: (row as Record<string, unknown>).connection_id,
        created_at: (row as Record<string, unknown>).created_at,
        updated_at: (row as Record<string, unknown>).updated_at,
        ...(row as Record<string, unknown>).data as Record<string, unknown>,
      }));

      return new Response(
        JSON.stringify({
          provider,
          endpoint,
          count: flattenedData.length,
          all_records: true,
          data: flattenedData,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Standard paginated query
    let query = supabase
      .from(tableName)
      .select('*', { count: 'exact' });

    if (connectionId) {
      query = query.eq('connection_id', connectionId);
    }

    if (startDate) {
      query = query.gte('created_at', startDate);
    }

    if (endDate) {
      query = query.lte('created_at', endDate);
    }

    // Filter by escola for SysEduca
    if (escolaFilter && provider === 'syseduca') {
      query = query.eq('escola', escolaFilter);
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      // Check if table doesn't exist
      if (error.message.includes('does not exist')) {
        return new Response(
          JSON.stringify({ 
            error: `Endpoint '${endpoint}' not found for provider '${provider}'`,
            hint: 'Check available endpoints using GET /api-data?provider=' + provider
          }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw error;
    }

    // Flatten data for Power BI compatibility
    const flattenedData = data?.map(row => ({
      id: row.id,
      external_id: row.external_id,
      connection_id: row.connection_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      ...row.data,
    }));

    const totalCount = count || 0;
    const hasMore = offset + limit < totalCount;

    return new Response(
      JSON.stringify({
        provider,
        endpoint,
        count: totalCount,
        limit,
        offset,
        has_more: hasMore,
        next_offset: hasMore ? offset + limit : null,
        data: flattenedData,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('API Data error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
