import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { FileUploader } from '@/components/files/FileUploader';
import { FileSpreadsheet, Plus, RefreshCw, Trash2, Loader2, Clock, CheckCircle, AlertCircle, FileText, Copy, ExternalLink } from 'lucide-react';
import type { FileSource } from '@/types/auth';

export default function FileIntegrations() {
  const { user, isAdmin } = useAuth();
  const [files, setFiles] = useState<FileSource[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [showUploadDialog, setShowUploadDialog] = useState(false);

  // Upload form state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState('');
  const [fileDescription, setFileDescription] = useState('');
  const [fileCategory, setFileCategory] = useState('');
  const [fileTags, setFileTags] = useState('');

  const baseApiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api-data`;

  useEffect(() => {
    fetchFiles();
  }, []);

  const fetchFiles = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('file_sources')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setFiles((data || []) as unknown as FileSource[]);
    } catch (error) {
      console.error('Error fetching files:', error);
      toast.error('Erro ao carregar arquivos');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
    // Auto-fill name from file name
    if (!fileName) {
      setFileName(file.name.replace(/\.[^/.]+$/, ''));
    }
  };

  const getFileType = (fileName: string): string => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (ext === 'xlsx' || ext === 'xls') return 'excel';
    if (ext === 'csv') return 'csv';
    if (ext === 'parquet') return 'parquet';
    return 'unknown';
  };

  const generateSlug = (name: string): string => {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || !user) return;

    setIsUploading(true);

    try {
      // Generate unique file path
      const fileExt = selectedFile.name.split('.').pop();
      const filePath = `${user.id}/${Date.now()}.${fileExt}`;
      const slug = generateSlug(fileName);

      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from('file-sources')
        .upload(filePath, selectedFile);

      if (uploadError) throw uploadError;

      // Create file_sources record
      const { data: insertedFile, error: dbError } = await supabase
        .from('file_sources')
        .insert({
          name: fileName,
          slug,
          description: fileDescription,
          file_type: getFileType(selectedFile.name),
          file_path: filePath,
          file_size_bytes: selectedFile.size,
          metadata: {
            original_name: selectedFile.name,
            category: fileCategory,
            tags: fileTags.split(',').map(t => t.trim()).filter(Boolean),
          },
          status: 'pending',
          created_by: user.id,
        })
        .select()
        .single();

      if (dbError) throw dbError;

      toast.success('Arquivo enviado!', {
        description: 'Processando dados...',
      });

      // Reset form
      setShowUploadDialog(false);
      setSelectedFile(null);
      setFileName('');
      setFileDescription('');
      setFileCategory('');
      setFileTags('');
      fetchFiles();

      // Auto-process the file
      if (insertedFile) {
        await handleProcessFile(insertedFile.id);
      }
    } catch (error: any) {
      toast.error('Erro ao enviar arquivo', {
        description: error.message,
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleProcessFile = async (fileId: string) => {
    setProcessingId(fileId);
    try {
      const { data, error } = await supabase.functions.invoke('process-file', {
        body: { fileSourceId: fileId },
      });

      if (error) throw error;

      if (data.success) {
        toast.success('Arquivo processado!', {
          description: `${data.records_count} registros importados. API disponível!`,
        });
      } else {
        throw new Error(data.error || 'Erro desconhecido');
      }

      fetchFiles();
    } catch (error: any) {
      toast.error('Erro ao processar arquivo', {
        description: error.message,
      });
    } finally {
      setProcessingId(null);
    }
  };

  const handleDelete = async (file: FileSource) => {
    if (!confirm(`Tem certeza que deseja excluir "${file.name}"?`)) return;

    try {
      // Delete from storage
      await supabase.storage
        .from('file-sources')
        .remove([file.file_path]);

      // Delete from database (cascade will delete file_source_data)
      const { error } = await supabase
        .from('file_sources')
        .delete()
        .eq('id', file.id);

      if (error) throw error;

      toast.success('Arquivo excluído!');
      fetchFiles();
    } catch (error: any) {
      toast.error('Erro ao excluir arquivo', {
        description: error.message,
      });
    }
  };

  const copyApiUrl = (slug: string) => {
    const url = `${baseApiUrl}?provider=files&endpoint=${slug}`;
    navigator.clipboard.writeText(url);
    toast.success('URL da API copiada!');
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ready':
        return (
          <Badge variant="default" className="gap-1">
            <CheckCircle className="h-3 w-3" />
            Pronto
          </Badge>
        );
      case 'processing':
        return (
          <Badge variant="secondary" className="gap-1">
            <RefreshCw className="h-3 w-3 animate-spin" />
            Processando
          </Badge>
        );
      case 'error':
        return (
          <Badge variant="destructive" className="gap-1">
            <AlertCircle className="h-3 w-3" />
            Erro
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="gap-1">
            <Clock className="h-3 w-3" />
            Pendente
          </Badge>
        );
    }
  };

  const getFileIcon = (fileType: string) => {
    if (fileType === 'csv') return FileText;
    return FileSpreadsheet;
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return '-';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader
          title="Integrações de Arquivos"
          description="Importe arquivos Excel/CSV e gere APIs acessíveis automaticamente"
        />
        {isAdmin && (
          <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Novo Arquivo
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <form onSubmit={handleUpload}>
                <DialogHeader>
                  <DialogTitle>Importar Arquivo</DialogTitle>
                  <DialogDescription>
                    Faça upload de um arquivo Excel ou CSV para gerar uma API
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <FileUploader
                    onFileSelect={handleFileSelect}
                    disabled={isUploading}
                  />

                  <div className="space-y-2">
                    <Label htmlFor="name">Nome da API *</Label>
                    <Input
                      id="name"
                      value={fileName}
                      onChange={(e) => setFileName(e.target.value)}
                      placeholder="Ex: Vendas Q1 2024"
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      Slug: {fileName ? generateSlug(fileName) : '-'}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">Descrição</Label>
                    <Textarea
                      id="description"
                      value={fileDescription}
                      onChange={(e) => setFileDescription(e.target.value)}
                      placeholder="Descreva o conteúdo e a fonte dos dados..."
                      rows={3}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="category">Categoria</Label>
                      <Select value={fileCategory} onValueChange={setFileCategory}>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="vendas">Vendas</SelectItem>
                          <SelectItem value="financeiro">Financeiro</SelectItem>
                          <SelectItem value="estoque">Estoque</SelectItem>
                          <SelectItem value="clientes">Clientes</SelectItem>
                          <SelectItem value="outros">Outros</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="tags">Tags</Label>
                      <Input
                        id="tags"
                        value={fileTags}
                        onChange={(e) => setFileTags(e.target.value)}
                        placeholder="tag1, tag2, tag3"
                      />
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setShowUploadDialog(false)}>
                    Cancelar
                  </Button>
                  <Button type="submit" disabled={!selectedFile || isUploading}>
                    {isUploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Enviar e Processar
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Arquivos e APIs</CardTitle>
          <CardDescription>
            Cada arquivo processado gera uma API acessível via <code className="bg-muted px-1 py-0.5 rounded text-xs">provider=files</code>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : files.length === 0 ? (
            <div className="text-center py-8">
              <FileSpreadsheet className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground mb-4">
                Nenhum arquivo importado ainda
              </p>
              {isAdmin && (
                <Button onClick={() => setShowUploadDialog(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Importar Primeiro Arquivo
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Registros</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>API Endpoint</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((file) => {
                  const FileIcon = getFileIcon(file.file_type);
                  const fileWithSlug = file as FileSource & { slug?: string };
                  return (
                    <TableRow key={file.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                            <FileIcon className="h-4 w-4 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium">{file.name}</p>
                            {file.description && (
                              <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                                {file.description}
                              </p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="uppercase">
                          {file.file_type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {file.records_count > 0 ? file.records_count.toLocaleString('pt-BR') : '-'}
                      </TableCell>
                      <TableCell>{getStatusBadge(file.status)}</TableCell>
                      <TableCell>
                        {file.status === 'ready' && fileWithSlug.slug ? (
                          <div className="flex items-center gap-2">
                            <code className="text-xs bg-muted px-2 py-1 rounded">
                              files/{fileWithSlug.slug}
                            </code>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => copyApiUrl(fileWithSlug.slug!)}
                              title="Copiar URL da API"
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {file.status === 'pending' && isAdmin && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleProcessFile(file.id)}
                              disabled={processingId === file.id}
                            >
                              {processingId === file.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <RefreshCw className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                          {file.status === 'ready' && fileWithSlug.slug && (
                            <Button
                              variant="outline"
                              size="sm"
                              asChild
                            >
                              <a
                                href={`${baseApiUrl}?provider=files&endpoint=${fileWithSlug.slug}&limit=10`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            </Button>
                          )}
                          {isAdmin && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDelete(file)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* API Usage Info */}
      <Card>
        <CardHeader>
          <CardTitle>Como usar as APIs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="font-medium mb-2">Listar arquivos disponíveis:</p>
            <code className="block bg-muted p-3 rounded text-sm">
              GET {baseApiUrl}?provider=files
            </code>
          </div>
          <div>
            <p className="font-medium mb-2">Buscar dados de um arquivo:</p>
            <code className="block bg-muted p-3 rounded text-sm">
              GET {baseApiUrl}?provider=files&endpoint=&#123;slug&#125;
            </code>
          </div>
          <div>
            <p className="font-medium mb-2">Parâmetros opcionais:</p>
            <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
              <li><code>limit</code> - Limite de registros (padrão: 1000)</li>
              <li><code>offset</code> - Offset para paginação</li>
              <li><code>all=true</code> - Buscar todos os registros (Power BI)</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
