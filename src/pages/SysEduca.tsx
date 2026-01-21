import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { RefreshCw, School, Users, DollarSign, CheckCircle, XCircle, GraduationCap, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';

const currentYear = new Date().getFullYear();
const yearOptions = [currentYear, currentYear - 1, currentYear - 2];
const PAGE_SIZE = 50;

interface SchoolSummary {
  escola: string;
  registros: number;
  alunos: number;
  total_bruto: number;
  total_pago: number;
}

export default function SysEduca() {
  const queryClient = useQueryClient();
  const [selectedConnection, setSelectedConnection] = useState<string>('');
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [selectedSchool, setSelectedSchool] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<{ processed: number; total: number } | null>(null);
  const [page, setPage] = useState(0);

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
  useEffect(() => {
    if (connections.length > 0 && !selectedConnection) {
      setSelectedConnection(connections[0].id);
    }
  }, [connections, selectedConnection]);

  // Fetch school summary via RPC (aggregated data)
  const { data: schoolStats = [], isLoading } = useQuery({
    queryKey: ['syseduca-school-summary', selectedConnection, selectedYear],
    queryFn: async () => {
      if (!selectedConnection) return [];

      const { data, error } = await supabase
        .rpc('syseduca_school_summary', {
          p_connection_id: selectedConnection,
          p_ano: selectedYear,
        });

      if (error) throw error;
      
      // Sort by registros descending
      return (data || [])
        .map((row: any) => ({
          escola: row.escola,
          registros: Number(row.registros),
          alunos: Number(row.alunos),
          total_bruto: Number(row.total_bruto),
          total_pago: Number(row.total_pago),
        }))
        .sort((a: SchoolSummary, b: SchoolSummary) => b.registros - a.registros) as SchoolSummary[];
    },
    enabled: !!selectedConnection,
  });

  // Auto-select first school when data loads
  useEffect(() => {
    if (schoolStats.length > 0 && !selectedSchool) {
      setSelectedSchool(schoolStats[0].escola);
    }
  }, [schoolStats, selectedSchool]);

  // Reset page when school changes
  useEffect(() => {
    setPage(0);
  }, [selectedSchool]);

  // Fetch paginated data for selected school
  const { data: schoolData, isLoading: isLoadingSchoolData } = useQuery({
    queryKey: ['syseduca-school-data', selectedConnection, selectedYear, selectedSchool, page],
    queryFn: async () => {
      if (!selectedConnection || !selectedSchool) return { data: [], count: 0 };

      const { data, error, count } = await supabase
        .from('syseduca_dados')
        .select('*', { count: 'exact' })
        .eq('connection_id', selectedConnection)
        .eq('ano', selectedYear)
        .eq('escola', selectedSchool)
        .order('matricula', { ascending: true })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (error) throw error;
      return { data: data || [], count: count || 0 };
    },
    enabled: !!selectedConnection && !!selectedSchool,
  });

  const totalPages = Math.ceil((schoolData?.count || 0) / PAGE_SIZE);

  // Sync mutation with loop until complete + automatic retry on errors
  const syncMutation = useMutation({
    mutationFn: async () => {
      let offset = 0;
      let completed = false;
      let totalProcessed = 0;
      let totalRecords = 0;
      let schools = 0;
      let isFirstCall = true;
      let retryCount = 0;
      const MAX_RETRIES = 10;

      setSyncProgress({ processed: 0, total: 0 });

      while (!completed && retryCount < MAX_RETRIES) {
        try {
          const response = await supabase.functions.invoke('syseduca-sync', {
            body: { 
              connectionId: selectedConnection, 
              ano: selectedYear,
              forceClean: isFirstCall && offset === 0,
              startOffset: offset,
            },
          });

          // Handle HTTP errors (including 500 timeouts)
          if (response.error) {
            retryCount++;
            console.warn(`Sync error (attempt ${retryCount}/${MAX_RETRIES}):`, response.error);
            
            // Try to get nextOffset from response data if available
            if (response.data?.nextOffset !== undefined) {
              offset = response.data.nextOffset;
            }
            
            const waitTime = Math.min(1000 * Math.pow(2, retryCount), 10000);
            toast.warning(`Timeout, reiniciando em ${waitTime/1000}s... (${retryCount}/${MAX_RETRIES})`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
          
          // Success - reset retry counter
          retryCount = 0;
          
          const data = response.data;
          completed = data.completed;
          offset = data.nextOffset || 0;
          totalProcessed = data.processed;
          totalRecords = data.totalRecords;
          schools = data.schools || 0;
          isFirstCall = false;

          setSyncProgress({ processed: totalProcessed, total: totalRecords });

          if (!completed) {
            const percent = totalRecords > 0 ? Math.round((totalProcessed / totalRecords) * 100) : 0;
            const message = data.message || `${totalProcessed.toLocaleString()}/${totalRecords.toLocaleString()}`;
            toast.info(`Sincronizando... ${percent}% - ${message}`);
          }
        } catch (error: any) {
          retryCount++;
          console.error(`Unexpected error (attempt ${retryCount}/${MAX_RETRIES}):`, error);
          
          if (retryCount >= MAX_RETRIES) {
            throw new Error(`Falha após ${MAX_RETRIES} tentativas: ${error.message}`);
          }
          
          const waitTime = Math.min(1000 * Math.pow(2, retryCount), 10000);
          toast.warning(`Erro, reiniciando em ${waitTime/1000}s...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }

      if (!completed && retryCount >= MAX_RETRIES) {
        throw new Error('Máximo de tentativas atingido');
      }

      setSyncProgress(null);
      return { processed: totalProcessed, totalRecords, schools };
    },
    onSuccess: (data) => {
      toast.success(`Sincronizado! ${data.processed.toLocaleString()} registros de ${data.schools} escolas.`);
      queryClient.invalidateQueries({ queryKey: ['syseduca-school-summary'] });
      queryClient.invalidateQueries({ queryKey: ['syseduca-school-data'] });
    },
    onError: (error: any) => {
      setSyncProgress(null);
      toast.error('Erro na sincronização: ' + error.message);
    },
  });

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  // Calculate totals from schoolStats
  const totalAlunos = schoolStats.reduce((sum, s) => sum + s.alunos, 0);
  const totalRegistros = schoolStats.reduce((sum, s) => sum + s.registros, 0);
  const totalBruto = schoolStats.reduce((sum, s) => sum + s.total_bruto, 0);

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
            className="min-w-[140px]"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
            {syncMutation.isPending && syncProgress 
              ? `${Math.round((syncProgress.processed / syncProgress.total) * 100)}%`
              : 'Sincronizar'
            }
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
              <p className="text-2xl font-bold">{totalAlunos.toLocaleString()}</p>
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
              <p className="text-2xl font-bold">{totalRegistros.toLocaleString()}</p>
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
              <p className="text-2xl font-bold">{formatCurrency(totalBruto)}</p>
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
                    <span className="font-medium text-primary">{formatCurrency(stat.total_bruto)}</span>
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
              <Badge>{(schoolData?.count || 0).toLocaleString()} registros</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingSchoolData ? (
              <div className="py-8 text-center text-muted-foreground">Carregando dados...</div>
            ) : (
              <>
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
                      {(schoolData?.data || []).map((row) => {
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
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="mt-4 flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">
                      Exibindo {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, schoolData?.count || 0)} de {(schoolData?.count || 0).toLocaleString()}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.max(0, p - 1))}
                        disabled={page === 0}
                      >
                        <ChevronLeft className="h-4 w-4 mr-1" />
                        Anterior
                      </Button>
                      <span className="text-sm text-muted-foreground">
                        Página {page + 1} de {totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                        disabled={page >= totalPages - 1}
                      >
                        Próximo
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
