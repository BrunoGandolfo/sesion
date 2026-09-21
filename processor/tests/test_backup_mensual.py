"""La copia mensual del respaldo, con Bash real y aws simulado (JMESPath real).

El paso vivía condicionado a `github.event.schedule` del día 1 y por eso NUNCA
se ejecutó: de las 74 corridas del respaldo, cero cayeron un día 1 (el paso
entró al repo el 15 de septiembre de 2026 y el ensayo del 16 falló por no
encontrar ninguna copia mensual). Ahora la condición es el ESTADO del bucket:
si no hay copia de este mes, se hace; si ya hay, no se duplica.

Lo que este test cuida, y que el calendario no daba:
  - la condición se decide con lo que hay en R2, no con la fecha de la corrida;
  - es idempotente: N corridas en el mismo mes dejan UNA copia mensual;
  - se repara sola: si el día 1 no hubo corrida, la primera del mes que salga
    bien la crea;
  - un listado que falla NO se lee como "no hay ninguna" (eso duplicaría) ni
    como "ya hay" (eso saltearía el mes): aborta el paso y la corrida avisa.

Vive acá y no en src/lib/__tests__ por la misma razón que
test_ensayo_listado.py: el `--query` es JMESPath y se evalúa con la biblioteca
real, que en el repo sólo está del lado de Python. El resto de los pasos de
backup.yml se prueban en src/lib/__tests__/backup.test.ts.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import textwrap

import pytest

RAIZ = Path(__file__).resolve().parents[2]
WORKFLOW = RAIZ / ".github/workflows/backup.yml"
PASO = "      - name: Copia mensual (la primera lograda del mes)"
MES = "2026-09"
DIARIA = f"backups/sesion-backup-{MES}-16-060501.dump.gpg"
MENSUAL = f"backups/mensuales/sesion-backup-{MES}-16-060501.dump.gpg"
PREFIJO_MES = f"backups/mensuales/sesion-backup-{MES}-"


@pytest.fixture(scope="module")
def copia_mensual():
    lineas = WORKFLOW.read_text(encoding="utf-8").splitlines()
    inicio = lineas.index(PASO)
    assert lineas[inicio + 1] == "        run: |"
    bloque = []
    for linea in lineas[inicio + 2:]:
        if linea.strip() and not linea.startswith("          "):
            break
        bloque.append(linea[10:])
    assert bloque, "No se extrajo el bloque del YAML"
    return "\n".join(bloque)


# El bucket es un archivo: `s3 cp` agrega la clave destino, así que correr el
# paso dos veces seguidas ejerce de verdad la idempotencia.
SIMULADOR = textwrap.dedent('''\
    import json, os, sys
    from pathlib import Path
    import jmespath

    args = sys.argv[1:]
    bucket = Path(os.environ["BUCKET_SIMULADO"])
    def opcion(nombre):
        return args[args.index(nombre) + 1]
    def registrar(operacion, extra):
        with Path("llamadas.jsonl").open("a") as archivo:
            archivo.write(json.dumps({"operacion": operacion, **extra}) + "\\n")

    assert opcion("--endpoint-url") == "https://r2.invalid"
    claves = json.loads(bucket.read_text())

    if args[:2] == ["s3", "cp"]:
        registrar("copiar", {"origen": args[2], "destino": args[3]})
        if os.environ.get("FALLO") == "copia":
            print("error simulado al copiar", file=sys.stderr)
            sys.exit(255)
        prefijo = "s3://" + os.environ["R2_BUCKET"] + "/"
        assert args[2].startswith(prefijo) and args[3].startswith(prefijo)
        assert args[2][len(prefijo):] in claves, "se copia un objeto que no existe"
        claves.append(args[3][len(prefijo):])
        bucket.write_text(json.dumps(claves))
        sys.exit(0)

    assert args[:2] == ["s3api", "list-objects-v2"]
    assert opcion("--bucket") == os.environ["R2_BUCKET"]
    assert opcion("--output") == "text"
    prefijo = opcion("--prefix")
    registrar("listar", {"prefijo": prefijo})
    if os.environ.get("FALLO") == "listado":
        print("error simulado al listar", file=sys.stderr)
        sys.exit(255)
    # S3 omite Contents cuando no hay ninguna coincidencia; no manda [].
    encontradas = sorted(c for c in claves if c.startswith(prefijo))
    respuesta = {"Contents": [{"Key": c} for c in encontradas]} if encontradas else {}
    try:
        resultado = jmespath.search(opcion("--query"), respuesta)
    except jmespath.exceptions.JMESPathError as error:
        print("aws: " + str(error), file=sys.stderr)
        sys.exit(255)
    print("None" if resultado is None else resultado)
''')


def ejecutar(tmp_path, copia_mensual, claves, fallo="", veces=1):
    aws = tmp_path / "aws"
    aws.write_text(f"#!{sys.executable}\n{SIMULADOR}", encoding="utf-8")
    aws.chmod(0o755)
    bucket = tmp_path / "bucket.json"
    bucket.write_text(json.dumps(list(claves)))
    corridas = []
    for _ in range(veces):
        corridas.append(subprocess.run(
            ["/bin/bash", "-c", copia_mensual], cwd=tmp_path, text=True,
            capture_output=True, timeout=20,
            env={
                "PATH": f"{tmp_path}{os.pathsep}/usr/bin:/bin", "LANG": "C.UTF-8",
                "R2_BUCKET": "bucket-simulado", "R2_ENDPOINT": "https://r2.invalid",
                "BUCKET_SIMULADO": str(bucket), "FALLO": fallo,
                "MES_ACTUAL": MES, "BACKUP_KEY": DIARIA, "BACKUP_KEY_MENSUAL": MENSUAL,
            },
        ))
    llamadas = [json.loads(l) for l in (tmp_path / "llamadas.jsonl").read_text().splitlines()]
    return corridas, json.loads(bucket.read_text()), llamadas


def test_sin_copia_del_mes_la_crea_cualquier_dia(tmp_path, copia_mensual):
    (corrida,), claves, llamadas = ejecutar(tmp_path, copia_mensual, [DIARIA])
    assert corrida.returncode == 0, corrida.stderr
    assert corrida.stderr == ""
    assert claves == [DIARIA, MENSUAL]
    assert llamadas == [
        {"operacion": "listar", "prefijo": PREFIJO_MES},
        {"operacion": "copiar", "origen": f"s3://bucket-simulado/{DIARIA}",
         "destino": f"s3://bucket-simulado/{MENSUAL}"},
    ]
    assert MENSUAL in corrida.stdout


def test_con_la_copia_del_mes_no_duplica_ni_copia_nada(tmp_path, copia_mensual):
    (corrida,), claves, llamadas = ejecutar(tmp_path, copia_mensual, [DIARIA, MENSUAL])
    assert corrida.returncode == 0, corrida.stderr
    assert claves == [DIARIA, MENSUAL]
    assert [c["operacion"] for c in llamadas] == ["listar"]
    assert f"Ya hay copia mensual de {MES}" in corrida.stdout


@pytest.mark.parametrize("veces", [2, 4])
def test_es_idempotente_corra_las_veces_que_corra(tmp_path, copia_mensual, veces):
    corridas, claves, llamadas = ejecutar(tmp_path, copia_mensual, [DIARIA], veces=veces)
    assert [c.returncode for c in corridas] == [0] * veces
    assert claves.count(MENSUAL) == 1
    assert [c["operacion"] for c in llamadas].count("copiar") == 1


def test_la_copia_de_otro_mes_no_cuenta_como_la_de_este(tmp_path, copia_mensual):
    vieja = "backups/mensuales/sesion-backup-2026-08-03-060501.dump.gpg"
    (corrida,), claves, _ = ejecutar(tmp_path, copia_mensual, [DIARIA, vieja])
    assert corrida.returncode == 0, corrida.stderr
    assert sorted(claves) == sorted([DIARIA, vieja, MENSUAL])


def test_una_diaria_del_mes_no_se_confunde_con_la_mensual(tmp_path, copia_mensual):
    # El prefijo consultado incluye mensuales/: una diaria de este mes, que
    # siempre existe, no puede hacer creer que la mensual ya está.
    otra_diaria = f"backups/sesion-backup-{MES}-02-060000.dump.gpg"
    (corrida,), claves, _ = ejecutar(tmp_path, copia_mensual, [DIARIA, otra_diaria])
    assert corrida.returncode == 0, corrida.stderr
    assert MENSUAL in claves


def test_si_el_listado_falla_no_se_asume_nada_y_el_paso_aborta(tmp_path, copia_mensual):
    (corrida,), claves, llamadas = ejecutar(tmp_path, copia_mensual, [DIARIA], fallo="listado")
    assert corrida.returncode != 0
    assert claves == [DIARIA], "un listado que falla no puede terminar en una copia"
    assert [c["operacion"] for c in llamadas] == ["listar"]


def test_si_la_copia_falla_la_corrida_se_entera(tmp_path, copia_mensual):
    (corrida,), claves, _ = ejecutar(tmp_path, copia_mensual, [DIARIA], fallo="copia")
    assert corrida.returncode != 0
    assert claves == [DIARIA]


def test_el_paso_ya_no_depende_del_calendario(copia_mensual):
    lineas = WORKFLOW.read_text(encoding="utf-8").splitlines()
    inicio = lineas.index(PASO)
    # Un `if:` en el paso sería volver a condicionarlo a la corrida y no al
    # estado del bucket, que es exactamente lo que nunca ocurrió.
    assert lineas[inicio + 1] == "        run: |", "el paso no puede volver a llevar un if:"
    assert "ES_DIA_UNO" not in "\n".join(lineas)
    assert "github.event.schedule" not in copia_mensual
