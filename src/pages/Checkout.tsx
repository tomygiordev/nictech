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
  const { items, totalPrice, clearCart, validateCart, isValidating } = useCart();
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('mercadopago');
  const [loading, setLoading] = useState(false);
  const [initialValidationDone, setInitialValidationDone] = useState(false);
  const [payerInfo, setPayerInfo] = useState({
    name: '',
    email: '',
    phone: '',
    dni: '',
    address: '',
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

  // Validate cart on checkout page load (catch stale cached items)
  useEffect(() => {
    if (!paymentStatus && items.length > 0 && !initialValidationDone) {
      validateCart().then(({ removedItems, adjustedItems }) => {
        setInitialValidationDone(true);
        if (removedItems.length > 0) {
          toast.error(`Productos sin stock removidos: ${removedItems.join(', ')}`);
        }
        if (adjustedItems.length > 0) {
          toast.info(`Stock ajustado para: ${adjustedItems.join(', ')}`);
        }
      });
    }
  }, []);

  // Show payment result if redirected
  if (paymentStatus) {
    return (
      <>
        <Helmet>
          <title>Resultado del Pago - Nictech</title>
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
          <title>Checkout - Nictech</title>
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
    if (!payerInfo.name || !payerInfo.email || !payerInfo.phone || !payerInfo.dni || !payerInfo.address) {
      toast.error('Por favor completa todos los campos obligatorios');
      return;
    }

    setLoading(true);
    try {
      // ── Final stock validation before payment ──
      const { removedItems, adjustedItems } = await validateCart();

      if (removedItems.length > 0) {
        toast.error(`Algunos productos se agotaron y fueron removidos: ${removedItems.join(', ')}. Revisa tu carrito.`);
        setLoading(false);
        return;
      }

      if (adjustedItems.length > 0) {
        toast.info(`Se ajustó la cantidad de: ${adjustedItems.join(', ')}. Revisa antes de pagar.`);
        setLoading(false);
        return;
      }

      // All stock is valid — proceed with payment
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
          origin: window.location.origin,
        },
      });

      if (error) throw error;

      // Redirect to MercadoPago checkout
      if (data.init_point) {
        window.location.href = data.init_point;
      } else {
        throw new Error('No se recibió URL de pago');
      }
    } catch (error: any) {
      console.error('Checkout error object:', error);

      let errorMessage = 'Error al procesar el pago. Intenta nuevamente.';

      if (typeof error === 'object' && error !== null) {
        // Avoid exposing raw database or network error messages to the client
        // if (error.message) errorMessage = error.message;

        try {
          if (error.context && typeof error.context.json === 'function') {
            const body = await error.context.json();
            console.error('Checkout error body:', body);
            // We intentionally do NOT set errorMessage = body.error here to prevent exposing backend/MP logs
          }
        } catch (e) {
          console.error('Error parsing error context:', e);
        }
      }

      toast.error(`Error: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Helmet>
        <title>Checkout - Nictech</title>
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

            <div className="flex flex-col-reverse lg:grid lg:grid-cols-12 gap-8">
              {/* Payment Form */}
              <div className="lg:col-span-7 space-y-6">
                <div className="bg-card rounded-2xl p-6 border border-border">
                  <h2 className="text-xl font-bold mb-6">Información de Contacto</h2>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="name">Nombre Completo *</Label>
                      <Input
                        id="name"
                        required
                        value={payerInfo.name}
                        onChange={(e) => setPayerInfo(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="Tu nombre completo"
                      />
                    </div>
                    <div>
                      <Label htmlFor="dni">DNI / CUIL *</Label>
                      <Input
                        id="dni"
                        required
                        type="text"
                        value={payerInfo.dni}
                        onChange={(e) => setPayerInfo(prev => ({ ...prev, dni: e.target.value }))}
                        placeholder="Sin puntos ni espacios"
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
                      <Label htmlFor="phone">Teléfono / WhatsApp *</Label>
                      <Input
                        id="phone"
                        type="tel"
                        required
                        value={payerInfo.phone}
                        onChange={(e) => setPayerInfo(prev => ({ ...prev, phone: e.target.value }))}
                        placeholder="+54 9 11 1234-5678"
                      />
                    </div>
                    <div>
                      <Label htmlFor="address">Dirección de Envío o Facturación *</Label>
                      <Input
                        id="address"
                        type="text"
                        required
                        value={payerInfo.address}
                        onChange={(e) => setPayerInfo(prev => ({ ...prev, address: e.target.value }))}
                        placeholder="Calle, Número, Localidad, Provincia"
                      />
                    </div>
                  </div>

                  <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                    <h3 className="text-sm font-semibold text-blue-500 mb-1">¡Importante sobre los envíos!</h3>
                    <p className="text-xs text-muted-foreground">
                      El monto a pagar no incluye costos de envío. Al finalizar tu compra nos pondremos en contacto con vos al número o email que proporcionaste para coordinar el método de entrega y los costos asociados según tu localidad.
                    </p>
                  </div>
                </div>
              </div>

              {/* Order Summary */}
              <div className="lg:col-span-5">
                <div className="bg-muted/30 rounded-2xl p-6 h-fit lg:sticky lg:top-24 space-y-6">
                  <h2 className="text-xl font-bold">Resumen del Pedido</h2>

                  <div className="space-y-4">
                    {items.map((item) => (
                      <div key={item.id} className="flex gap-4">
                        <div className="h-16 w-16 rounded-lg bg-background border overflow-hidden flex-shrink-0">
                          {item.image_url ? (
                            <img
                              src={item.image_url}
                              alt={item.name}
                              loading="lazy"
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

                  <div className="pt-2">
                    <h3 className="font-bold mb-3">Método de Pago</h3>
                    <RadioGroup
                      value={paymentMethod}
                      onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}
                      className="space-y-3"
                    >
                      <div className="flex items-center space-x-3 p-4 rounded-xl border border-primary/50 bg-primary/5 transition-colors cursor-pointer">
                        <RadioGroupItem value="mercadopago" id="mercadopago" />
                        <Label htmlFor="mercadopago" className="flex items-center gap-3 cursor-pointer flex-1">
                          <Wallet className="h-5 w-5 text-[#009ee3]" />
                          <div>
                            <p className="font-medium">Mercado Pago</p>
                            <p className="text-xs text-muted-foreground">
                              Tarjetas o saldo. Serás redirigido.
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
                    className="w-full h-12 text-base"
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
                    Podrás ingresar los datos de tu tarjeta una vez que inicies sesión en tu cuenta de MercadoPago.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </Layout>
    </>
  );
};

export default Checkout;
