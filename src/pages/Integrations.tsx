import { useState } from 'react';
import { useProviders, useConnections, useCreateConnection, useEndpoints, useSyncConnection, useTestConnection } from '@/hooks/useApi';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Plus, Plug, RefreshCw, Settings, CheckCircle, XCircle, Zap, Loader2, ChevronDown, RefreshCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ConnectionSettingsModal } from '@/components/integrations/ConnectionSettingsModal';

interface ConnectionWithProvider {
  id: string;
  name: string;
  status: 'active' | 'paused' | 'error';
  environment: string;
  credentials: { token?: string };
  provider_id: string;
  last_test_success: boolean | null;
  api_providers?: { name: string; slug?: string; requires_auth?: boolean };
}

export default function Integrations() {
  const { data: providers = [] } = useProviders();
  const { data: connections = [], isLoading } = useConnections();
  const { data: endpoints = [] } = useEndpoints();
  const createConnection = useCreateConnection();
  const syncMutation = useSyncConnection();
  const testMutation = useTestConnection();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', provider_id: '', token: '', environment: 'production' });
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [settingsConnection, setSettingsConnection] = useState<ConnectionWithProvider | null>(null);

  const selectedProvider = providers.find(p => p.id === form.provider_id);
  const requiresAuth = selectedProvider?.requires_auth !== false;

  const handleCreate = async () => {
    if (!form.name || !form.provider_id || (requiresAuth && !form.token)) {
      toast.error('Preencha todos os campos obrigatórios');
      return;
    }
    try {
      await createConnection.mutateAsync({
        name: form.name,
        provider_id: form.provider_id,
        credentials: requiresAuth ? { token: form.token } : {},
        environment: form.environment,
      });
      toast.success('Conexão criada com sucesso!');
      setOpen(false);
      setForm({ name: '', provider_id: '', token: '', environment: 'production' });
    } catch (error: any) {
      toast.error('Erro: ' + error.message);
    }
  };

  const handleTest = async (connectionId: string, providerSlug?: string) => {
    setTestingId(connectionId);
    try {
      const result = await testMutation.mutateAsync({ connectionId, providerSlug });
      if (result.success) {
        toast.success('Conexão válida! Token funcionando corretamente.');
      } else {
        toast.error(`Falha no teste: ${result.testResult?.error || 'Erro desconhecido'}`);
      }
    } catch (error: any) {
      toast.error('Erro ao testar: ' + error.message);
    } finally {
      setTestingId(null);
    }
  };

  const handleSync = async (connectionId: string, connectionName: string, providerSlug?: string) => {
    setSyncingId(connectionId);
    const toastId = toast.loading(`Sincronizando ${connectionName}...`);
    
    try {
      const result = await syncMutation.mutateAsync({ connectionId, providerSlug });
      
      if (result.success) {
        const total = result.total || { processed: 0, created: 0, updated: 0 };
        const syncedEndpoints = result.endpoints || {};
        
        const errors = Object.entries(syncedEndpoints)
          .filter(([_, data]: [string, any]) => data?.error)
          .map(([name, data]: [string, any]) => `${name}: ${String(data.error).substring(0, 80)}`);

        if (errors.length > 0 && total.processed === 0) {
          toast.error(`Sincronização falhou!\n\n${errors.join('\n')}`, { id: toastId, duration: 10000 });
        } else if (errors.length > 0) {
          toast.warning(
            `Sincronização parcial!\n\nSucesso: ${total.processed} registros\nErros em: ${errors.length} endpoints\n\n${errors.join('\n')}`,
            { id: toastId, duration: 10000 }
          );
        } else if (total.processed === 0 && result.message) {
          toast.success(result.message, { id: toastId, duration: 5000 });
        } else {
          const endpointName = result.endpoint ? ` (${result.endpoint})` : '';
          const durationMs = result.duration_ms || 0;
          toast.success(
            `Sincronização concluída${endpointName}!\n\nTotal: ${total.processed} registros\nCriados: ${total.created} | Atualizados: ${total.updated}\nTempo: ${(durationMs / 1000).toFixed(1)}s`,
            { id: toastId, duration: 8000 }
          );
        }
      } else {
        const errorMsg = result.error || result.message || 'Erro desconhecido na sincronização';
        toast.error(`Erro na sincronização: ${errorMsg}`, { id: toastId, duration: 10000 });
      }
    } catch (error: any) {
      toast.error(`Erro crítico: ${error.message}`, { id: toastId, duration: 10000 });
    } finally {
      setSyncingId(null);
    }
  };

  const handleSyncAll = async (connectionId: string, connectionName: string, forceClean: boolean = false, providerSlug?: string) => {
    setSyncingId(connectionId);
    const actionName = forceClean ? 'resync completo' : 'sincronização completa';
    const toastId = toast.loading(`Iniciando ${actionName} de ${connectionName}...`);
    let totalProcessed = 0, totalCreated = 0, totalUpdated = 0;
    let completedEndpoints = 0;
    let hasError = false;
    
    try {
      while (true) {
        const result = await syncMutation.mutateAsync({ connectionId, providerSlug });
        
        if (!result.success) {
          const errorMsg = result.error || result.message || 'Erro desconhecido';
          toast.error(`Erro na sincronização: ${errorMsg}`, { id: toastId, duration: 10000 });
          hasError = true;
          break;
        }
        
        // Check if all endpoints are synced (use allComplete flag for reliability)
        if (result.allComplete || 
            result.message === 'Todos os endpoints estão sincronizados' || 
            result.message?.includes('sincronizados')) {
          break;
        }
        
        const total = result.total || { processed: 0, created: 0, updated: 0 };
        totalProcessed += total.processed;
        totalCreated += total.created;
        totalUpdated += total.updated;
        completedEndpoints++;
        
        const endpointName = result.endpoint || 'endpoint';
        toast.loading(
          `${endpointName} concluído ✓\n\n${completedEndpoints} endpoints | ${totalProcessed} registros`,
          { id: toastId }
        );
        
        // Small delay to prevent overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      if (!hasError) {
        toast.success(
          `${forceClean ? 'Resync completo' : 'Sincronização completa'}!\n\n${completedEndpoints} endpoints processados\nTotal: ${totalProcessed} registros\nCriados: ${totalCreated} | Atualizados: ${totalUpdated}`,
          { id: toastId, duration: 10000 }
        );
      }
    } catch (error: any) {
      toast.error(`Erro crítico: ${error.message}`, { id: toastId, duration: 10000 });
    } finally {
      setSyncingId(null);
    }
  };

  return (
    <div className="animate-fade-in">
      <PageHeader title="Integrações" description="Gerencie suas conexões de API">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" />Nova Conexão</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nova Conexão</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Provedor</Label>
                <Select value={form.provider_id} onValueChange={(v) => setForm({ ...form, provider_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {providers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Nome da Conexão</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex: Produção Principal" />
              </div>
              {requiresAuth ? (
                <div className="space-y-2">
                  <Label>Bearer Token</Label>
                  <Input type="password" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} placeholder="Seu token de API" />
                </div>
              ) : (
                <div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                  <span className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-success" />
                    Este provider não requer autenticação
                  </span>
                </div>
              )}
              <div className="space-y-2">
                <Label>Ambiente</Label>
                <Select value={form.environment} onValueChange={(v) => setForm({ ...form, environment: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="production">Produção</SelectItem>
                    <SelectItem value="development">Desenvolvimento</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleCreate} className="w-full" disabled={createConnection.isPending}>
                {createConnection.isPending ? 'Criando...' : 'Criar Conexão'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </PageHeader>

      {isLoading ? (
        <div className="text-muted-foreground">Carregando...</div>
      ) : connections.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Plug className="h-12 w-12 text-muted-foreground" />
            <h3 className="mt-4 text-lg font-semibold">Nenhuma conexão</h3>
            <p className="text-muted-foreground">Crie sua primeira integração de API</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {connections.map((conn) => {
            const providerEndpoints = endpoints.filter(e => e.provider_id === conn.provider_id);
            const isSyncing = syncingId === conn.id;
            const isTesting = testingId === conn.id;
            const providerSlug = conn.api_providers?.slug;
            
            return (
              <Card key={conn.id} className="transition-all hover:border-primary/30">
                <CardHeader className="flex flex-row items-start justify-between pb-2">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Plug className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{conn.name}</CardTitle>
                      <p className="text-sm text-muted-foreground">{conn.api_providers?.name}</p>
                    </div>
                  </div>
                  <StatusBadge status={conn.status} />
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Ambiente</span>
                      <span className="font-medium capitalize">{conn.environment}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Endpoints</span>
                      <span className="font-medium">{providerEndpoints.length}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Último teste</span>
                      <span className="flex items-center gap-1">
                        {conn.last_test_success === true && <CheckCircle className="h-4 w-4 text-success" />}
                        {conn.last_test_success === false && <XCircle className="h-4 w-4 text-destructive" />}
                        {conn.last_test_success === null && <span className="text-muted-foreground">-</span>}
                      </span>
                    </div>
                    <div className="flex gap-2 pt-2">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => handleTest(conn.id, providerSlug)} 
                        disabled={isTesting || isSyncing}
                      >
                        {isTesting ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Zap className="mr-2 h-4 w-4" />
                        )}
                        Testar
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button 
                            variant="default" 
                            size="sm" 
                            className="flex-1" 
                            disabled={isSyncing || isTesting}
                          >
                            {isSyncing ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="mr-2 h-4 w-4" />
                            )}
                            Sincronizar
                            <ChevronDown className="ml-2 h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleSync(conn.id, conn.name, providerSlug)}>
                            <RefreshCw className="mr-2 h-4 w-4" />
                            Próximo Pendente
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleSyncAll(conn.id, conn.name, false, providerSlug)}>
                            <RefreshCcw className="mr-2 h-4 w-4" />
                            Sincronizar Tudo
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem 
                            onClick={() => handleSyncAll(conn.id, conn.name, true, providerSlug)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Forçar Resync Completo
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => setSettingsConnection(conn as ConnectionWithProvider)}
                      >
                        <Settings className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ConnectionSettingsModal 
        connection={settingsConnection}
        open={!!settingsConnection}
        onOpenChange={(open) => !open && setSettingsConnection(null)}
      />
    </div>
  );
}
