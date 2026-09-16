-- Aditiva: solo funciones y triggers; no reescribe ni borra filas existentes.
-- Reversión: scripts/mantenimiento/revertir-inmutabilidad.sql.
BEGIN;

CREATE FUNCTION rechazar_mutacion_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% es inmutable: operación % no permitida', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER eventos_auditoria_inmutable
BEFORE UPDATE OR DELETE OR TRUNCATE ON eventos_auditoria
FOR EACH STATEMENT EXECUTE FUNCTION rechazar_mutacion_inmutable();

CREATE FUNCTION proteger_hilo_version() RETURNS trigger
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

CREATE TRIGGER hilo_versiones_contenido_inmutable
BEFORE UPDATE ON hilo_versiones
FOR EACH ROW EXECUTE FUNCTION proteger_hilo_version();

CREATE TRIGGER hilo_versiones_sin_borrado
BEFORE DELETE OR TRUNCATE ON hilo_versiones
FOR EACH STATEMENT EXECUTE FUNCTION rechazar_mutacion_inmutable();

COMMIT;
