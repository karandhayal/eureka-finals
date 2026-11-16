do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p
           where p.pronamespace = 'public'::regnamespace and left(p.proname,1) = '_' loop
    execute format('alter function %s set search_path = public, extensions', f.sig);
  end loop;
end $$;
