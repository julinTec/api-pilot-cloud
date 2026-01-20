import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, School, Users, DollarSign, CheckCircle, XCircle, GraduationCap } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const currentYear = new Date().getFullYear();
const yearOptions = [currentYear, currentYear - 1, currentYear - 2];

export default function SysEduca() {
  const queryClient = useQueryClient();
  const [selectedConnection, setSelectedConnection] = useState<string>('');
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [selectedSchool, setSelectedSchool] = useState<string | null>(null);

  // Fetch SysEduca connections
  const { data: connections = [] } = useQuery({
    queryKey: ['syseduca-connections'],
    queryFn: async () => {
      const { data: provider } = await supabase
        .from('api_providers')
        .select('id')
        .eq('slug', 'syseduca')
        .single();

      if (!provider) return [];

      const { data } = await supabase
        .from('api_connections')
        .select('*')
        .eq('provider_id', provider.id)
        .eq('status', 'active');

      return data || [];
    },
  });

  // Auto-select first connection
  useState(() => {
    if (connections.length > 0 && !selectedConnection) {
      setSelectedConnection(connections[0].id);
    }
  });

  // Fetch data for selected connection and year
  const { data: allData = [], isLoading } = useQuery({
    queryKey: ['syseduca-data', selectedConnection, selectedYear],
    queryFn: async () => {
      if (!selectedConnection) return [];

      const { data, error } = await supabase
        .from('syseduca_dados')
        .select('*')
        .eq('connection_id', selectedConnection)
        .eq('ano', selectedYear)
        .order('escola', { ascending: true });

      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedConnection,
  });

  // Calculate school statistics
  const schoolStats = useMemo(() => {
    const stats: Record<string, { 
      count: number; 
      totalBruto: number; 
      totalPago: number;
      alunosUnicos: Set<string>;
    }> = {};

    for (const row of allData) {
      const escola = row.escola;
      const data = row.data as Record<string, any>;

      if (!stats[escola]) {
        stats[escola] = { count: 0, totalBruto: 0, totalPago: 0, alunosUnicos: new Set() };
      }

      stats[escola].count += 1;
      stats[escola].totalBruto += parseFloat(data.bruto) || 0;
      stats[escola].totalPago += parseFloat(data.valor_pago) || 0;
      stats[escola].alunosUnicos.add(row.matricula);
    }

    return Object.entries(stats)
      .map(([escola, stat]) => ({
        escola,
        registros: stat.count,
        alunos: stat.alunosUnicos.size,
        totalBruto: stat.totalBruto,
        totalPago: stat.totalPago,
      }))
      .sort((a, b) => b.registros - a.registros);
  }, [allData]);

  // Filter data by selected school
  const filteredData = useMemo(() => {
    if (!selectedSchool) return [];
    return allData.filter(row => row.escola === selectedSchool);
  }, [allData, selectedSchool]);

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: async () => {
      const response = await supabase.functions.invoke('syseduca-sync', {
        body: { 
          connectionId: selectedConnection, 
          ano: selectedYear,
          forceClean: true 
        },
      });

      if (response.error) throw response.error;
      return response.data;
    },
    onSuccess: (data) => {
      toast.success(`Sincronizado! ${data.processed} registros de ${data.schools} escolas.`);
      queryClient.invalidateQueries({ queryKey: ['syseduca-data'] });
    },
    onError: (error: any) => {
      toast.error('Erro na sincronização: ' + error.message);
    },
  });

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader 
        title="SysEduca" 
        description="Dados educacionais segregados por escola"
      >
        <div className="flex items-center gap-3">
          <Select value={selectedYear.toString()} onValueChange={(v) => setSelectedYear(parseInt(v))}>
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map(year => (
                <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {connections.length > 1 && (
            <Select value={selectedConnection} onValueChange={setSelectedConnection}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Selecione conexão" />
              </SelectTrigger>
              <SelectContent>
                {connections.map(conn => (
                  <SelectItem key={conn.id} value={conn.id}>{conn.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Button 
            onClick={() => syncMutation.mutate()} 
            disabled={!selectedConnection || syncMutation.isPending}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
            Sincronizar
          </Button>
        </div>
      </PageHeader>

      {/* Summary Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <School className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">{schoolStats.length}</p>
              <p className="text-xs text-muted-foreground">Escolas</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {schoolStats.reduce((sum, s) => sum + s.alunos, 0).toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">Alunos</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <DollarSign className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">{allData.length.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Registros</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {formatCurrency(schoolStats.reduce((sum, s) => sum + s.totalBruto, 0))}
              </p>
              <p className="text-xs text-muted-foreground">Total Bruto</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* School Cards */}
      <div>
        <h3 className="mb-4 text-lg font-semibold">Escolas</h3>
        {isLoading ? (
          <div className="text-muted-foreground">Carregando...</div>
        ) : schoolStats.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center p-8 text-center">
              <School className="mb-3 h-12 w-12 text-muted-foreground" />
              <p className="text-muted-foreground">Nenhum dado encontrado para {selectedYear}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {connections.length === 0 
                  ? 'Configure uma conexão SysEduca primeiro'
                  : 'Clique em Sincronizar para buscar os dados'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {schoolStats.map((stat) => (
              <Card 
                key={stat.escola}
                className={`cursor-pointer transition-all hover:shadow-md ${
                  selectedSchool === stat.escola ? 'ring-2 ring-primary' : ''
                }`}
                onClick={() => setSelectedSchool(stat.escola === selectedSchool ? null : stat.escola)}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium truncate" title={stat.escola}>
                    {stat.escola}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Registros</span>
                    <Badge variant="secondary">{stat.registros.toLocaleString()}</Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Alunos</span>
                    <span className="font-medium">{stat.alunos.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Total</span>
                    <span className="font-medium text-primary">{formatCurrency(stat.totalBruto)}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Data Table for Selected School */}
      {selectedSchool && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>{selectedSchool}</span>
              <Badge>{filteredData.length} registros</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Matrícula</TableHead>
                    <TableHead>Aluno</TableHead>
                    <TableHead>Responsável</TableHead>
                    <TableHead className="text-center">Parcela</TableHead>
                    <TableHead className="text-right">Bruto</TableHead>
                    <TableHead className="text-right">Desconto</TableHead>
                    <TableHead className="text-right">Líquido</TableHead>
                    <TableHead className="text-center">Pago</TableHead>
                    <TableHead>Pagamento</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredData.slice(0, 100).map((row) => {
                    const data = row.data as Record<string, any>;
                    const isPago = data.pago === 'S' || data.pago === 'Sim' || data.pago === true;
                    
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono text-xs">{row.matricula}</TableCell>
                        <TableCell className="max-w-[150px] truncate" title={data.a_nome}>
                          {data.a_nome}
                        </TableCell>
                        <TableCell className="max-w-[150px] truncate" title={data.responsavel}>
                          {data.responsavel}
                        </TableCell>
                        <TableCell className="text-center">
                          {data.parcela}/{data.parcela_final}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(parseFloat(data.bruto) || 0)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">
                          {formatCurrency(parseFloat(data.descontos) || 0)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium">
                          {formatCurrency(parseFloat(data.liquido) || 0)}
                        </TableCell>
                        <TableCell className="text-center">
                          {isPago ? (
                            <CheckCircle className="mx-auto h-4 w-4 text-primary" />
                          ) : (
                            <XCircle className="mx-auto h-4 w-4 text-destructive" />
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {data.pagamento || '-'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {filteredData.length > 100 && (
                <p className="mt-4 text-center text-sm text-muted-foreground">
                  Exibindo 100 de {filteredData.length} registros
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
