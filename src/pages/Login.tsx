
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Lock, ArrowLeft } from 'lucide-react';
import { Helmet } from 'react-helmet-async';

const Login = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();
    const { toast } = useToast();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error) {
            toast({
                title: 'Error de inicio de sesión',
                description: error.message === 'Invalid login credentials'
                    ? 'Credenciales inválidas. Por favor verifica tu correo y contraseña.'
                    : error.message,
                variant: 'destructive',
            });
        } else {
            toast({
                title: 'Bienvenido',
                description: 'Has iniciado sesión correctamente.',
            });
            navigate('/admin');
        }

        setLoading(false);
    };

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

                        <Button type="submit" className="w-full" disabled={loading}>
                            {loading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Ingresando...
                                </>
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
