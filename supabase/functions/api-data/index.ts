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

    // If no provider specified, return available providers
    if (!provider) {
      const { data: providers } = await supabase
        .from('api_providers')
        .select('slug, name, description')
        .eq('is_active', true);

      return new Response(
        JSON.stringify({
          message: 'Available providers',
          providers,
          usage: 'GET /api-data?provider={provider}&endpoint={endpoint}',
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
        .single();

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

    // Fetch data from the appropriate table
    const tableName = `${provider}_${endpoint}`;
    
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

    return new Response(
      JSON.stringify({
        provider,
        endpoint,
        count,
        limit,
        offset,
        data: flattenedData,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('API Data error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
