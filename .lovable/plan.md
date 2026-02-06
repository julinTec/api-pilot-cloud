
# Plano: Sistema de Autenticação, Gestão de Usuários e Integração com Arquivos

## Resumo das Funcionalidades

Este plano implementa:
1. **Tela de Login** - Autenticação com email/senha antes de acessar o sistema
2. **Gestão de Usuários (Admin)** - Criar/gerenciar usuários e controlar permissões de APIs
3. **Você como Admin único** - julio.cezar@redebloom.com.br terá papel de administrador
4. **Integração com Arquivos Externos** - Upload de Excel, Parquet com metadados descritivos

---

## Parte 1: Estrutura de Banco de Dados

### 1.1 Criar tabela de perfis de usuário
```sql
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Usuários podem ver/editar apenas seu próprio perfil
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);
```

### 1.2 Criar sistema de roles (funções)
```sql
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Função para verificar role (security definer evita recursão)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Admins podem ver todas as roles
CREATE POLICY "Admins can view all roles" ON public.user_roles
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- Admins podem gerenciar roles
CREATE POLICY "Admins can manage roles" ON public.user_roles
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));
```

### 1.3 Criar tabela de permissões de conexões por usuário
```sql
CREATE TABLE public.user_connection_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  connection_id UUID REFERENCES api_connections(id) ON DELETE CASCADE NOT NULL,
  can_view BOOLEAN DEFAULT true,
  can_sync BOOLEAN DEFAULT false,
  can_manage BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, connection_id)
);

ALTER TABLE public.user_connection_access ENABLE ROW LEVEL SECURITY;

-- Admins podem ver/gerenciar todas permissões
CREATE POLICY "Admins can manage access" ON public.user_connection_access
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Usuários podem ver suas próprias permissões
CREATE POLICY "Users can view own access" ON public.user_connection_access
  FOR SELECT USING (user_id = auth.uid());
```

### 1.4 Criar tabela para arquivos externos
```sql
CREATE TABLE public.file_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  file_type TEXT NOT NULL, -- 'excel', 'parquet', 'csv'
  file_path TEXT NOT NULL,
  file_size_bytes BIGINT,
  column_mapping JSONB DEFAULT '{}'::jsonb, -- mapeamento de colunas
  metadata JSONB DEFAULT '{}'::jsonb, -- metadados adicionais
  status TEXT DEFAULT 'pending', -- 'pending', 'processing', 'ready', 'error'
  records_count INTEGER DEFAULT 0,
  last_processed_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.file_sources ENABLE ROW LEVEL SECURITY;

-- Admins podem gerenciar todos os arquivos
CREATE POLICY "Admins can manage files" ON public.file_sources
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Usuários podem ver arquivos que criaram
CREATE POLICY "Users can view own files" ON public.file_sources
  FOR SELECT USING (created_by = auth.uid());
```

### 1.5 Criar storage bucket para arquivos
```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('file-sources', 'file-sources', false);

-- Admins podem fazer upload
CREATE POLICY "Admins can upload files" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'file-sources' AND 
    public.has_role(auth.uid(), 'admin')
  );

-- Admins podem ler arquivos
CREATE POLICY "Admins can read files" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'file-sources' AND 
    public.has_role(auth.uid(), 'admin')
  );
```

