-- Imagens e vídeos dos posts: o GHL e as redes buscam a mídia por um endereço público.
-- Caminho: <workspace_id>/<task_id>/<arquivo>. Só membros do workspace enviam ou apagam.
insert into storage.buckets (id, name, public, file_size_limit)
values ('social-media', 'social-media', true, 524288000)  -- até 500 MB por arquivo (vídeos)
on conflict (id) do nothing;

create policy social_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'social-media' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy social_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'social-media' and public.is_member(((storage.foldername(name))[1])::uuid));
