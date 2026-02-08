-- Create orders table
CREATE TABLE public.orders (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    payment_id TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, rejected, in_process
    total DECIMAL(10,2) NOT NULL,
    items JSONB, -- Store snapshot of items purchased
    payer JSONB, -- Store snapshot of payer info
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- Allow public insert (triggered by webhook or client) - actually webhook uses service role, checking policies
-- For now, let's allow authenticated users to see their orders if we had user_id.
-- Since we don't have auth enforced for purchases yet (guest checkout), we might keep it simple.
-- But the webhook usually runs with service_role key, bypassing RLS.

-- Policy for select (just in case we want to show it later)
CREATE POLICY "Orders are viewable by everyone" 
ON public.orders FOR SELECT USING (true);

-- Trigger for updated_at
CREATE TRIGGER update_orders_updated_at
BEFORE UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
