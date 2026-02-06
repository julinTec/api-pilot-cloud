import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Users as UsersIcon, Plus, Shield, ShieldCheck, Trash2, Loader2 } from 'lucide-react';
import type { Profile, AppRole, UserConnectionAccess } from '@/types/auth';
import type { ApiConnection } from '@/types/api';

interface UserWithRole extends Profile {
  role: AppRole;
}

export default function Users() {
  const { isAdmin } = useAuth();
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [connections, setConnections] = useState<ApiConnection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showPermissionsDialog, setShowPermissionsDialog] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserWithRole | null>(null);
  const [userPermissions, setUserPermissions] = useState<UserConnectionAccess[]>([]);

  // New user form
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<AppRole>('user');

  useEffect(() => {
    if (isAdmin) {
      fetchUsers();
      fetchConnections();
    }
  }, [isAdmin]);

  const fetchUsers = async () => {
    setIsLoading(true);
    try {
      // Fetch profiles
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (profilesError) throw profilesError;

      // Fetch roles
      const { data: roles, error: rolesError } = await supabase
        .from('user_roles')
        .select('*');

      if (rolesError) throw rolesError;

      // Combine profiles with roles
      const usersWithRoles: UserWithRole[] = (profiles || []).map((profile: Profile) => {
        const userRole = roles?.find((r: { user_id: string; role: AppRole }) => r.user_id === profile.id);
        return {
          ...profile,
          role: (userRole?.role as AppRole) || 'user',
        };
      });

      setUsers(usersWithRoles);
    } catch (error) {
      console.error('Error fetching users:', error);
      toast.error('Erro ao carregar usuários');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchConnections = async () => {
    try {
      const { data, error } = await supabase
        .from('api_connections')
        .select('*, api_providers(*)');

      if (error) throw error;
      setConnections((data || []) as unknown as ApiConnection[]);
    } catch (error) {
      console.error('Error fetching connections:', error);
    }
  };

  const fetchUserPermissions = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('user_connection_access')
        .select('*')
        .eq('user_id', userId);

      if (error) throw error;
      setUserPermissions(data || []);
    } catch (error) {
      console.error('Error fetching permissions:', error);
      toast.error('Erro ao carregar permissões');
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);

    try {
      // Create user via admin API (signup)
      const { data, error } = await supabase.auth.signUp({
        email: newEmail,
        password: newPassword,
        options: {
          emailRedirectTo: window.location.origin,
          data: {
            full_name: newName,
          },
        },
      });

      if (error) throw error;

      if (data.user && newRole === 'admin') {
        // Update role to admin if needed
        const { error: roleError } = await supabase
          .from('user_roles')
          .update({ role: 'admin' })
          .eq('user_id', data.user.id);

        if (roleError) throw roleError;
      }

      toast.success('Usuário criado!', {
        description: 'Um email de confirmação foi enviado.',
      });

      setShowCreateDialog(false);
      setNewEmail('');
      setNewPassword('');
      setNewName('');
      setNewRole('user');
      fetchUsers();
    } catch (error: any) {
      toast.error('Erro ao criar usuário', {
        description: error.message,
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleUpdateRole = async (userId: string, newRole: AppRole) => {
    try {
      const { error } = await supabase
        .from('user_roles')
        .update({ role: newRole })
        .eq('user_id', userId);

      if (error) throw error;

      toast.success('Role atualizada!');
      fetchUsers();
    } catch (error: any) {
      toast.error('Erro ao atualizar role', {
        description: error.message,
      });
    }
  };

  const handleOpenPermissions = async (user: UserWithRole) => {
    setSelectedUser(user);
    await fetchUserPermissions(user.id);
    setShowPermissionsDialog(true);
  };

  const handleTogglePermission = async (
    connectionId: string,
    field: 'can_view' | 'can_sync' | 'can_manage',
    value: boolean
  ) => {
    if (!selectedUser) return;

    try {
      const existingPermission = userPermissions.find(p => p.connection_id === connectionId);

      if (existingPermission) {
        const { error } = await supabase
          .from('user_connection_access')
          .update({ [field]: value })
          .eq('id', existingPermission.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('user_connection_access')
          .insert({
            user_id: selectedUser.id,
            connection_id: connectionId,
            [field]: value,
          });

        if (error) throw error;
      }

      fetchUserPermissions(selectedUser.id);
      toast.success('Permissão atualizada!');
    } catch (error: any) {
      toast.error('Erro ao atualizar permissão', {
        description: error.message,
      });
    }
  };

  const getPermission = (connectionId: string, field: 'can_view' | 'can_sync' | 'can_manage') => {
    const permission = userPermissions.find(p => p.connection_id === connectionId);
    return permission ? permission[field] : false;
  };

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-full">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Acesso Negado</CardTitle>
            <CardDescription>
              Você não tem permissão para acessar esta página.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader
          title="Gestão de Usuários"
          description="Gerencie usuários e suas permissões de acesso às APIs"
        />
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Novo Usuário
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={handleCreateUser}>
              <DialogHeader>
                <DialogTitle>Criar Novo Usuário</DialogTitle>
                <DialogDescription>
                  O usuário receberá um email para confirmar a conta.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Nome Completo</Label>
                  <Input
                    id="name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Nome do usuário"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="email@exemplo.com"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Senha Temporária</Label>
                  <Input
                    id="password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    minLength={6}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role">Role</Label>
                  <Select value={newRole} onValueChange={(v) => setNewRole(v as AppRole)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">Usuário</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowCreateDialog(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={isCreating}>
                  {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Criar Usuário
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Usuários</CardTitle>
          <CardDescription>
            Lista de todos os usuários cadastrados no sistema
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Nenhum usuário cadastrado
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuário</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Criado em</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">
                      {user.full_name || '-'}
                    </TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      {user.role === 'admin' ? (
                        <Badge variant="default" className="gap-1">
                          <ShieldCheck className="h-3 w-3" />
                          Admin
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="gap-1">
                          <Shield className="h-3 w-3" />
                          Usuário
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {new Date(user.created_at).toLocaleDateString('pt-BR')}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleOpenPermissions(user)}
                        >
                          Permissões
                        </Button>
                        <Select
                          value={user.role}
                          onValueChange={(v) => handleUpdateRole(user.id, v as AppRole)}
                        >
                          <SelectTrigger className="w-28 h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="user">Usuário</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Permissions Dialog */}
      <Dialog open={showPermissionsDialog} onOpenChange={setShowPermissionsDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Permissões de Acesso</DialogTitle>
            <DialogDescription>
              Configure as permissões de {selectedUser?.email} para cada conexão de API
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {connections.length === 0 ? (
              <div className="text-center py-4 text-muted-foreground">
                Nenhuma conexão de API disponível
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Conexão</TableHead>
                    <TableHead className="text-center">Visualizar</TableHead>
                    <TableHead className="text-center">Sincronizar</TableHead>
                    <TableHead className="text-center">Gerenciar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {connections.map((conn) => (
                    <TableRow key={conn.id}>
                      <TableCell className="font-medium">{conn.name}</TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={getPermission(conn.id, 'can_view')}
                          onCheckedChange={(v) => handleTogglePermission(conn.id, 'can_view', v)}
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={getPermission(conn.id, 'can_sync')}
                          onCheckedChange={(v) => handleTogglePermission(conn.id, 'can_sync', v)}
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={getPermission(conn.id, 'can_manage')}
                          onCheckedChange={(v) => handleTogglePermission(conn.id, 'can_manage', v)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setShowPermissionsDialog(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
