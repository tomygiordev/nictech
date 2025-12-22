-- Create products table
CREATE TABLE public.products (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    image_url TEXT,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create repair status enum
CREATE TYPE public.repair_status AS ENUM ('Recibido', 'Diagnóstico', 'Repuestos', 'Reparación', 'Finalizado');

-- Create repairs table
CREATE TABLE public.repairs (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tracking_code TEXT NOT NULL UNIQUE DEFAULT 'REP-' || UPPER(SUBSTRING(gen_random_uuid()::text, 1, 8)),
    client_dni TEXT NOT NULL,
    client_name TEXT,
    client_phone TEXT,
    device_model TEXT NOT NULL,
    device_brand TEXT,
    status repair_status NOT NULL DEFAULT 'Recibido',
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repairs ENABLE ROW LEVEL SECURITY;

-- Products are publicly readable (for the shop)
CREATE POLICY "Products are publicly readable" 
ON public.products 
FOR SELECT 
USING (true);

-- Repairs are publicly readable (for tracking)
CREATE POLICY "Repairs are publicly readable for tracking" 
ON public.repairs 
FOR SELECT 
USING (true);

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create triggers for automatic timestamp updates
CREATE TRIGGER update_products_updated_at
BEFORE UPDATE ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_repairs_updated_at
BEFORE UPDATE ON public.repairs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert sample products
INSERT INTO public.products (name, category, price, stock, description, image_url) VALUES
('iPhone 14 Pro Max', 'Smartphones', 1299.99, 15, 'El último iPhone con chip A16 Bionic y Dynamic Island', 'https://images.unsplash.com/photo-1678685888221-cda773a3dcdb?w=400'),
('MacBook Pro 14"', 'Laptops', 1999.99, 8, 'Potencia profesional con chip M3 Pro', 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=400'),
('Samsung Galaxy S24 Ultra', 'Smartphones', 1199.99, 12, 'El smartphone Android más potente con S Pen', 'https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?w=400'),
('iPad Pro 12.9"', 'Tablets', 1099.99, 20, 'Creatividad sin límites con chip M2', 'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=400'),
('AirPods Pro 2', 'Accesorios', 249.99, 50, 'Audio inmersivo con cancelación de ruido activa', 'https://images.unsplash.com/photo-1600294037681-c80b4cb5b434?w=400'),
('Dell XPS 15', 'Laptops', 1599.99, 6, 'Laptop premium con pantalla OLED 4K', 'https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?w=400'),
('Apple Watch Series 9', 'Wearables', 399.99, 25, 'Tu salud en tu muñeca con nuevas funciones', 'https://images.unsplash.com/photo-1546868871-7041f2a55e12?w=400'),
('Sony WH-1000XM5', 'Accesorios', 349.99, 18, 'Los mejores auriculares con cancelación de ruido', 'https://images.unsplash.com/photo-1618366712010-f4ae9c647dcb?w=400');

-- Insert sample repairs
INSERT INTO public.repairs (tracking_code, client_dni, client_name, client_phone, device_model, device_brand, status, notes) VALUES
('REP-A1B2C3D4', '12345678', 'María García', '+51 999 888 777', 'iPhone 13', 'Apple', 'Reparación', 'Cambio de pantalla en proceso'),
('REP-E5F6G7H8', '87654321', 'Carlos López', '+51 999 666 555', 'Galaxy S23', 'Samsung', 'Diagnóstico', 'Problema con la batería'),
('REP-I9J0K1L2', '11223344', 'Ana Martínez', '+51 999 444 333', 'MacBook Air', 'Apple', 'Finalizado', 'Reparación completada - Reemplazo de teclado');