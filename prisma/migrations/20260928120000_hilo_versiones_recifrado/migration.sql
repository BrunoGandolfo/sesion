-- Aditiva: reemplaza el cuerpo de proteger_hilo_version(); no toca filas,
-- tablas ni triggers. Reversión sola: scripts/mantenimiento/
-- revertir-hilo-versiones-recifrado.sql (restituye el cuerpo de 20260916013000).
--
-- Una versión del Recorrido se reescribe solo para cambiar la clave con que
-- está cifrada, nunca su contenido.
--
-- Sin esto la rotación del llavero no podía terminar: el cron de
-- mantenimiento no podía recifrar hilo_versiones y la clave vieja tenía que
-- conservarse para siempre en el servicio activo (docs/encryption.md §3).
--
-- Qué se permite, y nada más:
--   1. La resolución: cambian solo estado, resuelta_en, resuelta_por_user_id.
--   2. El cambio de envoltorio: cambia SOLO contenido_encrypted, el nuevo
--      blob empieza con "ENC2" y su id de clave (byte 4) es distinto del
--      anterior. El mismo id con otro blob se rechaza: con la misma clave no
--      hay nada que recifrar, y sería reemplazar el contenido.
-- Las dos cosas en un mismo UPDATE se rechazan.
--
-- Límite: la base no tiene la clave y no puede comparar textos. Garantiza
-- que un UPDATE de la versión solo puede cambiar de clave, no que el texto
-- recifrado sea el mismo: eso lo hace recifrarTanda (descifra y vuelve a
-- cifrar lo mismo). Cambiar el contenido además exige una clave con otro id.
BEGIN;

CREATE OR REPLACE FUNCTION proteger_hilo_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- 1. Resolución. Todo lo demás, también identidad y procedencia, queda
  -- igual; una columna futura queda protegida sin ampliar una lista.
  IF (to_jsonb(NEW) - ARRAY['estado', 'resuelta_en', 'resuelta_por_user_id'])
     IS NOT DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['estado', 'resuelta_en', 'resuelta_por_user_id']) THEN
    RETURN NEW;
  END IF;

  -- 2. Cambio de envoltorio: la única columna distinta es contenido_encrypted.
  IF (to_jsonb(NEW) - 'contenido_encrypted') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'contenido_encrypted')
     AND octet_length(NEW.contenido_encrypted) > 4
     AND octet_length(OLD.contenido_encrypted) > 4
     AND substring(NEW.contenido_encrypted FROM 1 FOR 4) = '\x454e4332'::bytea
     AND get_byte(NEW.contenido_encrypted, 4) <> get_byte(OLD.contenido_encrypted, 4) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'hilo_versiones es inmutable: solo se puede actualizar la resolución (estado, resuelta_en, resuelta_por_user_id) o, sola, la clave con que está cifrado el contenido (contenido_encrypted ENC2 con otro id de clave)'
    USING ERRCODE = '55000';
END;
$$;

COMMIT;
