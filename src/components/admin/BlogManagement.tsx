import { useState, useEffect } from "react";
import { Plus, Trash2, Loader2, Image as ImageIcon, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface BlogPost {
    id: string;
    title: string;
    excerpt: string;
    content: string;
    image_url: string;
    category: string;
    read_time: string;
    author: string;
    created_at: string;
}

export const BlogManagement = () => {
    const [posts, setPosts] = useState<BlogPost[]>([]);
    const [loading, setLoading] = useState(true);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [saving, setSaving] = useState(false);

    const [newPost, setNewPost] = useState({
        title: "",
        excerpt: "",
        content: "",
        category: "",
        read_time: "5 min",
        image_file: null as File | null,
        image_preview: "" as string,
    });

    useEffect(() => {
        fetchPosts();
    }, []);

    const fetchPosts = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from("posts" as any)
            .select("*")
            .order("created_at", { ascending: false });

        if (error) {
            console.error("Error fetching posts:", error);
            // Don't show error toast if table doesn't exist yet, to avoid alarming user before setup
            if (error.code !== "PGRST204") { // Undefined table code usually
                toast({
                    title: "Error",
                    description: "No se pudieron cargar las publicaciones.",
                    variant: "destructive",
                });
            }
        } else {
            setPosts(data as unknown as BlogPost[]);
        }
        setLoading(false);
    };

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setNewPost({
                ...newPost,
                image_file: file,
                image_preview: URL.createObjectURL(file),
            });
        }
    };

    const uploadImage = async (file: File) => {
        const fileExt = file.name.split(".").pop();
        const fileName = `${Math.random()}.${fileExt}`;
        const filePath = `${fileName}`;

        // Try uploading to 'blog_images', fallback to 'product_images' if it doesn't exist
        let bucketName = "blog_images";

        // Check if bucket exists/upload
        let { error: uploadError } = await supabase.storage
            .from(bucketName)
            .upload(filePath, file);

        if (uploadError) {
            // If bucket doesn't exist or other error, try generic bucket or handle creation
            // For now, let's try 'product_images' as a backup if 'blog_images' fails
            bucketName = "product_images";
            const { error: retryError } = await supabase.storage
                .from(bucketName)
                .upload(filePath, file);

            if (retryError) throw retryError;
        }

        const { data: { publicUrl } } = supabase.storage
            .from(bucketName)
            .getPublicUrl(filePath);

        return publicUrl;
    };

    const handleSave = async () => {
        if (!newPost.title || !newPost.excerpt || !newPost.content || !newPost.category) {
            toast({
                title: "Campos incompletos",
                description: "Por favor completa todos los campos requeridos.",
                variant: "destructive",
            });
            return;
        }

        if (!newPost.image_file && !newPost.image_preview) {
            toast({
                title: "Imagen requerida",
                description: "Por favor selecciona una imagen para la publicación.",
                variant: "destructive",
            });
            return;
        }

        setSaving(true);
        try {
            let imageUrl = newPost.image_preview;

            if (newPost.image_file) {
                imageUrl = await uploadImage(newPost.image_file);
            }

            const { error } = await supabase
                .from("posts" as any)
                .insert({
                    title: newPost.title,
                    excerpt: newPost.excerpt,
                    content: newPost.content,
                    category: newPost.category,
                    read_time: newPost.read_time,
                    image_url: imageUrl,
                    author: "Nictech", // Default author as requested
                });

            if (error) throw error;

            toast({
                title: "Publicación creada",
                description: "El artículo se ha publicado correctamente.",
            });

            setIsDialogOpen(false);

            // Reset form
            setNewPost({
                title: "",
                excerpt: "",
                content: "",
                category: "",
                read_time: "5 min",
                image_file: null,
                image_preview: "",
            });

            fetchPosts();
        } catch (error: any) {
            console.error("Error saving post:", error);
            toast({
                title: "Error",
                description: error.message || "No se pudo guardar la publicación.",
                variant: "destructive",
            });
        }
        setSaving(false);
    };

    const handleDelete = async (id: string) => {
        if (!confirm("¿Estás seguro de que deseas eliminar esta publicación?")) return;

        const { error } = await supabase
            .from("posts" as any)
            .delete()
            .eq("id", id);

        if (error) {
            toast({
                title: "Error",
                description: "No se pudo eliminar la publicación.",
                variant: "destructive",
            });
        } else {
            toast({
                title: "Eliminado",
                description: "Publicación eliminada correctamente.",
            });
            fetchPosts();
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-bold">Gestión de Blog</h2>
                    <p className="text-muted-foreground">Administra las noticias y artículos</p>
                </div>
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                    <DialogTrigger asChild>
                        <Button>
                            <Plus className="mr-2 h-4 w-4" />
                            Nueva Publicación
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle>Nueva Publicación</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                            <div className="grid gap-2">
                                <Label htmlFor="title">Título</Label>
                                <Input
                                    id="title"
                                    value={newPost.title}
                                    onChange={(e) => setNewPost({ ...newPost, title: e.target.value })}
                                    placeholder="Título del artículo"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="grid gap-2">
                                    <Label htmlFor="category">Categoría</Label>
                                    <Select
                                        value={newPost.category}
                                        onValueChange={(value) => setNewPost({ ...newPost, category: value })}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="Seleccionar" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="Noticias">Noticias</SelectItem>
                                            <SelectItem value="Consejos">Consejos</SelectItem>
                                            <SelectItem value="Tutoriales">Tutoriales</SelectItem>
                                            <SelectItem value="Novedades">Novedades</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="read_time">Tiempo de lectura</Label>
                                    <Input
                                        id="read_time"
                                        value={newPost.read_time}
                                        onChange={(e) => setNewPost({ ...newPost, read_time: e.target.value })}
                                        placeholder="ej: 5 min"
                                    />
                                </div>
                            </div>

                            <div className="grid gap-2">
                                <Label htmlFor="excerpt">Resumen (Copete)</Label>
                                <Textarea
                                    id="excerpt"
                                    value={newPost.excerpt}
                                    onChange={(e) => setNewPost({ ...newPost, excerpt: e.target.value })}
                                    placeholder="Breve descripción que aparecerá en la tarjeta..."
                                    rows={2}
                                />
                            </div>

                            <div className="grid gap-2">
                                <Label htmlFor="content">Contenido</Label>
                                <div className="border rounded-md overflow-hidden bg-card">
                                    <div className="flex flex-wrap gap-1 p-2 bg-muted/50 border-b">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 w-8 p-0"
                                            title="Negrita"
                                            onClick={() => {
                                                const textarea = document.getElementById('content') as HTMLTextAreaElement;
                                                const start = textarea.selectionStart;
                                                const end = textarea.selectionEnd;
                                                const text = textarea.value;
                                                const before = text.substring(0, start);
                                                const selection = text.substring(start, end);
                                                const after = text.substring(end);
                                                const newText = `${before}<b>${selection || 'texto'}</b>${after}`;
                                                setNewPost({ ...newPost, content: newText });
                                            }}
                                        >
                                            <span className="font-bold">B</span>
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 w-8 p-0"
                                            title="Cursiva"
                                            onClick={() => {
                                                const textarea = document.getElementById('content') as HTMLTextAreaElement;
                                                const start = textarea.selectionStart;
                                                const end = textarea.selectionEnd;
                                                const text = textarea.value;
                                                const before = text.substring(0, start);
                                                const selection = text.substring(start, end);
                                                const after = text.substring(end);
                                                const newText = `${before}<i>${selection || 'texto'}</i>${after}`;
                                                setNewPost({ ...newPost, content: newText });
                                            }}
                                        >
                                            <span className="italic font-serif">I</span>
                                        </Button>
                                        <div className="w-px h-6 bg-border mx-1 my-auto" />
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 px-2 text-xs font-semibold"
                                            title="Subtítulo"
                                            onClick={() => {
                                                const textarea = document.getElementById('content') as HTMLTextAreaElement;
                                                const start = textarea.selectionStart;
                                                const end = textarea.selectionEnd;
                                                const text = textarea.value;
                                                const before = text.substring(0, start);
                                                const selection = text.substring(start, end);
                                                const after = text.substring(end);
                                                const newText = `${before}<h3>${selection || 'Título'}</h3>\n${after}`;
                                                setNewPost({ ...newPost, content: newText });
                                            }}
                                        >
                                            H3
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 px-2 text-xs"
                                            title="Párrafo"
                                            onClick={() => {
                                                const textarea = document.getElementById('content') as HTMLTextAreaElement;
                                                const start = textarea.selectionStart;
                                                const end = textarea.selectionEnd;
                                                const text = textarea.value;
                                                const before = text.substring(0, start);
                                                const selection = text.substring(start, end);
                                                const after = text.substring(end);
                                                const newText = `${before}<p>${selection || 'párrafo'}</p>\n${after}`;
                                                setNewPost({ ...newPost, content: newText });
                                            }}
                                        >
                                            P
                                        </Button>
                                        <div className="w-px h-6 bg-border mx-1 my-auto" />
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 px-2 text-xs"
                                            title="Lista"
                                            onClick={() => {
                                                const textarea = document.getElementById('content') as HTMLTextAreaElement;
                                                const start = textarea.selectionStart;
                                                const end = textarea.selectionEnd;
                                                const text = textarea.value;
                                                const before = text.substring(0, start);
                                                const selection = text.substring(start, end);
                                                const after = text.substring(end);
                                                const newText = `${before}<ul>\n  <li>${selection || 'item'}</li>\n  <li>item</li>\n</ul>${after}`;
                                                setNewPost({ ...newPost, content: newText });
                                            }}
                                        >
                                            Lista
                                        </Button>
                                    </div>
                                    <Textarea
                                        id="content"
                                        value={newPost.content}
                                        onChange={(e) => setNewPost({ ...newPost, content: e.target.value })}
                                        placeholder="Escribe aquí el contenido..."
                                        className="font-mono text-sm border-0 rounded-none focus-visible:ring-0 resize-y min-h-[200px]"
                                    />
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Usa los botones para dar formato. Se insertarán las etiquetas HTML correspondientes.
                                </p>
                            </div>

                            <div className="grid gap-2">
                                <Label>Imagen de Portada</Label>
                                <div className="flex items-center gap-4">
                                    <Button variant="outline" className="relative cursor-pointer" type="button">
                                        <input
                                            type="file"
                                            className="absolute inset-0 opacity-0 cursor-pointer"
                                            accept="image/*"
                                            onChange={handleImageChange}
                                        />
                                        <ImageIcon className="mr-2 h-4 w-4" />
                                        Subir Imagen
                                    </Button>
                                    {newPost.image_preview && (
                                        <div className="relative h-20 w-32 rounded overflow-hidden border">
                                            <img src={newPost.image_preview} alt="Preview" className="h-full w-full object-cover" />
                                            <button
                                                onClick={() => setNewPost({ ...newPost, image_file: null, image_preview: "" })}
                                                className="absolute top-0 right-0 p-1 bg-black/50 text-white rounded-bl"
                                                type="button"
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="pt-4 flex justify-end gap-2">
                                <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={saving}>
                                    Cancelar
                                </Button>
                                <Button onClick={handleSave} disabled={saving}>
                                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Publicar
                                </Button>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>

            {loading ? (
                <div className="flex justify-center p-8">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            ) : posts.length === 0 ? (
                <div className="text-center p-8 border rounded-lg bg-muted/20">
                    <p className="text-muted-foreground">No hay publicaciones aún.</p>
                </div>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {posts.map((post) => (
                        <div key={post.id} className="border rounded-xl overflow-hidden bg-card flex flex-col">
                            <div className="aspect-video relative overflow-hidden bg-muted">
                                {post.image_url ? (
                                    <img src={post.image_url} alt={post.title} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                                        <ImageIcon className="h-8 w-8" />
                                    </div>
                                )}
                                <div className="absolute top-2 right-2">
                                    <span className="px-2 py-1 bg-black/70 text-white text-xs rounded-full">
                                        {post.category}
                                    </span>
                                </div>
                            </div>
                            <div className="p-4 flex-1 flex flex-col">
                                <h3 className="font-semibold line-clamp-1 mb-2">{post.title}</h3>
                                <p className="text-sm text-muted-foreground line-clamp-2 mb-4 flex-1">
                                    {post.excerpt}
                                </p>
                                <div className="flex items-center justify-between text-xs text-muted-foreground mt-auto pt-4 border-t">
                                    <span>{new Date(post.created_at).toLocaleDateString()}</span>
                                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDelete(post.id)}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
