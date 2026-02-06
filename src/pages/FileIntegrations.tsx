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
import { FileSpreadsheet, Plus, RefreshCw, Trash2, Loader2, Clock, CheckCircle, AlertCircle, FileText } from 'lucide-react';
import type { FileSource } from '@/types/auth';

export default function FileIntegrations() {
  const { user, isAdmin } = useAuth();
  const [files, setFiles] = useState<FileSource[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [showUploadDialog, setShowUploadDialog] = useState(false);

  // Upload form state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState('');
  const [fileDescription, setFileDescription] = useState('');
  const [fileCategory, setFileCategory] = useState('');
  const [fileTags, setFileTags] = useState('');

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
      setFiles((data || []) as FileSource[]);
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

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || !user) return;

    setIsUploading(true);

    try {
      // Generate unique file path
      const fileExt = selectedFile.name.split('.').pop();
      const filePath = `${user.id}/${Date.now()}.${fileExt}`;

      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from('file-sources')
        .upload(filePath, selectedFile);

      if (uploadError) throw uploadError;

      // Create file_sources record
      const { error: dbError } = await supabase
        .from('file_sources')
        .insert({
          name: fileName,
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
        });

      if (dbError) throw dbError;

      toast.success('Arquivo enviado!', {
        description: 'O arquivo será processado em breve.',
      });

      // Reset form
      setShowUploadDialog(false);
      setSelectedFile(null);
      setFileName('');
      setFileDescription('');
      setFileCategory('');
      setFileTags('');
      fetchFiles();
    } catch (error: any) {
      toast.error('Erro ao enviar arquivo', {
        description: error.message,
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (file: FileSource) => {
    if (!confirm(`Tem certeza que deseja excluir "${file.name}"?`)) return;

    try {
      // Delete from storage
      await supabase.storage
        .from('file-sources')
        .remove([file.file_path]);

      // Delete from database
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
          description="Importe e gerencie dados de arquivos Excel, CSV e Parquet"
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
                    Faça upload de um arquivo Excel, CSV ou Parquet
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <FileUploader
                    onFileSelect={handleFileSelect}
                    disabled={isUploading}
                  />

                  <div className="space-y-2">
                    <Label htmlFor="name">Nome da Integração *</Label>
                    <Input
                      id="name"
                      value={fileName}
                      onChange={(e) => setFileName(e.target.value)}
                      placeholder="Ex: Vendas Q1 2024"
                      required
                    />
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
                    Enviar Arquivo
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Arquivos Importados</CardTitle>
          <CardDescription>
            Lista de todos os arquivos de dados externos
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
                  <TableHead>Tamanho</TableHead>
                  <TableHead>Registros</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Criado em</TableHead>
                  {isAdmin && <TableHead className="text-right">Ações</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((file) => {
                  const FileIcon = getFileIcon(file.file_type);
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
                      <TableCell>{formatFileSize(file.file_size_bytes)}</TableCell>
                      <TableCell>
                        {file.records_count > 0 ? file.records_count.toLocaleString('pt-BR') : '-'}
                      </TableCell>
                      <TableCell>{getStatusBadge(file.status)}</TableCell>
                      <TableCell>
                        {new Date(file.created_at).toLocaleDateString('pt-BR')}
                      </TableCell>
                      {isAdmin && (
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(file)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
