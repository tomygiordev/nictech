import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Search, Loader2, AlertCircle, Smartphone, Calendar, FileText } from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { RepairTimeline } from '@/components/tracking/RepairTimeline';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface Repair {
  id: string;
  tracking_code: string;
  client_dni: string;
  client_name: string | null;
  device_model: string;
  device_brand: string | null;
  status: string;
  notes: string | null;
  created_at: string;
}

const Seguimiento = () => {
  const [searchValue, setSearchValue] = useState('');
  const [repair, setRepair] = useState<Repair | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!searchValue.trim()) {
      toast({
        title: 'Campo requerido',
        description: 'Por favor ingresa tu DNI o código de reparación',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    setSearched(true);

    const { data, error } = await supabase
      .from('repairs')
      .select('*')
      .or(`client_dni.eq.${searchValue},tracking_code.ilike.%${searchValue}%`)
      .maybeSingle();

    if (error) {
      toast({
        title: 'Error',
        description: 'Ocurrió un error al buscar. Intenta de nuevo.',
        variant: 'destructive',
      });
    }

    setRepair(data);
    setLoading(false);
  };

  return (
    <>
      <Helmet>
        <title>Seguimiento de Reparación - NicTech</title>
        <meta name="description" content="Consulta el estado de tu reparación en tiempo real. Ingresa tu DNI o código de seguimiento." />
      </Helmet>
      <Layout>
        {/* Header */}
        <section className="bg-muted/50 py-12 lg:py-16">
          <div className="container-main">
            <div className="text-center max-w-2xl mx-auto">
              <span className="inline-block px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
                Seguimiento
              </span>
              <h1 className="text-3xl lg:text-4xl font-bold text-foreground mb-4">
                Consulta tu Reparación
              </h1>
              <p className="text-muted-foreground text-lg mb-8">
                Ingresa tu DNI o código de reparación para ver el estado actual de tu dispositivo
              </p>

              {/* Search Form */}
              <form onSubmit={handleSearch} className="flex gap-3 max-w-md mx-auto">
                <div className="relative flex-1">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="DNI o código (ej: REP-A1B2C3D4)"
                    value={searchValue}
                    onChange={(e) => setSearchValue(e.target.value)}
                    className="pl-12 h-12 rounded-xl"
                  />
                </div>
                <Button type="submit" size="lg" disabled={loading}>
                  {loading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    'Buscar'
                  )}
                </Button>
              </form>
            </div>
          </div>
        </section>

        {/* Results */}
        <section className="py-12 lg:py-16">
          <div className="container-main">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : searched && !repair ? (
              <div className="max-w-md mx-auto text-center py-12">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 mx-auto mb-4">
                  <AlertCircle className="h-8 w-8 text-destructive" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  No se encontró ninguna reparación
                </h3>
                <p className="text-muted-foreground">
                  Verifica que el DNI o código de reparación sea correcto e intenta de nuevo.
                </p>
              </div>
            ) : repair ? (
              <div className="max-w-3xl mx-auto animate-fade-in">
                {/* Repair Info Card */}
                <div className="bg-card rounded-2xl border border-border p-6 lg:p-8 mb-8 shadow-card">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Código de seguimiento</p>
                      <h2 className="text-2xl font-bold text-primary">{repair.tracking_code}</h2>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-4 py-2 rounded-full text-sm font-medium ${
                        repair.status === 'Finalizado'
                          ? 'bg-success/10 text-success'
                          : 'bg-primary/10 text-primary'
                      }`}>
                        {repair.status}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="flex items-start gap-3 p-4 rounded-xl bg-muted/50">
                      <Smartphone className="h-5 w-5 text-primary mt-0.5" />
                      <div>
                        <p className="text-sm text-muted-foreground">Dispositivo</p>
                        <p className="font-medium text-foreground">
                          {repair.device_brand} {repair.device_model}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-4 rounded-xl bg-muted/50">
                      <Calendar className="h-5 w-5 text-primary mt-0.5" />
                      <div>
                        <p className="text-sm text-muted-foreground">Fecha de ingreso</p>
                        <p className="font-medium text-foreground">
                          {new Date(repair.created_at).toLocaleDateString('es-PE', {
                            day: '2-digit',
                            month: 'long',
                            year: 'numeric',
                          })}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-4 rounded-xl bg-muted/50">
                      <FileText className="h-5 w-5 text-primary mt-0.5" />
                      <div>
                        <p className="text-sm text-muted-foreground">Cliente</p>
                        <p className="font-medium text-foreground">{repair.client_name || 'N/A'}</p>
                      </div>
                    </div>
                  </div>

                  {repair.notes && (
                    <div className="mt-6 p-4 rounded-xl bg-muted/50">
                      <p className="text-sm text-muted-foreground mb-1">Notas</p>
                      <p className="text-foreground">{repair.notes}</p>
                    </div>
                  )}
                </div>

                {/* Timeline */}
                <div className="bg-card rounded-2xl border border-border p-6 lg:p-8 shadow-card">
                  <h3 className="text-lg font-semibold text-foreground mb-8">Estado de la Reparación</h3>
                  <RepairTimeline currentStatus={repair.status} />
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </Layout>
    </>
  );
};

export default Seguimiento;
