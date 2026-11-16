-- Only the public action and read functions are callable from the web app.
do $$
declare f record; has_anon boolean := exists (select 1 from pg_roles where rolname = 'anon');
begin
  for f in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public', f.sig);
    if has_anon then execute format('revoke all on function %s from anon, authenticated', f.sig); end if;
    if left(f.proname, 1) <> '_' and has_anon then
      execute format('grant execute on function %s to anon, authenticated', f.sig);
    end if;
  end loop;
end $$;
