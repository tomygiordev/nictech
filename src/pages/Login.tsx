
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Lock, ArrowLeft } from 'lucide-react';
import { Helmet } from 'react-helmet-async';
import { useAuth } from '@/contexts/AuthContext';
import { useEffect } from 'react';

const Login = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();
    const { toast } = useToast();
    const { session, loading: authLoading } = useAuth();

    // Rate limiting state (client-side only — server-side rate limiting should also be configured in Supabase)
    const [failedAttempts, setFailedAttempts] = useState(0);
    const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);

    // Check lockout status on mount and when it changes
    useEffect(() => {
        const storedLockout = localStorage.getItem('loginLockoutUntil');
        if (storedLockout) {
            const lockoutTime = parseInt(storedLockout, 10);
            if (Date.now() < lockoutTime) {
                setLockoutUntil(lockoutTime);
            } else {
                localStorage.removeItem('loginLockoutUntil');
                setFailedAttempts(0);
            }
        }

        const storedAttempts = localStorage.getItem('loginFailedAttempts');
        if (storedAttempts) {
            setFailedAttempts(parseInt(storedAttempts, 10));
        }
    }, []);

    // Timer to clear lockout when it expires
    useEffect(() => {
        if (!lockoutUntil) return;

        const timeRemaining = lockoutUntil - Date.now();
        if (timeRemaining <= 0) {
            setLockoutUntil(null);
            setFailedAttempts(0);
            localStorage.removeItem('loginLockoutUntil');
            localStorage.removeItem('loginFailedAttempts');
            return;
        }

        const timer = setTimeout(() => {
            setLockoutUntil(null);
            setFailedAttempts(0);
            localStorage.removeItem('loginLockoutUntil');
            localStorage.removeItem('loginFailedAttempts');
        }, timeRemaining);

        return () => clearTimeout(timer);
    }, [lockoutUntil]);


    useEffect(() => {
        if (session) {
            navigate('/admin');
        }
    }, [session, navigate]);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();

        if (lockoutUntil && Date.now() < lockoutUntil) {
            const minutesLeft = Math.ceil((lockoutUntil - Date.now()) / 60000);
            toast({
                title: 'Demasiados intentos',
                description: `Has excedido el límite de intentos. Por favor intenta de nuevo en ${minutesLeft} minutos.`,
                variant: 'destructive',
            });
            return;
        }

        setLoading(true);

        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error) {
            const newAttempts = failedAttempts + 1;
            setFailedAttempts(newAttempts);
            localStorage.setItem('loginFailedAttempts', newAttempts.toString());

            if (newAttempts >= 5) {
                const lockoutTime = Date.now() + 5 * 60 * 1000; // 5 minutes
                setLockoutUntil(lockoutTime);
                localStorage.setItem('loginLockoutUntil', lockoutTime.toString());

                toast({
                    title: 'Cuenta bloqueada temporalmente',
                    description: 'Demasiados intentos fallidos. Por seguridad, espera 5 minutos antes de volver a intentar.',
                    variant: 'destructive',
                });
            } else {
                toast({
                    title: 'Error de inicio de sesión',
                    description: error.message === 'Invalid login credentials'
                        ? `Credenciales inválidas. Te quedan ${5 - newAttempts} intentos.`
                        : error.message,
                    variant: 'destructive',
                });
            }
        } else {
            // Reset on successful login
            setFailedAttempts(0);
            setLockoutUntil(null);
            localStorage.removeItem('loginLockoutUntil');
            localStorage.removeItem('loginFailedAttempts');
            toast({
                title: 'Bienvenido',
                description: 'Has iniciado sesión correctamente.',
            });
            navigate('/admin');
        }

        setLoading(false);
    };

    if (authLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <>
            <Helmet>
                <title>Iniciar Sesión - Nictech</title>
            </Helmet>
            <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
                <div className="w-full max-w-md space-y-8 bg-card p-8 rounded-2xl border border-border shadow-lg">
                    <div className="text-center space-y-2">
                        <div className="mx-auto bg-primary/10 w-12 h-12 flex items-center justify-center rounded-xl mb-4">
                            <Lock className="h-6 w-6 text-primary" />
                        </div>
                        <h2 className="text-2xl font-bold tracking-tight">Panel de Administración</h2>
                        <p className="text-muted-foreground text-sm">Ingresa tus credenciales para continuar</p>
                    </div>

                    <form onSubmit={handleLogin} className="space-y-6">
                        <div className="space-y-2">
                            <Label htmlFor="email">Correo Electrónico</Label>
                            <Input
                                id="email"
                                type="email"
                                placeholder="admin@nictech.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                className="bg-background"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="password">Contraseña</Label>
                            <Input
                                id="password"
                                type="password"
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                className="bg-background"
                            />
                        </div>

                        <Button type="submit" className="w-full" disabled={loading || (lockoutUntil !== null && Date.now() < lockoutUntil)}>
                            {loading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Ingresando...
                                </>
                            ) : lockoutUntil && Date.now() < lockoutUntil ? (
                                'Acesso Bloqueado'
                            ) : (
                                'Iniciar Sesión'
                            )}
                        </Button>
                    </form>

                    <div className="pt-4 text-center">
                        <Button variant="link" onClick={() => navigate('/')} className="text-muted-foreground">
                            <ArrowLeft className="mr-2 h-4 w-4" />
                            Volver al inicio
                        </Button>
                    </div>
                </div>
            </div>
        </>
    );
};

export default Login;
