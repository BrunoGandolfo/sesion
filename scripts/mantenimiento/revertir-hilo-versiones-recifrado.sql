-- Reversión administrativa de 20260928120000_hilo_versiones_recifrado, sola.
-- Restituye el cuerpo de proteger_hilo_version() de 20260916013000: las
-- versiones del Recorrido vuelven a admitir solo la resolución. Los triggers
-- y el resto de las garantías siguen puestos.
-- No elimina datos: las versiones ya recifradas quedan con la clave nueva, y
-- desde acá el cron las que falten las cuenta como errores (su clave vieja no
-- se puede retirar del llavero).
-- No la ejecuta la app ni el despliegue automático de Prisma.
BEGIN;
CREATE OR REPLACE FUNCTION proteger_hilo_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Todo excepto la resolución es inmutable, también identidad y procedencia.
  -- Una columna futura queda protegida sin tener que ampliar una lista.
  IF (to_jsonb(NEW) - ARRAY['estado', 'resuelta_en', 'resuelta_por_user_id'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['estado', 'resuelta_en', 'resuelta_por_user_id']) THEN
    RAISE EXCEPTION 'hilo_versiones es inmutable: solo se puede actualizar la resolución'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
COMMIT;
