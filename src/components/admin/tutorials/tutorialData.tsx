import React from 'react';
import { Package, Wrench, BarChart3, Smartphone, Tag, LayoutDashboard, Search, ShoppingCart, AlertCircle, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface TutorialStep {
  title: string;
  description: string;
  limitations?: string;
  mockup: React.ReactNode;
}

interface Tutorial {
  title: string;
  steps: TutorialStep[];
}

// Helper components to simulate UI in tutorials without triggering real actions
const MockTopBar = ({ title, icon: Icon }: { title: string, icon: any }) => (
  <div className="flex items-center gap-2 p-4 border-b bg-muted/20">
    <Icon className="w-5 h-5 text-primary" />
    <h3 className="font-semibold">{title}</h3>
  </div>
);

const MockTable = ({ cols, rows }: { cols: string[], rows: string[][] }) => (
  <div className="flex-1 overflow-auto p-4">
    <div className="border rounded-md w-full">
      <div className="grid bg-muted/50 p-2 border-b font-medium text-sm" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}>
        {cols.map(c => <div key={c}>{c}</div>)}
      </div>
      {rows.map((row, i) => (
        <div key={i} className="grid p-2 border-b last:border-0 text-sm text-muted-foreground items-center" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}>
          {row.map((cell, j) => <div key={j}>{cell}</div>)}
        </div>
      ))}
    </div>
  </div>
);

