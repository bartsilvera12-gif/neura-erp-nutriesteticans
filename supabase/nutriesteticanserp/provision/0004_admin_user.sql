-- =============================================================================
-- Nutriestéticans — usuario administrador admin@nutriesteticans.com
-- =============================================================================
-- Crea el usuario en `auth.users` con contraseña temporal encriptada (bcrypt)
-- y lo vincula a `nutriesteticanserp.usuarios` como super_admin de la empresa
-- Nutriestéticans.
--
-- Contraseña temporal: Nutriesteticans2026!
-- Cambiarla desde la app o desde Supabase Auth apenas se ingrese.
--
-- Idempotente:
--   - Si el email ya existe en auth.users, reusa su id.
--   - Si ya existe fila en nutriesteticanserp.usuarios para ese email, actualiza
--     auth_user_id y rol.
-- =============================================================================

DO $$
DECLARE
  v_empresa_id  uuid := '33308550-2d5b-4137-b2bd-d2b331ae555d';
  v_email       text := 'admin@nutriesteticans.com';
  v_password    text := 'Nutriesteticans2026!';
  v_auth_id     uuid;
  v_usuario_id  uuid;
BEGIN
  -- 1) auth.users — crear o reutilizar
  SELECT id INTO v_auth_id FROM auth.users WHERE email = v_email;

  IF v_auth_id IS NULL THEN
    v_auth_id := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_auth_id,
      'authenticated',
      'authenticated',
      v_email,
      crypt(v_password, gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      now(),
      now(),
      '', '', '', ''
    );

    INSERT INTO auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      v_auth_id,
      v_auth_id::text,
      jsonb_build_object('sub', v_auth_id::text, 'email', v_email, 'email_verified', true),
      'email',
      now(), now(), now()
    );

    RAISE NOTICE 'auth.users creado para % con id=%', v_email, v_auth_id;
  ELSE
    RAISE NOTICE 'auth.users ya existía para % (id=%). Se reutiliza.', v_email, v_auth_id;
  END IF;

  -- 2) nutriesteticanserp.usuarios — crear o actualizar vínculo
  SELECT id INTO v_usuario_id FROM nutriesteticanserp.usuarios WHERE email = v_email;

  IF v_usuario_id IS NULL THEN
    INSERT INTO nutriesteticanserp.usuarios (
      id, email, nombre, rol, empresa_id, auth_user_id, activo, estado
    ) VALUES (
      gen_random_uuid(),
      v_email,
      'Administrador Nutriestéticans',
      'admin',
      v_empresa_id,
      v_auth_id,
      true,
      'activo'
    );
    RAISE NOTICE 'nutriesteticanserp.usuarios: fila creada para %', v_email;
  ELSE
    UPDATE nutriesteticanserp.usuarios
       SET auth_user_id = v_auth_id,
           rol          = 'admin',
           empresa_id   = v_empresa_id,
           activo       = true,
           estado       = 'activo'
     WHERE id = v_usuario_id;
    RAISE NOTICE 'nutriesteticanserp.usuarios: fila actualizada para %', v_email;
  END IF;
END $$;
