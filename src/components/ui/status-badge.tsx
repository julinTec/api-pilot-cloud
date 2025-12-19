import { cn } from '@/lib/utils';

interface StatusBadgeProps {
  status: 'active' | 'paused' | 'error' | 'success' | 'pending' | 'running';
  className?: string;
}

const statusConfig = {
  active: { label: 'Ativo', className: 'bg-success/20 text-success border-success/30' },
  paused: { label: 'Pausado', className: 'bg-muted text-muted-foreground border-border' },
  error: { label: 'Erro', className: 'bg-destructive/20 text-destructive border-destructive/30' },
  success: { label: 'Sucesso', className: 'bg-success/20 text-success border-success/30' },
  pending: { label: 'Pendente', className: 'bg-warning/20 text-warning border-warning/30' },
  running: { label: 'Executando', className: 'bg-primary/20 text-primary border-primary/30 animate-pulse' },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        config.className,
        className
      )}
    >
      <span className={cn(
        'h-1.5 w-1.5 rounded-full',
        status === 'active' || status === 'success' ? 'bg-success' :
        status === 'error' ? 'bg-destructive' :
        status === 'running' ? 'bg-primary' :
        status === 'pending' ? 'bg-warning' :
        'bg-muted-foreground'
      )} />
      {config.label}
    </span>
  );
}
