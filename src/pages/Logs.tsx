import { useExtractionLogs } from '@/hooks/useApi';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDistanceToNow, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function Logs() {
  const { data: logs = [], isLoading } = useExtractionLogs(undefined, 100);

  return (
    <div className="animate-fade-in">
      <PageHeader title="Logs de Execução" description="Histórico de todas as sincronizações" />
      
      {isLoading ? (
        <div className="text-muted-foreground">Carregando...</div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Endpoint</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Registros</TableHead>
                <TableHead>Duração</TableHead>
                <TableHead>Iniciado</TableHead>
                <TableHead>Erro</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="font-medium">{log.api_endpoints?.name || '-'}</TableCell>
                  <TableCell><StatusBadge status={log.status} /></TableCell>
                  <TableCell>{log.records_processed}</TableCell>
                  <TableCell>{log.duration_ms ? `${(log.duration_ms / 1000).toFixed(1)}s` : '-'}</TableCell>
                  <TableCell title={format(new Date(log.started_at), 'PPpp', { locale: ptBR })}>
                    {formatDistanceToNow(new Date(log.started_at), { addSuffix: true, locale: ptBR })}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-destructive">{log.error_message || '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