export const tutorialData: Record<string, Tutorial> = {
  dashboard: {
    title: 'Módulo: Dashboard',
    steps: [
      {
        title: 'Introducción al Dashboard',
        description: 'El Dashboard es la pantalla principal o el "tablero de control" del sistema.\n\nAquí vas a encontrar un resumen rápido de cómo viene el negocio. Su sentido principal es darte un pantallazo de las ventas, reparaciones activas y alertas de stock sin tener que entrar módulo por módulo.',
        mockup: (
          <div className="w-full h-full flex flex-col bg-background">
            <MockTopBar title="Dashboard" icon={LayoutDashboard} />
            <div className="p-4 grid grid-cols-2 gap-4">
              <div className="border rounded-xl p-4 bg-primary/5">
                <p className="text-sm text-muted-foreground">Ventas del mes</p>
                <p className="text-2xl font-bold">$125.000</p>
              </div>
              <div className="border rounded-xl p-4 bg-primary/5">
                <p className="text-sm text-muted-foreground">Reparaciones en curso</p>
                <p className="text-2xl font-bold">8</p>
              </div>
            </div>
          </div>
        )
      }
    ]
  },
  repairs: {
    title: 'Módulo: Reparaciones (Servicio Técnico)',
    steps: [
      {
        title: '¿Qué es y para qué sirve?',
        description: 'En este módulo ingresan todos los equipos que traen los clientes para arreglar.\n\nEl sentido de esta pantalla es llevar un control ordenado: saber a quién pertenece el equipo, qué problema tiene, qué presupuesto se le pasó y en qué estado se encuentra (ej: "Diagnóstico", "Esperando repuesto", "Finalizado").',
        mockup: (
          <div className="w-full h-full flex flex-col">
            <MockTopBar title="Reparaciones" icon={Wrench} />
            <div className="p-4 flex gap-2 border-b">
              <Button size="sm">Nuevo Ingreso</Button>
              <Input placeholder="Buscar por DNI o código..." className="max-w-[200px] h-8" />
            </div>
          </div>
        )
      },
      {
        title: 'Generación de Código de Seguimiento',
        description: 'Cada vez que ingresás un equipo, el sistema genera un Código (ej: A4F2-89B1). Este código se lo das al cliente para que pueda revisar el estado de su equipo desde la web pública (en la sección Seguimiento).\n\nTambién podés anotar los costos y precios para llevar la cuenta.',
        mockup: (
           <div className="w-full h-full flex flex-col">
            <MockTable 
              cols={['Código', 'Cliente', 'Equipo', 'Estado']} 
              rows={[
                ['A4F2-89B1', 'Juan Perez', 'iPhone 11', 'Diagnóstico'],
                ['B8C9-11D2', 'Maria Gomez', 'Samsung S22', 'Finalizado']
              ]} 
            />
          </div>
        )
      }
    ]
  },
  inventory: {
    title: 'Módulo: Inventario y POS Venta',
    steps: [
      {
        title: 'Inventario: El corazón de las ventas',
        description: 'Este módulo contiene el Punto de Venta (POS) y el Historial de Movimientos.\n\nSirve para abrir la "caja", realizar ventas rápidas en el local descontando stock automáticamente, y ver el registro de todo lo que entró y salió del local. Es fundamental para que los números cuadren al final del día.',
        mockup: (
          <div className="w-full h-full flex flex-col">
            <MockTopBar title="Inventario" icon={BarChart3} />
            <div className="p-4 flex gap-2">
              <Button size="sm" className="bg-green-600">Nueva Venta (POS)</Button>
              <Button size="sm" variant="outline">Ajustar Stock</Button>
            </div>
          </div>
        )
      },
      {
        title: 'POS VENTA (Punto de Venta)',
        description: 'Al hacer clic en "Nueva Venta", se abre el POS. Aquí buscás los productos que el cliente tiene en el mostrador para cobrarlos.\n\nPodés buscar el producto escribiendo su nombre o categoría en el buscador.',
        limitations: 'El buscador dice "Buscar producto o escanear con barra...", pero actualmente la función de lector de código de barras físico no está 100% integrada. Por ahora, debes buscar escribiendo el nombre del producto manualmente en el teclado.',
        mockup: (
          <div className="w-full h-full flex flex-col border-2 border-primary/20 rounded-md m-2">
            <div className="p-2 border-b bg-accent font-semibold flex items-center gap-2">
              <ShoppingCart className="w-4 h-4"/> Nueva Venta Rápida
            </div>
            <div className="p-4 flex flex-col gap-4">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
                <Input placeholder="Buscar producto o escanear..." className="pl-9" />
              </div>
              <div className="border border-dashed p-4 text-center text-muted-foreground rounded-md">
                El carrito está vacío
              </div>
            </div>
          </div>
        )
      }
    ]
  },
  products: {
    title: 'Módulo: Productos',
    steps: [
      {
        title: 'Gestión del Catálogo',
        description: 'Aquí se cargan los productos "base" que vas a vender en la tienda web y en el local (ej: Cargador Tipo C, Auriculares Bluetooth).\n\nEn este módulo definís el nombre, la categoría, el precio, y las imágenes principales del producto.',
        mockup: (
          <div className="w-full h-full flex flex-col">
            <MockTopBar title="Productos" icon={Package} />
            <MockTable 
              cols={['Producto', 'Precio', 'Stock', 'Categoría']} 
              rows={[
                ['Cargador 20W', '$15.000', '12', 'Accesorios'],
                ['Auriculares XYZ', '$25.000', '5', 'Audio']
              ]} 
            />
          </div>
        )
      },
      {
        title: 'Ocultar vs Borrar',
        description: 'Si te quedás sin stock de un producto, podés ocultarlo para que no salga en la web, en vez de borrarlo. Así, cuando vuelva a ingresar mercadería, solo tenés que volver a activarlo y actualizar la cantidad.',
        limitations: 'Las variantes de colores o talles no se manejan desde esta pantalla, tienen su propio módulo ("Variantes") para no mezclar el stock de un mismo producto en distintos colores.',
        mockup: (
           <div className="w-full h-full flex flex-col p-4 justify-center items-center">
             <div className="flex gap-4">
               <Button variant="outline" className="opacity-50">Ocultar de la web</Button>
               <Button variant="destructive">Eliminar Producto</Button>
             </div>
           </div>
        )
      }
    ]
  },
  cases: {
    title: 'Módulo: Fundas',
    steps: [
      {
        title: 'Gestión Especial de Fundas',
        description: 'Las fundas para celulares tienen su propio módulo porque suelen tener una lógica especial: un mismo modelo de funda puede venir para 50 modelos distintos de celular.\n\nDesde aquí administras el stock específico de protectores y fundas, organizándolos por modelo de teléfono compatible.',
        mockup: (
          <div className="w-full h-full flex flex-col">
            <MockTopBar title="Fundas" icon={Smartphone} />
            <MockTable 
              cols={['Funda', 'Modelo Compatible', 'Stock']} 
              rows={[
                ['Funda Silicona', 'iPhone 13', '4'],
                ['Funda Transparente', 'Samsung A54', '10']
              ]} 
            />
          </div>
        )
      }
    ]
  },
  variants: {
    title: 'Módulo: Variantes',
    steps: [
      {
        title: 'Control de Colores y Versiones',
        description: 'Si vendés un "Cable USB" que viene en color Blanco y color Negro, no creás dos productos. Creás un solo producto, y acá le agregás las Variantes.\n\nEsto te permite tener un stock individual para el Blanco (ej: 5) y otro para el Negro (ej: 2).',
        mockup: (
          <div className="w-full h-full flex flex-col">
            <MockTopBar title="Variantes" icon={Package} />
            <div className="p-4">
              <div className="border p-3 rounded-md mb-2 bg-muted/30">
                <p className="font-semibold text-sm">Cable USB Tipo C</p>
                <div className="flex gap-2 mt-2">
                  <span className="bg-white text-black border px-2 py-1 text-xs rounded">Blanco (Stock: 5)</span>
                  <span className="bg-black text-white px-2 py-1 text-xs rounded">Negro (Stock: 2)</span>
                </div>
              </div>
            </div>
          </div>
        )
      }
    ]
  },
  promos: {
    title: 'Módulo: Promos',
    steps: [
      {
        title: 'Descuentos y Ofertas',
        description: 'Este módulo sirve para crear códigos de descuento o promociones especiales que se aplican en la tienda web.\n\nPodés crear un descuento por un monto fijo (ej: $1000 menos) o por porcentaje (ej: 10% OFF), y definir si tiene fecha de vencimiento.',
        mockup: (
          <div className="w-full h-full flex flex-col">
            <MockTopBar title="Promociones" icon={Tag} />
             <MockTable 
              cols={['Código', 'Descuento', 'Estado']} 
              rows={[
                ['VERANO20', '20% OFF', 'Activo'],
                ['ENVIOFREE', 'Envío Gratis', 'Vencido']
              ]} 
            />
          </div>
        )
      }
    ]
  },
  banners: {
    title: 'Módulo: Banners',
    steps: [
      {
        title: 'Imágenes Destacadas',
        description: 'Los Banners son las imágenes grandes que aparecen en el inicio de la tienda web para llamar la atención (carrusel de ofertas).\n\nDesde aquí podés subir nuevas imágenes promocionales, ordenarlas y elegir a qué sección redirigen cuando el cliente hace clic.',
        mockup: (
          <div className="w-full h-full flex flex-col">
            <MockTopBar title="Banners" icon={ImageIcon} />
            <div className="p-4 grid grid-cols-1 gap-2">
              <div className="h-20 bg-muted border-2 border-dashed flex items-center justify-center rounded-md">
                <ImageIcon className="w-6 h-6 text-muted-foreground mr-2" /> Banner 1 (Activo)
              </div>
              <div className="h-20 bg-muted border-2 border-dashed flex items-center justify-center rounded-md">
                <ImageIcon className="w-6 h-6 text-muted-foreground mr-2" /> Banner 2 (Oculto)
              </div>
            </div>
          </div>
        )
      }
    ]
  },
  blog: {
    title: 'Módulo: Blog',
    steps: [
      {
        title: 'Novedades y Artículos',
        description: 'El Blog se utiliza para publicar noticias, guías de reparación o novedades del mundo tech en tu página web.\n\nEsto no solo ayuda a informar a tus clientes, sino que mejora el SEO (posicionamiento en Google) de tu tienda para que más gente te encuentre.',
        mockup: (
           <div className="w-full h-full flex flex-col">
            <MockTopBar title="Blog" icon={LayoutDashboard} />
            <div className="p-4">
              <h4 className="font-semibold mb-2">Tus Entradas:</h4>
              <ul className="text-sm space-y-2 list-disc pl-4 text-muted-foreground">
                <li>Cómo cuidar la batería de tu iPhone</li>
                <li>Nuevos ingresos de Samsung</li>
                <li>¿Por qué se rompe el pin de carga?</li>
              </ul>
            </div>
          </div>
        )
      }
    ]
  }
};
