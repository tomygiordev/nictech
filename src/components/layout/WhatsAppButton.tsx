import { MessageCircle } from 'lucide-react';

export const WhatsAppButton = () => {
  const phoneNumber = '5493446353769';
  const message = encodeURIComponent('Hola Nictech, me gustaría obtener más información.');
  const whatsappUrl = `https://wa.me/${phoneNumber}?text=${message}`;

  return (
    <a
      href={whatsappUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-110 animate-float"
      aria-label="Contáctanos por WhatsApp"
    >
      <MessageCircle className="h-7 w-7" />
    </a>
  );
};
