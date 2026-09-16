"""Ejecuta el YAML con Bash real y aws simulado (JMESPath real).

Se inyectan fallos por etapa; ensayo-restauracion.test.ts cubre también
el bloque con gpg/Postgres reales. No se heredan secrets ni configuración AWS.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import textwrap

import pytest

RAIZ = Path(__file__).resolve().parents[2]
WORKFLOW = RAIZ / ".github/workflows/ensayo-restauracion.yml"
VERIFICADOR = RAIZ / "scripts/ensayo/verificar-restauracion.mjs"
DIARIO = "backups/sesion-backup-"
MENSUAL = "backups/mensuales/"
ETAPAS = ["listado", "metadatos", "descarga", "base", "apertura", "verificacion"]
NODE = shutil.which("node")


@pytest.fixture(scope="module")
def ensayo():
    lineas = WORKFLOW.read_text(encoding="utf-8").splitlines()
    inicio = lineas.index("      - name: Ensayar las dos copias por separado")
    assert lineas[inicio + 1] == "        run: |"
    bloque = []
    for linea in lineas[inicio + 2:]:
        if linea.strip() and not linea.startswith("          "):
            break
        bloque.append(linea[10:])
    assert bloque, "No se extrajo el bloque del YAML"
    return "\n".join(bloque)


SIMULADOR = textwrap.dedent('''\
    import json, os, sys
    from pathlib import Path
    import jmespath

    args = sys.argv[1:]
    programa = Path(sys.argv[0]).name
    etiqueta = os.environ["ETIQUETA"]
    def opcion(nombre):
        return args[args.index(nombre) + 1]
    def registrar(etapa):
        with Path("llamadas.jsonl").open("a") as archivo:
            archivo.write(json.dumps({"etiqueta": etiqueta, "etapa": etapa, "args": args,
                                      "archivo": os.environ.get("BACKUP_ARCHIVO"),
                                      "fecha": os.environ.get("BACKUP_FECHA")}) + "\\n")
        if os.environ.get("FALLO") == etiqueta + ":" + etapa:
            print("error simulado en " + etapa, file=sys.stderr)
            sys.exit(255 if programa == "aws" else 23)

    if programa == "aws":
        assert opcion("--endpoint-url") == "https://r2.invalid"
        respuestas = json.loads(os.environ["RESPUESTAS_AWS"])
        if args[:2] == ["s3", "cp"]:
            registrar("descarga")
            assert args[2].startswith("s3://bucket-simulado/backups/")
            Path(args[3]).write_text("copia simulada")
            sys.exit(0)
        assert args[0] == "s3api"
        assert opcion("--bucket") == "bucket-simulado"
        assert opcion("--output") == "text"
        if args[1] == "list-objects-v2":
            registrar("listado")
            respuesta = respuestas[opcion("--prefix")]
        elif args[1] == "head-object":
            registrar("metadatos")
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
    elif programa == "psql":
        registrar("base")
        assert opcion("-c") == "CREATE DATABASE ensayo_" + etiqueta
        assert args[-1] == "postgresql://postgres:postgres@localhost:5432/postgres"
    elif programa == "restaurar.sh":
        registrar("apertura")
        assert Path(args[0]).read_text() == "copia simulada"
        assert args[1].endswith("/ensayo_" + etiqueta)
    elif programa == "node" and args[0] == "scripts/ensayo/verificar-restauracion.mjs":
        registrar("verificacion")
        assert opcion("--etiqueta") == etiqueta
        assert os.environ["DATABASE_URL"].endswith("/ensayo_" + etiqueta)
        resultado = {"ok": True, "archivo": os.environ["BACKUP_ARCHIVO"],
                     "fechaArchivo": os.environ["BACKUP_FECHA"], "tablas": {"conteos": {}},
                     "cifrado": {"columnas": 0, "porClave": {}, "otros": 0, "clavesAusentes": []},
                     "descifrado": {"modo": "ids", "idsConocidos": [1], "muestras": []},
                     "fk": {"constraints": 0, "violaciones": 0}, "problemas": []}
        Path("resultado-" + etiqueta + ".json").write_text(json.dumps(resultado))
    elif programa == "node":
        # El registro del intento se escribe con el Node real.
        os.execv(os.environ["NODE_REAL"], [os.environ["NODE_REAL"], *args])
    else:
        raise AssertionError("Programa inesperado: " + programa)
''')


def acta(tmp_path):
    resultado = subprocess.run(
        [NODE, str(VERIFICADOR), "--acta", "--salida", str(tmp_path)],
        text=True, capture_output=True, timeout=10,
        env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"},
    )
    assert resultado.returncode == 0, resultado.stderr
    return resultado.stdout


def ejecutar(tmp_path, ensayo, respuestas, fallo=""):
    for programa in ["aws", "psql", "node", "scripts/ensayo/restaurar.sh"]:
        ruta = tmp_path / programa
        ruta.parent.mkdir(parents=True, exist_ok=True)
        ruta.write_text(f"#!{sys.executable}\n{SIMULADOR}", encoding="utf-8")
        ruta.chmod(0o755)
    resultado = subprocess.run(
        ["/bin/bash", "-euo", "pipefail", "-c", ensayo], cwd=tmp_path, text=True,
        capture_output=True, timeout=20,
        env={
            "PATH": f"{tmp_path}{os.pathsep}/usr/bin:/bin", "LANG": "C.UTF-8",
            "R2_BUCKET": "bucket-simulado", "R2_ENDPOINT": "https://r2.invalid",
            "RESPUESTAS_AWS": json.dumps(respuestas), "FALLO": fallo, "NODE_REAL": NODE,
            "PG_URL": "postgresql://postgres:postgres@localhost:5432", "PG_BIN": str(tmp_path),
        },
    )
    llamadas = [json.loads(linea) for linea in (tmp_path / "llamadas.jsonl").read_text().splitlines()]
    estados = {e: json.loads((tmp_path / f"estado-{e}.json").read_text()) for e in ["diario", "mensual"]}
    return resultado, estados, llamadas, acta(tmp_path)


def copia(prefijo, nombre, fecha):
    return {"Key": prefijo + nombre + ".dump.gpg", "LastModified": fecha}


DIARIA = copia(DIARIO, "unica", "2026-09-16T06:00:00+00:00")
MENSUAL_UNICA = copia(MENSUAL, "unica", "2026-09-01T06:00:00+00:00")


def completas():
    return {DIARIO: {"Contents": [DIARIA]}, MENSUAL: {"Contents": [MENSUAL_UNICA]}}


@pytest.mark.parametrize("vacio", [{}, {"Contents": None}, {"Contents": []}], ids=["sin-Contents", "null", "lista-vacia"])
@pytest.mark.parametrize("prefijo,etiqueta,nombre,otra", [(DIARIO, "diario", "diaria", "mensual"), (MENSUAL, "mensual", "mensual", "diario")])
def test_prefijo_vacio_no_impide_ensayar_la_otra_copia(tmp_path, ensayo, vacio, prefijo, etiqueta, nombre, otra):
    respuestas = completas()
    respuestas[prefijo] = vacio
    resultado, estados, llamadas, texto = ejecutar(tmp_path, ensayo, respuestas)
    assert resultado.returncode == 1, resultado.stderr
    assert f"ERROR: no hay ninguna copia {nombre} bajo {prefijo}." in resultado.stderr
    assert "sort_by" not in resultado.stderr
    assert estados[etiqueta] == {"etapa": "no_existe", "codigo": 1, "archivo": None, "fechaArchivo": None}
    assert estados[otra]["etapa"] == "completado"
    assert estados[otra]["codigo"] == 0
    assert [c["etapa"] for c in llamadas if c["etiqueta"] == otra] == ETAPAS
    assert [c["etapa"] for c in llamadas if c["etiqueta"] == etiqueta] == ["listado"]
    assert "No existe la copia bajo el prefijo consultado" in texto
    assert "**Resultado de la verificación:** OK" in texto
    assert "descifrado gpg" not in texto
    assert "falló al abrirse" not in texto


def test_ambas_ausentes_se_informan_las_dos(tmp_path, ensayo):
    resultado, estados, llamadas, texto = ejecutar(tmp_path, ensayo, {DIARIO: {}, MENSUAL: {}})
    assert resultado.returncode == 1
    assert [c["etiqueta"] for c in llamadas] == ["diario", "mensual"]
    assert all(e["etapa"] == "no_existe" for e in estados.values())
    assert texto.count("No existe la copia bajo el prefijo consultado") == 2


@pytest.mark.parametrize("varios", [False, True], ids=["un-archivo", "varios-desordenados"])
def test_ensaya_diaria_reciente_y_mensual_vieja(tmp_path, ensayo, varios):
    respuestas = completas()
    if varios:
        respuestas[DIARIO]["Contents"] = [copia(DIARIO, "z", "2026-08-01T06:00:00+00:00"), DIARIA,
                                         copia(DIARIO, "a", "2026-09-15T06:00:00+00:00")]
        respuestas[MENSUAL]["Contents"] = [copia(MENSUAL, "a", "2026-11-01T06:00:00+00:00"), MENSUAL_UNICA,
                                          copia(MENSUAL, "z", "2026-10-01T06:00:00+00:00")]
    resultado, estados, llamadas, texto = ejecutar(tmp_path, ensayo, respuestas)
    assert resultado.returncode == 0, resultado.stderr
    assert resultado.stderr == ""
    for etiqueta, archivo in [("diario", DIARIA), ("mensual", MENSUAL_UNICA)]:
        assert estados[etiqueta] == {"etapa": "completado", "codigo": 0, "archivo": archivo["Key"], "fechaArchivo": archivo["LastModified"]}
        assert [c["etapa"] for c in llamadas if c["etiqueta"] == etiqueta] == ETAPAS
        verificacion = next(c for c in llamadas if c["etiqueta"] == etiqueta and c["etapa"] == "verificacion")
        assert verificacion["archivo"] == archivo["Key"]
        assert verificacion["fecha"] == archivo["LastModified"]
    assert texto.count("**Resultado de la verificación:** OK") == 2


@pytest.mark.parametrize("etiqueta,otra", [("diario", "mensual"), ("mensual", "diario")])
@pytest.mark.parametrize("etapa,mensaje", [
    ("listado", "Falló el listado de copias"),
    ("metadatos", "Falló la lectura de la fecha"),
    ("descarga", "Falló la descarga"),
    ("base", "Falló la preparación de la base"),
    ("apertura", "La copia falló al abrirse o restaurarse"),
    ("verificacion", "Falló la verificación después de restaurar"),
])
def test_error_registra_etapa_y_continua_con_la_otra(tmp_path, ensayo, etiqueta, otra, etapa, mensaje):
    resultado, estados, llamadas, texto = ejecutar(tmp_path, ensayo, completas(), fallo=f"{etiqueta}:{etapa}")
    assert resultado.returncode == 1, resultado.stderr
    assert estados[etiqueta]["etapa"] == etapa
    assert estados[etiqueta]["codigo"] == (1 if etapa == "listado" else 255 if etapa in ETAPAS[:3] else 23)
    assert estados[otra]["etapa"] == "completado"
    assert estados[otra]["codigo"] == 0
    assert [c["etapa"] for c in llamadas if c["etiqueta"] == etiqueta] == ETAPAS[:ETAPAS.index(etapa) + 1]
    assert [c["etapa"] for c in llamadas if c["etiqueta"] == otra] == ETAPAS
    assert mensaje in texto
    assert "**Resultado de la verificación:** OK" in texto
    assert "No existe la copia" not in texto
    assert "descifrado gpg" not in texto


@pytest.mark.parametrize("estado", [None, {"etapa": "nueva", "codigo": 1}, {"etapa": "apertura", "codigo": 0}])
def test_sin_evidencia_el_acta_no_inventa_causa(tmp_path, estado):
    if estado is not None:
        (tmp_path / "estado-diario.json").write_text(json.dumps(estado))
    texto = acta(tmp_path)
    assert texto.count("La causa es desconocida") == 2
    assert "falló al abrirse" not in texto
    assert "descifrado gpg" not in texto
