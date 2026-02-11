-- Create a table for blog posts
create table public.posts (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  title text not null,
  excerpt text not null,
  content text not null,
  image_url text not null,
  category text not null,
  read_time text not null default '5 min',
  author text not null default 'Nictech',
  is_published boolean default true
);

-- Enable RLS
alter table public.posts enable row level security;

-- Create policies for posts
-- Allow read access to everyone
create policy "Public posts are viewable by everyone"
  on public.posts for select
  using (true);

-- Allow insert/update/delete only to authenticated users (admins)
create policy "Admins can insert posts"
  on public.posts for insert
  with check (auth.role() = 'authenticated');

create policy "Admins can update posts"
  on public.posts for update
  using (auth.role() = 'authenticated');

create policy "Admins can delete posts"
  on public.posts for delete
  using (auth.role() = 'authenticated');

-- Storage policies (assuming a 'blog_images' bucket exists or using 'product_images' for simplicity, 
-- but better to create a new one 'blog_images')

-- Create a bucket for blog images if it doesn't exist (this usually needs to be done in UI, but policies can be set here)
insert into storage.buckets (id, name, public) 
values ('blog_images', 'blog_images', true)
on conflict (id) do nothing;

create policy "Blog images are publicly accessible"
  on storage.objects for select
  using ( bucket_id = 'blog_images' );

create policy "Admins can upload blog images"
  on storage.objects for insert
  with check ( bucket_id = 'blog_images' and auth.role() = 'authenticated' );

create policy "Admins can update blog images"
  on storage.objects for update
  using ( bucket_id = 'blog_images' and auth.role() = 'authenticated' );

create policy "Admins can delete blog images"
  on storage.objects for delete
  using ( bucket_id = 'blog_images' and auth.role() = 'authenticated' );
