import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Copy, ExternalLink, Info, Database } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

const endpoints = [
  { provider: 'eskolare', endpoint: 'orders', name: 'Pedidos', description: 'Todos os pedidos sincronizados' },
  { provider: 'eskolare', endpoint: 'payments', name: 'Pagamentos', description: 'Todos os pagamentos' },
  { provider: 'eskolare', endpoint: 'cancellations', name: 'Cancelamentos', description: 'Pedidos cancelados' },
  { provider: 'eskolare', endpoint: 'partnerships', name: 'Parcerias', description: 'Parcerias ativas' },
  { provider: 'eskolare', endpoint: 'summaries', name: 'Resumos', description: 'Dados consolidados' },
  { provider: 'eskolare', endpoint: 'transactions', name: 'Transações', description: 'Transações financeiras' },
  { provider: 'eskolare', endpoint: 'categories', name: 'Categorias', description: 'Categorias de produtos' },
  { provider: 'eskolare', endpoint: 'grades', name: 'Séries', description: 'Séries/Anos escolares' },
  { provider: 'eskolare', endpoint: 'showcases', name: 'Vitrines', description: 'Vitrines de produtos' },
  { provider: 'eskolare', endpoint: 'withdrawals', name: 'Saques', description: 'Saques realizados' },
];

export default function Endpoints() {
  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    toast.success('URL copiada!');
  };

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader title="Endpoints REST" description="URLs para conexão com Power BI e outras ferramentas" />
      
      {/* Documentação */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Como usar no Power BI</AlertTitle>
        <AlertDescription>
          <ol className="list-decimal list-inside mt-2 space-y-1 text-sm">
            <li>Copie a URL do endpoint desejado</li>
            <li>No Power BI, vá em <strong>Obter Dados → Web</strong></li>
            <li>Cole a URL e clique em <strong>OK</strong></li>
            <li>Use o parâmetro <code className="bg-muted px-1 rounded">all=true</code> para buscar todos os registros</li>
          </ol>
        </AlertDescription>
      </Alert>

      {/* Parâmetros disponíveis */}
      <Accordion type="single" collapsible className="w-full">
        <AccordionItem value="params">
          <AccordionTrigger className="text-sm font-medium">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              Parâmetros disponíveis
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="grid gap-3 text-sm">
              <div className="grid grid-cols-[120px_1fr] gap-2 items-start">
                <code className="bg-muted px-2 py-1 rounded font-mono text-xs">all=true</code>
                <span className="text-muted-foreground">Retorna TODOS os registros (sem limite de 1000). Recomendado para Power BI.</span>
              </div>
              <div className="grid grid-cols-[120px_1fr] gap-2 items-start">
                <code className="bg-muted px-2 py-1 rounded font-mono text-xs">limit</code>
                <span className="text-muted-foreground">Limite de registros por página (padrão: 1000, máx: 1000)</span>
              </div>
              <div className="grid grid-cols-[120px_1fr] gap-2 items-start">
                <code className="bg-muted px-2 py-1 rounded font-mono text-xs">offset</code>
                <span className="text-muted-foreground">Número de registros a pular (para paginação manual)</span>
              </div>
              <div className="grid grid-cols-[120px_1fr] gap-2 items-start">
                <code className="bg-muted px-2 py-1 rounded font-mono text-xs">start_date</code>
                <span className="text-muted-foreground">Filtrar registros a partir desta data (formato: YYYY-MM-DD)</span>
              </div>
              <div className="grid grid-cols-[120px_1fr] gap-2 items-start">
                <code className="bg-muted px-2 py-1 rounded font-mono text-xs">end_date</code>
                <span className="text-muted-foreground">Filtrar registros até esta data (formato: YYYY-MM-DD)</span>
              </div>
              <div className="grid grid-cols-[120px_1fr] gap-2 items-start">
                <code className="bg-muted px-2 py-1 rounded font-mono text-xs">connection_id</code>
                <span className="text-muted-foreground">Filtrar por conexão específica (UUID)</span>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
      
      {/* Lista de Endpoints */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Endpoints Disponíveis</h3>
        {endpoints.map((ep) => {
          const baseUrl = `${SUPABASE_URL}/functions/v1/api-data?provider=${ep.provider}&endpoint=${ep.endpoint}`;
          const fullUrl = `${baseUrl}&all=true`;
          return (
            <Card key={`${ep.provider}-${ep.endpoint}`}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between">
                  {ep.name}
                  <span className="text-xs font-normal text-muted-foreground bg-muted px-2 py-1 rounded">
                    {ep.provider}/{ep.endpoint}
                  </span>
                </CardTitle>
                <p className="text-sm text-muted-foreground">{ep.description}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">URL completa (todos os registros):</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 rounded bg-muted px-3 py-2 font-mono text-xs overflow-x-auto">{fullUrl}</code>
                    <Button variant="outline" size="icon" onClick={() => copyUrl(fullUrl)} title="Copiar URL">
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon" asChild title="Abrir no navegador">
                      <a href={fullUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">URL base (paginada, máx 1000):</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 rounded bg-muted px-3 py-2 font-mono text-xs overflow-x-auto">{baseUrl}</code>
                    <Button variant="ghost" size="icon" onClick={() => copyUrl(baseUrl)} title="Copiar URL">
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
