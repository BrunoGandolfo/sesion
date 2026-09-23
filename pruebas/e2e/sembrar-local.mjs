// Fixture clínica ficticia para completar el seed local. Nunca contra una base remota.
// Usa el formato ENC2 documentado, con la clave de desarrollo en cero; no llama al worker.
import assert from 'node:assert/strict';
import { createCipheriv, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
const url = new URL(process.env.DATABASE_URL);
assert(['127.0.0.1','localhost','[::1]'].includes(url.hostname) && url.pathname.startsWith('/sesion_e2e_'), 'Solo una base local sesion_e2e_*');
assert.equal(process.env.CLAVES_CIFRADO, '1=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'Solo la clave de desarrollo');
const db = new PrismaClient();
const id = 'dddddddd-0001-4000-8000-000000000001';
// Las columnas JSON guardan JSON; las de texto (la transcripción), el texto tal cual.
function cifrarFixture(columna, valor) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.alloc(32), iv);
  cipher.setAAD(Buffer.from('sesiones_clinicas:' + columna + ':' + id));
  const ct = Buffer.concat([cipher.update(typeof valor === 'string' ? valor : JSON.stringify(valor)), cipher.final()]);
  return Buffer.concat([Buffer.from('ENC2'), Buffer.from([1]), iv, cipher.getAuthTag(), ct]);
}
try {
  const turno = await db.turno.findUniqueOrThrow({where:{id:'cccccccc-0001-4000-8000-000000000000'}});
  assert.equal(turno.organizationId, '11111111-1111-4111-8111-111111111111');
  const nota = {subjetivo:'Contenido ficticio para comprobar la pantalla.',objetivo:'Datos inventados del seed.',analisis:'Este texto no describe a una persona real.',plan:'Verificar que la nota se puede leer.'};
  const datos = {resumenSesion:'Sesión ficticia para el recorrido automático.',temas:['Prueba de interfaz'],focoProximaSesion:'Comprobar presentación.'};
  const feedback = {instrumento:'gestalt',fortalezas:[],areasCrecimiento:[],sugerenciaProximaSesion:'Contenido ficticio de prueba.',itemsGTFS:[{id:'prueba',nombre:'Ítem ficticio',score:3,evidence:[]}]};
  // Con el formato del worker: "[MM:SS] Terapeuta|Paciente: texto". "semana" aparece una vez y "prueba" tres.
  const transcripcion = ['[00:03] Terapeuta: Texto ficticio. ¿Cómo estuvo la semana?','[00:09] Paciente: Una prueba de interfaz, nada real.','[00:15] Terapeuta: Otra prueba para el buscador.','(línea sin formato, se muestra entera)','[01:02] Paciente: La última prueba del recorrido.'].join('\n');
  const contenido = {estado:'aprobada',audioEstado:'borrado',audioBorradoEn:new Date(),aprobadaEn:new Date(),procesadaEn:new Date(),feedbackEstado:'listo',duracionAudioSeg:3000,notaIaEncrypted:cifrarFixture('nota_ia_encrypted',nota),notaFinalEncrypted:cifrarFixture('nota_final_encrypted',nota),datosEncrypted:cifrarFixture('datos_encrypted',datos),feedbackEncrypted:cifrarFixture('feedback_encrypted',feedback),transcripcionEncrypted:cifrarFixture('transcripcion_encrypted',transcripcion)};
  await db.sesionClinica.upsert({where:{id},create:{id,turnoId:turno.id,organizationId:turno.organizationId,...contenido},update:contenido});
  console.log('Fixture local: nota aprobada, Para vos y transcripción, persistidos y cifrados.');
} finally {await db.$disconnect();}
