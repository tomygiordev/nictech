import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';

export const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { session, loading } = useAuth();
  const [verifying, setVerifying] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (loading) return;

    if (!session) {
      setVerifying(false);
      return;
    }

    // If role is already in the JWT, use it directly
    if (session.user.app_metadata?.role === 'admin') {
      setIsAdmin(true);
      setVerifying(false);
      return;
    }

    // JWT might be stale — refresh once to get the latest app_metadata from DB
    supabase.auth.refreshSession().then(({ data }) => {
      setIsAdmin(data.session?.user.app_metadata?.role === 'admin');
      setVerifying(false);
    }).catch(() => {
      setVerifying(false);
    });
  }, [session, loading]);

  if (loading || verifying) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};
