import { useState, useEffect, useRef } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CreditCard, Wallet, Loader2, ArrowLeft, CheckCircle, XCircle, Clock, MapPin, Truck } from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useCart, type AuthoritativeCartPrice } from '@/contexts/CartContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { checkoutPayerSchema } from '@/lib/checkout-payer';

type PaymentMethod = 'mercadopago' | 'card';
type DeliveryMethod = 'pickup_urdinarrain' | 'pickup_gilbert' | 'shipping';
type PayerField = keyof typeof checkoutPayerSchema.shape;

const PICKUP_BRANCH_ADDRESSES: Record<Exclude<DeliveryMethod, 'shipping'>, string> = {
  pickup_urdinarrain: 'Retiro en sucursal Urdinarrain (Héroes de Malvinas 08)',
  pickup_gilbert: 'Retiro en sucursal Gilbert (C.5 y C.19)',
};

const Checkout = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { items, totalPrice, clearCart, validateCart, applyAuthoritativePrices, isValidating } = useCart();
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('mercadopago');
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('pickup_urdinarrain');
  const [loading, setLoading] = useState(false);
  const checkoutIdRef = useRef(crypto.randomUUID());
  const [initialValidationDone, setInitialValidationDone] = useState(false);
  const [payerInfo, setPayerInfo] = useState({
    name: '',
    email: '',
    phone: '',
    dni: '',
    address: '',
  });
  const [payerErrors, setPayerErrors] = useState<Partial<Record<PayerField, string[]>>>({});

  const updatePayer = (field: PayerField, value: string) => {
    setPayerInfo((previous) => ({ ...previous, [field]: value }));
    setPayerErrors((previous) => ({ ...previous, [field]: undefined }));
  };

  const errorProps = (field: PayerField) => payerErrors[field]
    ? { 'aria-invalid': true, 'aria-describedby': `${field}-error` }
    : {};

  const fieldError = (field: PayerField) => payerErrors[field]?.[0] && (
    <p className="mt-1 text-sm text-destructive" id={`${field}-error`} role="alert">
      {payerErrors[field][0]}
    </p>
  );

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
      validateCart().then(({ removedItems, adjustedItems, validationError }) => {
        setInitialValidationDone(true);
        if (validationError) toast.error(validationError);
        if (removedItems.length > 0) {
          toast.error(`Productos sin stock removidos: ${removedItems.join(', ')}`);
        }
        if (adjustedItems.length > 0) {
          toast.info(`Se actualizó el precio o la cantidad de: ${adjustedItems.join(', ')}. Revisá antes de pagar.`);
        }
      });
    }
  }, [initialValidationDone, items.length, paymentStatus, validateCart]);

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
    const addressNote = payerInfo.address.trim();
    const resolvedAddress =
      deliveryMethod === 'shipping'
        ? addressNote
        : addressNote
          ? `${PICKUP_BRANCH_ADDRESSES[deliveryMethod]} (${addressNote})`
          : PICKUP_BRANCH_ADDRESSES[deliveryMethod];

    const payer = checkoutPayerSchema.safeParse({ ...payerInfo, address: resolvedAddress });
    if (!payer.success) {
      setPayerErrors(payer.error.flatten().fieldErrors);
      document.getElementById(String(payer.error.issues[0]?.path[0]))?.focus();
      return;
    }
    setPayerErrors({});
    setLoading(true);
    try {
      // ── Final stock validation before payment ──
      const { removedItems, adjustedItems, validationError } = await validateCart();

      if (validationError) {
        toast.error(validationError);
        return;
      }

      if (removedItems.length > 0) {
        toast.error(`Algunos productos se agotaron y fueron removidos: ${removedItems.join(', ')}. Revisa tu carrito.`);
        setLoading(false);
        return;
      }

      if (adjustedItems.length > 0) {
        toast.info(`Se actualizó el precio o la cantidad de: ${adjustedItems.join(', ')}. Revisá antes de pagar.`);
        setLoading(false);
        return;
      }

      // All stock is valid — proceed with payment
      const { data, error } = await supabase.functions.invoke('create-mercadopago-preference', {
        body: {
          checkout_id: checkoutIdRef.current,
          expected_total: totalPrice,
          items: items.map(item => ({
            id: item.id,
            variant_id: item.variant?.id ?? null,
            quantity: item.quantity,
            image_url: item.image_url,
          })),
          payer: payer.data,
          origin: window.location.origin,
        },
      });

      if (error) throw error;

      if (typeof data.total === 'number' && Math.round(data.total * 100) !== Math.round(totalPrice * 100)) {
        checkoutIdRef.current = crypto.randomUUID();
        const refreshed = await validateCart();
        if (refreshed.validationError) {
          toast.error(refreshed.validationError);
          return;
        }
        toast.info('El precio cambió. Revisá el total actualizado antes de pagar.');
        return;
      }

      // Redirect to MercadoPago checkout
      if (data.init_point) {
        window.location.href = data.init_point;
      } else {
        throw new Error('No se recibió URL de pago');
      }
    } catch (error: unknown) {
      console.error('Checkout error object:', error);

      let errorMessage = 'No se pudo iniciar el pago. Intentá nuevamente o contactá al local.';
      if (typeof error === 'object' && error !== null && 'context' in error && error.context instanceof Response) {
        try {
          const body: unknown = await error.context.json();
          if (error.context.status === 409 && body && typeof body === 'object' && 'items' in body && Array.isArray(body.items)) {
            const prices: AuthoritativeCartPrice[] = [];
            for (const item of body.items as unknown[]) {
              if (!item || typeof item !== 'object' || !('product_id' in item) || typeof item.product_id !== 'string' ||
                !('variant_id' in item) || (item.variant_id !== null && typeof item.variant_id !== 'string') ||
                !('unit_price' in item) || typeof item.unit_price !== 'number') {
                throw new Error('Respuesta de precios inválida');
              }
              prices.push({
                product_id: item.product_id,
                variant_id: typeof item.variant_id === 'string' ? item.variant_id : null,
                unit_price: item.unit_price,
              });
            }
            if (!applyAuthoritativePrices(prices)) throw new Error('El carrito cambió durante la validación');
            checkoutIdRef.current = crypto.randomUUID();
            toast.info('El precio cambió. Revisá el total actualizado antes de pagar.');
            return;
          }
          const safeMessages = new Set([
            'No se pudo obtener el precio vigente. Intentá nuevamente o contactá al local.',
            'El precio del producto tiene más de dos decimales o está fuera de rango. Contactá al local.',
            'Los pagos están momentáneamente pausados. Intentá nuevamente en unos minutos.',
          ]);
          if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' && safeMessages.has(body.error)) {
            errorMessage = body.error;
          }
        } catch (parseError) {
          console.error('Error parsing error context:', parseError);
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

            <div className="flex flex-col lg:grid lg:grid-cols-12 gap-8">
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
                        {...errorProps('name')}
                        value={payerInfo.name}
                        onChange={(e) => updatePayer('name', e.target.value)}
                        placeholder="Tu nombre completo"
                      />
                      {fieldError('name')}
                    </div>
                    <div>
                      <Label htmlFor="dni">DNI / CUIL *</Label>
                      <Input
                        id="dni"
                        required
                        type="text"
                        {...errorProps('dni')}
                        value={payerInfo.dni}
                        onChange={(e) => updatePayer('dni', e.target.value)}
                        placeholder="Sin puntos ni espacios"
                      />
                      {fieldError('dni')}
                    </div>
                    <div>
                      <Label htmlFor="email">Email *</Label>
                      <Input
                        id="email"
                        type="email"
                        required
                        {...errorProps('email')}
                        value={payerInfo.email}
                        onChange={(e) => updatePayer('email', e.target.value)}
                        placeholder="tu@email.com"
                      />
                      {fieldError('email')}
                    </div>
                    <div>
                      <Label htmlFor="phone">Teléfono / WhatsApp *</Label>
                      <Input
                        id="phone"
                        type="tel"
                        required
                        {...errorProps('phone')}
                        value={payerInfo.phone}
                        onChange={(e) => updatePayer('phone', e.target.value)}
                        placeholder="+54 9 11 1234-5678"
                      />
                      {fieldError('phone')}
                    </div>
                    <div className="pt-4 border-t border-border/60">
                      <Label className="text-base font-semibold mb-3 block">Modalidad de Entrega *</Label>
                      <RadioGroup
                        value={deliveryMethod}
                        onValueChange={(value) => setDeliveryMethod(value as DeliveryMethod)}
                        className="space-y-2.5"
                      >
                        <label
                          htmlFor="delivery-urdinarrain"
                          className={`flex items-start gap-3 p-3.5 rounded-xl border transition-colors cursor-pointer ${
                            deliveryMethod === 'pickup_urdinarrain'
                              ? 'border-primary bg-primary/5'
                              : 'border-border hover:border-primary/40'
                          }`}
                        >
                          <RadioGroupItem value="pickup_urdinarrain" id="delivery-urdinarrain" className="mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-medium text-sm text-foreground flex items-center gap-1.5">
                                <MapPin className="h-4 w-4 text-primary shrink-0" />
                                Retiro en sucursal Urdinarrain
                              </span>
                              <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                                Gratis
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Héroes de Malvinas 08, Entre Ríos
                            </p>
                          </div>
                        </label>

                        <label
                          htmlFor="delivery-gilbert"
                          className={`flex items-start gap-3 p-3.5 rounded-xl border transition-colors cursor-pointer ${
                            deliveryMethod === 'pickup_gilbert'
                              ? 'border-primary bg-primary/5'
                              : 'border-border hover:border-primary/40'
                          }`}
                        >
                          <RadioGroupItem value="pickup_gilbert" id="delivery-gilbert" className="mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-medium text-sm text-foreground flex items-center gap-1.5">
                                <MapPin className="h-4 w-4 text-primary shrink-0" />
                                Retiro en sucursal Gilbert
                              </span>
                              <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                                Gratis
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              C.5 y C.19, Entre Ríos
                            </p>
                          </div>
                        </label>

                        <label
                          htmlFor="delivery-shipping"
                          className={`flex items-start gap-3 p-3.5 rounded-xl border transition-colors cursor-pointer ${
                            deliveryMethod === 'shipping'
                              ? 'border-primary bg-primary/5'
                              : 'border-border hover:border-primary/40'
                          }`}
                        >
                          <RadioGroupItem value="shipping" id="delivery-shipping" className="mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <span className="font-medium text-sm text-foreground flex items-center gap-1.5">
                              <Truck className="h-4 w-4 text-primary shrink-0" />
                              Envío a domicilio (a todo el país)
                            </span>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Despacho en 24 a 48 hs hábiles · costo según correo y localidad
                            </p>
                          </div>
                        </label>
                      </RadioGroup>
                    </div>

                    <div>
                      <Label htmlFor="address">
                        {deliveryMethod === 'shipping'
                          ? 'Dirección de Envío (Calle, altura, localidad y provincia) *'
                          : 'Localidad o aclaraciones para el retiro (opcional)'}
                      </Label>
                      <Input
                        id="address"
                        type="text"
                        required={deliveryMethod === 'shipping'}
                        {...errorProps('address')}
                        value={payerInfo.address}
                        onChange={(e) => updatePayer('address', e.target.value)}
                        placeholder={
                          deliveryMethod === 'shipping'
                            ? 'Calle, altura, localidad, provincia'
                            : 'Opcional: horario estimado o quién retira'
                        }
                      />
                      {fieldError('address')}
                      {deliveryMethod !== 'shipping' && (
                        <p className="text-xs text-muted-foreground mt-1.5">
                          Retirás sin cargo en{' '}
                          {deliveryMethod === 'pickup_urdinarrain'
                            ? 'Héroes de Malvinas 08, Urdinarrain'
                            : 'C.5 y C.19, Gilbert'}
                          . Te avisamos por WhatsApp cuando esté listo.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                    <h3 className="text-sm font-semibold text-blue-600 dark:text-blue-400 mb-1">Información sobre entrega y envíos</h3>
                    <p className="text-xs text-muted-foreground">
                      {deliveryMethod === 'shipping'
                        ? 'El total abonado no incluye el costo del correo. Al acreditarse el pago, coordinamos con vos por WhatsApp o email el envío (despacho en 24 a 48 hs hábiles) y su seguimiento.'
                        : 'El retiro en nuestras sucursales de Urdinarrain y Gilbert es totalmente gratuito. Una vez acreditado el pago, te contactamos para confirmar que tu pedido está listo.'}
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
                      <div key={`${item.id}:${item.variant?.id ?? 'base'}`} className="flex gap-4">
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
                          {item.variant && (
                            <p className="text-muted-foreground text-xs">Color: {item.variant.color}</p>
                          )}
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
                    disabled={loading || isValidating}
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
