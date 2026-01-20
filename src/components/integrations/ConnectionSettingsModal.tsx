import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';

interface Connection {
  id: string;
  name: string;
  environment: string;
  credentials: { token?: string };
  api_providers?: { name: string; requires_auth?: boolean };
}

interface ConnectionSettingsModalProps {
  connection: Connection | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ConnectionSettingsModal({ connection, open, onOpenChange }: ConnectionSettingsModalProps) {
  const queryClient = useQueryClient();
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  
  const requiresAuth = connection?.api_providers?.requires_auth !== false;
  
  const [form, setForm] = useState({
    name: connection?.name || '',
    token: '',
    environment: connection?.environment || 'production',
  });

  // Reset form when connection changes
  if (connection && form.name !== connection.name && form.name === '') {
    setForm({
      name: connection.name,
      token: '',
      environment: connection.environment,
    });
  }

  const handleUpdate = async () => {
    if (!connection) return;
    
    setIsUpdating(true);
    try {
      const updateData: Record<string, any> = {
        name: form.name,
        environment: form.environment,
        updated_at: new Date().toISOString(),
      };
      
      // Only update token if a new one was provided
      if (form.token.trim()) {
        updateData.credentials = { token: form.token };
      }

      const { error } = await supabase
        .from('api_connections')
        .update(updateData)
        .eq('id', connection.id);

      if (error) throw error;

      toast.success('Conexão atualizada com sucesso!');
      queryClient.invalidateQueries({ queryKey: ['connections'] });
      onOpenChange(false);
    } catch (error: any) {
      toast.error('Erro ao atualizar: ' + error.message);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDelete = async () => {
    if (!connection) return;
    
    setIsDeleting(true);
    try {
      // Delete related logs first
      await supabase
        .from('extraction_logs')
        .delete()
        .eq('connection_id', connection.id);

      // Delete related configs
      await supabase
        .from('extraction_configs')
        .delete()
        .eq('connection_id', connection.id);

      // Delete the connection
      const { error } = await supabase
        .from('api_connections')
        .delete()
        .eq('id', connection.id);

      if (error) throw error;

      toast.success('Conexão excluída com sucesso!');
      queryClient.invalidateQueries({ queryKey: ['connections'] });
      onOpenChange(false);
    } catch (error: any) {
      toast.error('Erro ao excluir: ' + error.message);
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  if (!connection) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Configurações da Conexão</DialogTitle>
          <DialogDescription>
            {connection.api_providers?.name} - {connection.name}
          </DialogDescription>
        </DialogHeader>

        {showDeleteConfirm ? (
          <div className="space-y-4 py-4">
            <div className="rounded-lg bg-destructive/10 p-4 text-destructive">
              <p className="font-medium">Tem certeza que deseja excluir esta conexão?</p>
              <p className="text-sm mt-1">Esta ação não pode ser desfeita. Todos os logs e dados sincronizados serão perdidos.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowDeleteConfirm(false)}>
                Cancelar
              </Button>
              <Button variant="destructive" className="flex-1" onClick={handleDelete} disabled={isDeleting}>
                {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                Confirmar Exclusão
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Nome da Conexão</Label>
              <Input 
                value={form.name} 
                onChange={(e) => setForm({ ...form, name: e.target.value })} 
              />
            </div>
            
            {requiresAuth ? (
              <div className="space-y-2">
                <Label>Novo Bearer Token (deixe em branco para manter o atual)</Label>
                <Input 
                  type="password" 
                  value={form.token} 
                  onChange={(e) => setForm({ ...form, token: e.target.value })} 
                  placeholder="••••••••••••••••"
                />
              </div>
            ) : (
              <div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                Este provider não requer autenticação.
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

            <DialogFooter className="flex gap-2 pt-4">
              <Button 
                variant="destructive" 
                onClick={() => setShowDeleteConfirm(true)}
                className="mr-auto"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Excluir
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button onClick={handleUpdate} disabled={isUpdating}>
                {isUpdating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
