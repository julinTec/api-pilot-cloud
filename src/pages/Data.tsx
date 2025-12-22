import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useConnections, useEndpoints } from '@/hooks/useApi';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Database, FileJson, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

type TableName = 'eskolare_orders' | 'eskolare_payments' | 'eskolare_grades' | 'eskolare_order_details';

const tableOptions: { value: TableName; label: string }[] = [
  { value: 'eskolare_orders', label: 'Pedidos' },
  { value: 'eskolare_payments', label: 'Pagamentos' },
  { value: 'eskolare_grades', label: 'Séries' },
  { value: 'eskolare_order_details', label: 'Detalhes do Pedido' },
];

export default function Data() {
  const [selectedTable, setSelectedTable] = useState<TableName>('eskolare_orders');
  const [selectedConnection, setSelectedConnection] = useState<string>('all');
  const { data: connections = [] } = useConnections();

  const { data: tableData = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['table-data', selectedTable, selectedConnection],
    queryFn: async () => {
      let query = supabase
        .from(selectedTable)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (selectedConnection !== 'all') {
        query = query.eq('connection_id', selectedConnection);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });

  const { data: counts = {} } = useQuery({
    queryKey: ['table-counts', selectedConnection],
    queryFn: async () => {
      const results: Record<string, number> = {};
      
      for (const table of tableOptions) {
        let query = supabase.from(table.value).select('*', { count: 'exact', head: true });
        if (selectedConnection !== 'all') {
          query = query.eq('connection_id', selectedConnection);
        }
        const { count } = await query;
        results[table.value] = count || 0;
      }
      
      return results;
    },
  });

  const getDataPreview = (data: any) => {
    if (!data) return '-';
    if (typeof data === 'object') {
      // Try to get a meaningful preview
      const keys = ['order_id', 'id', 'name', 'title', 'status', 'total', 'value'];
      for (const key of keys) {
        if (data[key] !== undefined) {
          return `${key}: ${data[key]}`;
        }
      }
      return JSON.stringify(data).substring(0, 100) + '...';
    }
    return String(data);
  };

  return (
    <div className="animate-fade-in">
      <PageHeader title="Dados Extraídos" description="Visualize os dados sincronizados das APIs">
        <Button variant="outline" onClick={() => refetch()} disabled={isRefetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isRefetching ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </PageHeader>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap gap-4">
        <Select value={selectedConnection} onValueChange={setSelectedConnection}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Conexão" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as Conexões</SelectItem>
            {connections.map((conn) => (
              <SelectItem key={conn.id} value={conn.id}>{conn.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={selectedTable} onValueChange={(v) => setSelectedTable(v as TableName)}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Tabela" />
          </SelectTrigger>
          <SelectContent>
            {tableOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Stats Cards */}
      <div className="mb-6 grid gap-4 md:grid-cols-4">
        {tableOptions.map((table) => (
          <Card 
            key={table.value} 
            className={`cursor-pointer transition-all ${selectedTable === table.value ? 'border-primary ring-1 ring-primary' : 'hover:border-primary/30'}`}
            onClick={() => setSelectedTable(table.value)}
          >
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <FileJson className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{counts[table.value] || 0}</p>
                <p className="text-xs text-muted-foreground">{table.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Data Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            {tableOptions.find(t => t.value === selectedTable)?.label}
            <Badge variant="secondary" className="ml-2">{tableData.length} registros</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              Carregando...
            </div>
          ) : tableData.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Database className="h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">Nenhum dado encontrado</h3>
              <p className="text-muted-foreground">Execute uma sincronização para extrair dados</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[100px]">ID Externo</TableHead>
                    <TableHead>Preview dos Dados</TableHead>
                    <TableHead className="w-[180px]">Criado em</TableHead>
                    <TableHead className="w-[180px]">Atualizado em</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tableData.map((row: any) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs">
                        {row.external_id?.substring(0, 20) || row.report_type || '-'}
                      </TableCell>
                      <TableCell className="max-w-[400px] truncate font-mono text-xs">
                        {getDataPreview(row.data)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(row.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(row.updated_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
