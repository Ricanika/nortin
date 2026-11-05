-- Link da pasta (OneDrive, SharePoint, Google Drive...) na lista e na tarefa.
-- Os arquivos ficam onde já estão; aqui guardamos só o endereço.

alter table public.lists
  add column folder_url text check (folder_url is null or folder_url ~* '^https://');
alter table public.tasks
  add column folder_url text check (folder_url is null or folder_url ~* '^https://');
