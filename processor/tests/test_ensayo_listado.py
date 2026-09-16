"""Selección del YAML con Bash real y un aws local, sin credenciales ni red.

JMESPath ya viene con boto3: el doble evalúa la consulta recibida con el
mismo motor que AWS CLI, en vez de devolver una selección precocinada.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import textwrap

import pytest


WORKFLOW = Path(__file__).resolve().parents[2] / ".github/workflows/ensayo-restauracion.yml"
DIARIO = "backups/sesion-backup-"
MENSUAL = "backups/mensuales/"


@pytest.fixture(scope="module")
def seleccion():
    lineas = WORKFLOW.read_text(encoding="utf-8").splitlines()
    inicio = lineas.index('      - name: "Elegir las copias: la diaria más reciente y la mensual más vieja"')
    assert lineas[inicio + 1] == "        run: |"
    bloque = []
    for linea in lineas[inicio + 2:]:
        if linea.strip() and not linea.startswith("          "):
            break
        bloque.append(linea[10:])
    assert bloque, "No se extrajo el bloque de selección del YAML"
    return "\n".join(bloque)


AWS_SIMULADO = textwrap.dedent('''\
    import json, os, sys
    from pathlib import Path
    import jmespath

    args = sys.argv[1:]
    def opcion(nombre):
        return args[args.index(nombre) + 1]

    assert args[0] == "s3api"
    assert opcion("--bucket") == "bucket-simulado"
    assert opcion("--endpoint-url") == "https://r2.invalid"
    assert opcion("--output") == "text"
    respuestas = json.loads(os.environ["RESPUESTAS_AWS"])
    with Path("llamadas.jsonl").open("a") as archivo:
        archivo.write(json.dumps(args) + "\\n")

    if args[1] == "list-objects-v2":
        prefijo = opcion("--prefix")
        if os.environ.get("FALLO_AWS") == prefijo:
            print("aws: error simulado de acceso", file=sys.stderr)
            sys.exit(255)
        respuesta = respuestas[prefijo]
    elif args[1] == "head-object":
        respuesta = next(objeto for listado in respuestas.values()
                         for objeto in (listado.get("Contents") or [])
                         if objeto["Key"] == opcion("--key"))
    else:
        raise AssertionError("Operación inesperada: " + args[1])
    try:
        resultado = jmespath.search(opcion("--query"), respuesta)
    except jmespath.exceptions.JMESPathError as error:
        print("aws: " + str(error), file=sys.stderr)
        sys.exit(255)
    print("None" if resultado is None else resultado)
''')


def ejecutar(tmp_path, seleccion, respuestas, fallo=""):
    aws = tmp_path / "aws"
    aws.write_text(f"#!{sys.executable}\n{AWS_SIMULADO}", encoding="utf-8")
    aws.chmod(0o755)
    salida = tmp_path / "github-env"
    resultado = subprocess.run(
        ["/bin/bash", "-c", seleccion], cwd=tmp_path, text=True,
        capture_output=True, timeout=10,
        # Entorno construido de cero: no se heredan secrets ni configuración AWS.
        env={
            "PATH": f"{tmp_path}{os.pathsep}/usr/bin:/bin", "LANG": "C.UTF-8",
            "R2_BUCKET": "bucket-simulado", "R2_ENDPOINT": "https://r2.invalid",
            "GITHUB_ENV": str(salida), "RESPUESTAS_AWS": json.dumps(respuestas),
            "FALLO_AWS": fallo,
        },
    )
    llamadas = [json.loads(linea) for linea in (tmp_path / "llamadas.jsonl").read_text().splitlines()]
    return resultado, salida.read_text() if salida.exists() else "", llamadas


def copia(prefijo, nombre, fecha):
    return {"Key": prefijo + nombre + ".dump.gpg", "LastModified": fecha}


DIARIA = copia(DIARIO, "unica", "2026-09-16T06:00:00+00:00")
MENSUAL_UNICA = copia(MENSUAL, "unica", "2026-09-01T06:00:00+00:00")


@pytest.mark.parametrize("vacio", [{}, {"Contents": None}, {"Contents": []}], ids=["sin-Contents", "null", "lista-vacia"])
@pytest.mark.parametrize("prefijo,tipo", [(DIARIO, "diaria"), (MENSUAL, "mensual")])
def test_prefijo_vacio_explica_que_copia_falta(tmp_path, seleccion, vacio, prefijo, tipo):
    respuestas = {DIARIO: {"Contents": [DIARIA]}, MENSUAL: {"Contents": [MENSUAL_UNICA]}}
    respuestas[prefijo] = vacio
    resultado, env, llamadas = ejecutar(tmp_path, seleccion, respuestas)
    assert resultado.returncode == 1, resultado.stderr
    assert f"ERROR: no hay ninguna copia {tipo} bajo {prefijo}" in resultado.stderr
    assert "sort_by" not in resultado.stderr
    assert env == ""
    assert all(args[1] == "list-objects-v2" for args in llamadas)
    assert [args[args.index("--prefix") + 1] for args in llamadas] == (
        [DIARIO] if prefijo == DIARIO else [DIARIO, MENSUAL]
    )


@pytest.mark.parametrize("varios", [False, True], ids=["un-archivo", "varios-desordenados"])
def test_elige_diaria_reciente_y_mensual_vieja(tmp_path, seleccion, varios):
    diarios, mensuales = [DIARIA], [MENSUAL_UNICA]
    if varios:
        # Nombres y posición contradicen el orden por fecha: debe decidir LastModified.
        diarios = [copia(DIARIO, "z", "2026-08-01T06:00:00+00:00"), DIARIA,
                   copia(DIARIO, "a", "2026-09-15T06:00:00+00:00")]
        mensuales = [copia(MENSUAL, "a", "2026-11-01T06:00:00+00:00"), MENSUAL_UNICA,
                     copia(MENSUAL, "z", "2026-10-01T06:00:00+00:00")]
    resultado, env, llamadas = ejecutar(tmp_path, seleccion, {
        DIARIO: {"Contents": diarios}, MENSUAL: {"Contents": mensuales},
    })
    assert resultado.returncode == 0, resultado.stderr
    assert resultado.stderr == ""
    assert env.splitlines() == [
        f"BACKUP_DIARIO={DIARIA['Key']}", f"BACKUP_DIARIO_FECHA={DIARIA['LastModified']}",
        f"BACKUP_MENSUAL={MENSUAL_UNICA['Key']}", f"BACKUP_MENSUAL_FECHA={MENSUAL_UNICA['LastModified']}",
    ]
    assert resultado.stdout.splitlines() == [f"Diaria: {DIARIA['Key']}", f"Mensual: {MENSUAL_UNICA['Key']}"]
    assert [args[1] for args in llamadas] == ["list-objects-v2", "list-objects-v2", "head-object", "head-object"]


@pytest.mark.parametrize("prefijo", [DIARIO, MENSUAL])
def test_error_de_aws_identifica_prefijo_sin_hacerlo_pasar_por_vacio(tmp_path, seleccion, prefijo):
    resultado, env, _ = ejecutar(tmp_path, seleccion, {
        DIARIO: {"Contents": [DIARIA]}, MENSUAL: {"Contents": [MENSUAL_UNICA]},
    }, fallo=prefijo)
    assert resultado.returncode == 1, resultado.stderr
    assert f"ERROR: no se pudo listar el prefijo {prefijo}." in resultado.stderr
    assert "no hay ninguna copia" not in resultado.stderr
    assert env == ""
