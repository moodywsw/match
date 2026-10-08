-- text[] || 'literal' was parsed as array concatenation; use array_append.
create or replace function private.events_notify_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_type text; v_changes text[] := '{}'; r record; v_ev public.events;
begin
  if tg_op = 'DELETE' then
    v_type := 'event_cancelled'; v_ev := old;
  else
    v_ev := new;
    if new.status = 'cancelled' and old.status <> 'cancelled' then
      v_type := 'event_cancelled';
    else
      if new.title is distinct from old.title then v_changes := array_append(v_changes, 'title'::text); end if;
      if new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at then v_changes := array_append(v_changes, 'time'::text); end if;
      if new.location is distinct from old.location or new.city is distinct from old.city or new.area is distinct from old.area
         or new.cell_lat is distinct from old.cell_lat or new.cell_lng is distinct from old.cell_lng then v_changes := array_append(v_changes, 'place'::text); end if;
      if new.status = 'scheduled' and old.status = 'cancelled' then v_changes := array_append(v_changes, 'reinstated'::text); end if;
      if cardinality(v_changes) = 0 then return new; end if;
      v_type := 'event_update';
    end if;
  end if;
  for r in select p.user_id from public.event_participants p where p.event_id = v_ev.id and p.user_id is distinct from v_ev.creator_id loop
    perform private.add_notification(r.user_id, v_ev.creator_id, v_type, jsonb_build_object(
      'event_id', v_ev.id, 'title', v_ev.title, 'starts_at', v_ev.starts_at,
      'changes', to_jsonb(v_changes), 'deleted', tg_op = 'DELETE'));
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
