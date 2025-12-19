import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Copy, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

const endpoints = [
  { provider: 'eskolare', endpoint: 'orders', name: 'Pedidos', description: 'Todos os pedidos sincronizados' },
  { provider: 'eskolare', endpoint: 'payments', name: 'Pagamentos', description: 'Todos os pagamentos' },
  { provider: 'eskolare', endpoint: 'cancellations', name: 'Cancelamentos', description: 'Pedidos cancelados' },
  { provider: 'eskolare', endpoint: 'partnerships', name: 'Parcerias', description: 'Parcerias ativas' },
  { provider: 'eskolare', endpoint: 'summaries', name: 'Resumos', description: 'Dados consolidados' },
];

export default function Endpoints() {
  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    toast.success('URL copiada!');
  };

  return (
    <div className="animate-fade-in">
      <PageHeader title="Endpoints REST" description="URLs para conexão com Power BI e outras ferramentas" />
      
      <div className="space-y-4">
        {endpoints.map((ep) => {
          const url = `${SUPABASE_URL}/functions/v1/api-data?provider=${ep.provider}&endpoint=${ep.endpoint}`;
          return (
            <Card key={`${ep.provider}-${ep.endpoint}`}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{ep.name}</CardTitle>
                <p className="text-sm text-muted-foreground">{ep.description}</p>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-muted px-3 py-2 font-mono text-sm">{url}</code>
                  <Button variant="outline" size="icon" onClick={() => copyUrl(url)}><Copy className="h-4 w-4" /></Button>
                  <Button variant="outline" size="icon" asChild><a href={url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" /></a></Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
