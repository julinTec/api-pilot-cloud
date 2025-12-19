import { useConnections, useProviders, useExtractionLogs, useSyncConnection } from '@/hooks/useApi';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plug, RefreshCw, History, Database, Plus, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function Dashboard() {
  const { data: connections = [], isLoading: loadingConnections } = useConnections();
  const { data: providers = [] } = useProviders();
  const { data: logs = [] } = useExtractionLogs(undefined, 10);
  const syncMutation = useSyncConnection();

  const activeConnections = connections.filter(c => c.status === 'active').length;
  const totalRecords = logs.reduce((sum, log) => sum + (log.records_processed || 0), 0);
  const successRate = logs.length > 0 
    ? Math.round((logs.filter(l => l.status === 'success').length / logs.length) * 100) 
    : 0;

  const handleSync = async (connectionId: string) => {
    try {
      await syncMutation.mutateAsync({ connectionId });
      toast.success('Sincronização iniciada!');
    } catch (error: any) {
      toast.error('Erro ao sincronizar: ' + error.message);
    }
  };

  return (
    <div className="animate-fade-in">
      <PageHeader 
        title="Dashboard" 
        description="Visão geral das suas integrações de API"
      >
        <Button asChild>
          <Link to="/integrations">
            <Plus className="mr-2 h-4 w-4" />
            Nova Integração
          </Link>
        </Button>
      </PageHeader>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Provedores" value={providers.length} icon={Zap} subtitle="APIs disponíveis" />
        <StatCard title="Conexões Ativas" value={activeConnections} icon={Plug} subtitle={`de ${connections.length} total`} />
        <StatCard title="Registros Sincronizados" value={totalRecords.toLocaleString()} icon={Database} subtitle="últimas execuções" />
        <StatCard title="Taxa de Sucesso" value={`${successRate}%`} icon={History} subtitle="nas últimas execuções" />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Conexões</CardTitle>
            <Button variant="outline" size="sm" asChild>
              <Link to="/integrations">Ver todas</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {loadingConnections ? (
              <div className="text-muted-foreground">Carregando...</div>
            ) : connections.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center">
                <Plug className="mx-auto h-10 w-10 text-muted-foreground" />
                <p className="mt-2 text-muted-foreground">Nenhuma conexão configurada</p>
                <Button className="mt-4" asChild>
                  <Link to="/integrations">Criar primeira conexão</Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {connections.slice(0, 5).map((conn) => (
                  <div key={conn.id} className="flex items-center justify-between rounded-lg border p-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded bg-primary/10 text-primary">
                        <Plug className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="font-medium">{conn.name}</p>
                        <p className="text-xs text-muted-foreground">{conn.api_providers?.name}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={conn.status} />
                      <Button 
                        variant="ghost" 
                        size="icon"
                        onClick={() => handleSync(conn.id)}
                        disabled={syncMutation.isPending}
                      >
                        <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Últimas Execuções</CardTitle>
            <Button variant="outline" size="sm" asChild>
              <Link to="/logs">Ver todas</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {logs.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center">
                <History className="mx-auto h-10 w-10 text-muted-foreground" />
                <p className="mt-2 text-muted-foreground">Nenhuma execução registrada</p>
              </div>
            ) : (
              <div className="space-y-3">
                {logs.slice(0, 5).map((log) => (
                  <div key={log.id} className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="font-medium">{log.api_endpoints?.name || 'Endpoint'}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(log.started_at), { addSuffix: true, locale: ptBR })}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-muted-foreground">{log.records_processed} registros</span>
                      <StatusBadge status={log.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
