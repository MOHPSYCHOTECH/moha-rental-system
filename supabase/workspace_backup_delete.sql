-- Run after workspace_history_backups.sql to enable safe backup deletion.
create or replace function public.delete_rental_workspace_backup(p_backup_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
begin
  if (select auth.uid()) is null or not public.is_subscription_admin() then
    raise exception 'Active workspace administrator access is required.' using errcode = '42501';
  end if;

  select backup.owner_id
  into v_owner_id
  from public.rental_workspace_backups as backup
  where backup.id = p_backup_id;

  if not found then
    raise exception 'Workspace backup not found.' using errcode = 'P0002';
  end if;

  if not public.can_access_rental_workspace(v_owner_id) then
    raise exception 'This backup is outside your workspace.' using errcode = '42501';
  end if;

  delete from public.rental_workspace_backups
  where id = p_backup_id and owner_id = v_owner_id;
end;
$$;

revoke all on function public.delete_rental_workspace_backup(uuid) from public, anon;
grant execute on function public.delete_rental_workspace_backup(uuid) to authenticated;