### 1.6 Trigger para criar perfil automaticamente
```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name');
  
  -- Se for o admin principal, adiciona role admin
  IF NEW.email = 'julio.cezar@redebloom.com.br' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

---

## Parte 2: Componentes Frontend

### 2.1 Página de Login (`src/pages/Auth.tsx`)
- Formulário com email e senha
- Opção de "Esqueci minha senha"
- Design consistente com o tema do sistema
- Redirecionamento após login bem-sucedido

### 2.2 Hook de Autenticação (`src/hooks/useAuth.ts`)
- Gerenciar estado de autenticação
- Verificar sessão ativa
- Funções de login, logout, recuperação de senha
- Verificar role do usuário (admin ou user)

### 2.3 Proteção de Rotas (`src/components/auth/ProtectedRoute.tsx`)
- Wrapper para rotas que exigem autenticação
- Redirecionamento automático para login
- Verificação de permissões por role

### 2.4 Página de Gestão de Usuários (`src/pages/Users.tsx`) - Somente Admin
- Listar todos os usuários
- Criar novos usuários (com senha temporária)
- Atribuir/remover roles
- Configurar permissões de acesso a APIs/conexões
- Ativar/desativar usuários

### 2.5 Página de Integrações de Arquivos (`src/pages/FileIntegrations.tsx`)
- Upload de arquivos Excel, CSV, Parquet
- Formulário com campos:
  - Nome da integração
  - Descrição/referência
  - Tipo de arquivo
  - Mapeamento de colunas (opcional)
  - Tags/categorias
- Preview dos dados do arquivo
- Status de processamento
- Histórico de importações

### 2.6 Componente de Upload de Arquivo (`src/components/files/FileUploader.tsx`)
- Drag & drop
- Validação de tipos (xlsx, xls, csv, parquet)
- Progress bar
- Preview das primeiras linhas

---

## Parte 3: Edge Function para Processar Arquivos

### 3.1 `supabase/functions/process-file/index.ts`
- Receber arquivo do storage
- Detectar tipo e parsear:
  - Excel: usar biblioteca para ler
  - CSV: parsing direto
  - Parquet: conversão para JSON
- Salvar dados processados em tabela dedicada
- Atualizar status do file_source

---

## Parte 4: Atualizações no Sistema Existente

### 4.1 Atualizar App.tsx
- Adicionar rota `/auth` para login
- Envolver rotas em `ProtectedRoute`
- Adicionar rota `/users` (admin only)
- Adicionar rota `/files` para integrações de arquivos

### 4.2 Atualizar AppSidebar.tsx
- Mostrar item "Usuários" apenas para admins
- Adicionar item "Arquivos" no menu
- Mostrar nome/email do usuário logado
- Botão de logout

### 4.3 Atualizar AppLayout.tsx
- Mostrar informações do usuário no header
- Botão de logout

### 4.4 Atualizar RLS das tabelas existentes
- `api_connections`: Verificar permissão do usuário
- `extraction_logs`: Filtrar por conexões permitidas
- Outras tabelas de dados: Aplicar filtro de acesso

---

## Parte 5: Fluxo de Uso

```text
┌─────────────────────────────────────────────────────────────────┐
│                    FLUXO DE AUTENTICAÇÃO                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Usuário acessa                                                 │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────┐    Não autenticado    ┌─────────────┐             │
│  │ Sistema │ ────────────────────► │ Tela Login  │             │
│  └─────────┘                       └──────┬──────┘             │
│       │                                   │                     │
│  Autenticado                         Login OK                   │
│       │                                   │                     │
│       ▼                                   ▼                     │
│  ┌─────────────────────────────────────────────────────┐       │
│  │                  SISTEMA PRINCIPAL                   │       │
│  ├─────────────────────────────────────────────────────┤       │
│  │                                                      │       │
│  │  Admin (julio.cezar@redebloom.com.br):             │       │
│  │  • Dashboard, Integrações, Logs, Dados, Endpoints  │       │
│  │  • Usuários (criar/gerenciar)                       │       │
│  │  • Arquivos (upload/importar)                       │       │
│  │  • SysEduca                                          │       │
│  │                                                      │       │
│  │  Usuário comum:                                      │       │
│  │  • Apenas conexões/dados com permissão              │       │
│  │  • Sem acesso a gestão de usuários                  │       │
│  │                                                      │       │
│  └─────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Detalhes Técnicos

### Estrutura de Arquivos a Criar
```text
src/
├── components/
│   ├── auth/
│   │   └── ProtectedRoute.tsx
│   └── files/
│       ├── FileUploader.tsx
│       └── FileSourceCard.tsx
├── hooks/
│   └── useAuth.ts
├── pages/
│   ├── Auth.tsx
│   ├── Users.tsx
│   └── FileIntegrations.tsx
└── types/
    └── auth.ts (tipos para roles e permissões)

supabase/
└── functions/
    └── process-file/
        └── index.ts
```

### Bibliotecas Necessárias
- Nenhuma nova biblioteca necessária para autenticação (Supabase já inclui)
- Para arquivos Excel: processamento será feito na edge function com Deno

---

## Sequência de Implementação

1. **Banco de dados**: Criar todas as tabelas, roles, policies e triggers
2. **Hook useAuth**: Lógica de autenticação e verificação de roles
3. **Página Auth**: Tela de login
4. **ProtectedRoute**: Proteção de rotas
5. **Atualizar App.tsx e Layout**: Integrar autenticação
6. **Página Users**: Gestão de usuários (admin)
7. **Upload de arquivos**: Componentes e página
8. **Edge function**: Processamento de arquivos
9. **Configurar admin**: Garantir que seu email receba role admin

---

## Resultado Final

Após implementação:
- ✅ Sistema exigirá login para qualquer acesso
- ✅ Você (julio.cezar@redebloom.com.br) será o único admin
- ✅ Poderá criar usuários e controlar quais APIs cada um acessa
- ✅ Nova seção para importar arquivos Excel, CSV, Parquet com descrições
- ✅ Dados de arquivos externos ficarão disponíveis para consulta
