import { FileCheck2 } from 'lucide-react';
import { AnimatedPage } from '@/components/AnimatedPage';
import { Badge, Card, EmptyState } from '@/components/ui';

export function FiscalPage() {
  return <AnimatedPage>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-extrabold text-slate-800">Notas fiscais</h1>
      <Badge color="amber">Em breve</Badge>
    </div>
    <Card><EmptyState icon={<FileCheck2 className="h-8 w-8" />} title="Notas fiscais — Em breve" subtitle="A emissão de notas fiscais ainda não está disponível. Avisaremos quando este recurso for liberado." /></Card>
  </AnimatedPage>;
}
