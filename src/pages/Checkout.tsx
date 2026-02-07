import { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CreditCard, Wallet, Loader2, ArrowLeft, CheckCircle, XCircle, Clock } from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useCart } from '@/contexts/CartContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type PaymentMethod = 'mercadopago' | 'card';

const Checkout = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { items, totalPrice, clearCart } = useCart();
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('mercadopago');
  const [loading, setLoading] = useState(false);
  const [payerInfo, setPayerInfo] = useState({
    name: '',
    email: '',
    phone: '',
  });

  // Handle payment status from redirect
  const paymentStatus = searchParams.get('payment');

  useEffect(() => {
    if (paymentStatus === 'success') {
      clearCart();
      toast.success('¡Pago realizado con éxito!');
    } else if (paymentStatus === 'failure') {
      toast.error('El pago fue rechazado. Intenta nuevamente.');
    } else if (paymentStatus === 'pending') {
      toast.info('Tu pago está pendiente de confirmación.');
    }
  }, [paymentStatus, clearCart]);

  // Show payment result if redirected
  if (paymentStatus) {
    return (
      <>
        <Helmet>
          <title>Resultado del Pago - NicTech</title>
        </Helmet>
        <Layout>
          <div className="min-h-[60vh] flex items-center justify-center">
            <div className="text-center max-w-md mx-auto p-8">
              {paymentStatus === 'success' && (
                <>
                  <CheckCircle className="h-20 w-20 text-green-500 mx-auto mb-6" />
                  <h1 className="text-2xl font-bold text-foreground mb-4">¡Pago Exitoso!</h1>
                  <p className="text-muted-foreground mb-8">
                    Tu pedido ha sido procesado correctamente. Recibirás un email con los detalles.
                  </p>
                </>
              )}
              {paymentStatus === 'failure' && (
                <>
                  <XCircle className="h-20 w-20 text-destructive mx-auto mb-6" />
                  <h1 className="text-2xl font-bold text-foreground mb-4">Pago Rechazado</h1>
                  <p className="text-muted-foreground mb-8">
                    No pudimos procesar tu pago. Por favor intenta con otro método de pago.
                  </p>
                </>
              )}
              {paymentStatus === 'pending' && (
                <>
                  <Clock className="h-20 w-20 text-yellow-500 mx-auto mb-6" />
                  <h1 className="text-2xl font-bold text-foreground mb-4">Pago Pendiente</h1>
                  <p className="text-muted-foreground mb-8">
                    Tu pago está siendo procesado. Te notificaremos cuando se confirme.
                  </p>
                </>
              )}
              <Button onClick={() => navigate('/tienda')} size="lg">
                Volver a la Tienda
              </Button>
            </div>
          </div>
        </Layout>
      </>
    );
  }

  // Redirect if cart is empty
  if (items.length === 0) {
    return (
      <>
        <Helmet>
          <title>Checkout - NicTech</title>
        </Helmet>
        <Layout>
          <div className="min-h-[60vh] flex items-center justify-center">
            <div className="text-center">
              <h1 className="text-2xl font-bold text-foreground mb-4">Tu carrito está vacío</h1>
              <p className="text-muted-foreground mb-8">
                Agrega productos antes de proceder al pago.
              </p>
              <Button onClick={() => navigate('/tienda')} size="lg">
                Ir a la Tienda
              </Button>
            </div>
          </div>
        </Layout>
      </>
    );
  }

  const handleCheckout = async () => {
    if (!payerInfo.email) {
      toast.error('Por favor ingresa tu email');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-mercadopago-preference', {
        body: {
          items: items.map(item => ({
            id: item.id,
            name: item.name,
            price: item.price,
            quantity: item.quantity,
            image_url: item.image_url,
          })),
          payer: payerInfo,
        },
      });

      if (error) throw error;

      console.log('MercadoPago preference created:', data);

      // Redirect to MercadoPago checkout
      if (data.init_point) {
        window.location.href = data.init_point;
      } else {
        throw new Error('No se recibió URL de pago');
      }
    } catch (error) {
      console.error('Checkout error:', error);
      toast.error(error instanceof Error ? error.message : 'Error al procesar el pago. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Helmet>
        <title>Checkout - NicTech</title>
        <meta name="description" content="Finaliza tu compra de forma segura" />
      </Helmet>
      <Layout>
        <section className="py-12">
          <div className="container-main max-w-4xl">
            {/* Back button */}
            <Button
              variant="ghost"
              onClick={() => navigate('/tienda')}
              className="mb-8"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Volver a la Tienda
            </Button>

            <div className="grid lg:grid-cols-2 gap-8">
              {/* Order Summary */}
              <div className="bg-muted/30 rounded-2xl p-6 h-fit">
                <h2 className="text-xl font-bold mb-6">Resumen del Pedido</h2>

                <div className="space-y-4 mb-6">
                  {items.map((item) => (
                    <div key={item.id} className="flex gap-4">
                      <div className="h-16 w-16 rounded-lg bg-muted overflow-hidden flex-shrink-0">
                        {item.image_url ? (
                          <img
                            src={item.image_url}
                            alt={item.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="h-full w-full bg-muted" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{item.name}</p>
                        <p className="text-muted-foreground text-sm">
                          Cantidad: {item.quantity}
                        </p>
                        <p className="text-primary font-semibold">
                          $ {(item.price * item.quantity).toLocaleString('es-AR')}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-t border-border pt-4">
                  <div className="flex justify-between items-center text-lg font-bold">
                    <span>Total:</span>
                    <span className="text-primary">$ {totalPrice.toLocaleString('es-AR')}</span>
                  </div>
                </div>
              </div>

              {/* Payment Form */}
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold mb-6">Información de Contacto</h2>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="name">Nombre Completo</Label>
                      <Input
                        id="name"
                        value={payerInfo.name}
                        onChange={(e) => setPayerInfo(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="Tu nombre"
                      />
                    </div>
                    <div>
                      <Label htmlFor="email">Email *</Label>
                      <Input
                        id="email"
                        type="email"
                        required
                        value={payerInfo.email}
                        onChange={(e) => setPayerInfo(prev => ({ ...prev, email: e.target.value }))}
                        placeholder="tu@email.com"
                      />
                    </div>
                    <div>
                      <Label htmlFor="phone">Teléfono</Label>
                      <Input
                        id="phone"
                        type="tel"
                        value={payerInfo.phone}
                        onChange={(e) => setPayerInfo(prev => ({ ...prev, phone: e.target.value }))}
                        placeholder="+54 11 1234-5678"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <h2 className="text-xl font-bold mb-4">Método de Pago</h2>
                  <RadioGroup
                    value={paymentMethod}
                    onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}
                    className="space-y-3"
                  >
                    <div className="flex items-center space-x-3 p-4 rounded-xl border border-border hover:border-primary/50 transition-colors cursor-pointer">
                      <RadioGroupItem value="mercadopago" id="mercadopago" />
                      <Label htmlFor="mercadopago" className="flex items-center gap-3 cursor-pointer flex-1">
                        <Wallet className="h-5 w-5 text-[#009ee3]" />
                        <div>
                          <p className="font-medium">MercadoPago</p>
                          <p className="text-sm text-muted-foreground">
                            Paga con tu cuenta de MercadoPago o dinero en efectivo
                          </p>
                        </div>
                      </Label>
                    </div>

                    <div className="flex items-center space-x-3 p-4 rounded-xl border border-border hover:border-primary/50 transition-colors cursor-pointer">
                      <RadioGroupItem value="card" id="card" />
                      <Label htmlFor="card" className="flex items-center gap-3 cursor-pointer flex-1">
                        <CreditCard className="h-5 w-5 text-primary" />
                        <div>
                          <p className="font-medium">Tarjeta de Crédito o Débito</p>
                          <p className="text-sm text-muted-foreground">
                            Visa, Mastercard, American Express y más
                          </p>
                        </div>
                      </Label>
                    </div>
                  </RadioGroup>
                </div>

                <Button
                  onClick={handleCheckout}
                  disabled={loading}
                  size="lg"
                  className="w-full"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                      Procesando...
                    </>
                  ) : (
                    <>
                      Pagar $ {totalPrice.toLocaleString('es-AR')}
                    </>
                  )}
                </Button>

                <p className="text-xs text-muted-foreground text-center">
                  Al continuar, serás redirigido a MercadoPago para completar tu pago de forma segura.
                </p>
              </div>
            </div>
          </div>
        </section>
      </Layout>
    </>
  );
};

export default Checkout;
