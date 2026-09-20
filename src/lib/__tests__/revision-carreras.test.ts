import { beforeAll, afterAll, beforeEach, expect, test } from 'vitest';
import { conectarBaseDeTest, vaciarTablas } from '@/lib/__tests__/db-test';
import { cobrarTurno, descobrarTurno } from '@/app/api/_lib/casos-uso/cobrar-turno';
import { actualizarTurno } from '@/app/api/_lib/casos-uso/turnos';
import { aprobarSesion } from '@/app/api/_lib/casos-uso/sesion/aprobar';
import { reprocesarSesion } from '@/app/api/_lib/casos-uso/sesion/reprocesar';
import { aplicarResultadoSesion } from '@/app/api/_lib/casos-uso/sesion/resultado';
import { reclamarSesiones } from '@/app/api/_lib/casos-uso/sesion/reclamar';
import { cifrarSesion } from '@/lib/prisma-encryption';
import { __resetLlaveroForTests } from '@/lib/llavero';
import { CLAVES_CIFRADO_TEST } from './base-identidad';
let base: ReturnType<typeof conectarBaseDeTest>;
let org: string, paciente: string, turno: string;
const ahora = new Date('2026-09-15T15:00:00Z');
const nota = (s:string) => ({subjetivo:s,objetivo:'observacion ficticia',analisis:'analisis ficticio',plan:'plan ficticio'});
// La clave se pone ACÁ y no se hereda del ambiente. Este archivo fallaba al
// importar en cualquier máquina donde CLAVES_CIFRADO no estuviera exportada,
// y pasaba en CI sólo porque ci.yml la declara a nivel de workflow: el
// veredicto de la suite no puede depender de qué tenga cargado la terminal.
beforeAll(()=> {
 process.env.CLAVES_CIFRADO = CLAVES_CIFRADO_TEST;
 __resetLlaveroForTests();
 base=conectarBaseDeTest();
});
afterAll(async()=>base.prisma.$disconnect());
beforeEach(async()=>{
 await vaciarTablas(base.prisma);
 org=(await base.prisma.organization.create({data:{nombre:'AUDITORIA FICTICIA'}})).id;
 paciente=(await base.prisma.paciente.create({data:{organizationId:org,nombre:'Prueba',apellido:'Ficticia',telefono:'',tarifa:1800}})).id;
 turno=(await base.prisma.turno.create({data:{organizationId:org,pacienteId:paciente,fecha:new Date('2026-09-15T14:00:00Z'),tarifaCobrada:1800}})).id;
});
// Intercala operaciones reales después de una lectura real de Postgres.
function trasLeerTurno(fn:()=>Promise<void>) {
 let primera=true;
 return new Proxy(base.db,{get(target,prop){
  if(prop==='turno') return new Proxy(target.turno,{get(model,op){
   if(op==='findFirst') return async(args: Parameters<typeof model.findFirst>[0])=>{const fila=await model.findFirst(args);if(primera){primera=false;await fn()}return fila};
   return Reflect.get(model,op);
  }});
  return Reflect.get(target,prop);
 }});
}
test('rechaza cobrar un turno movido al futuro entre lectura y escritura',async()=>{
 const db=trasLeerTurno(async()=>{await actualizarTurno({prisma:base.db,organizationId:org,turnoId:turno,cambios:{fecha:new Date('2026-09-16T14:00:00Z')},ahora})});
 await expect(cobrarTurno({prisma:db,organizationId:org,turnoId:turno,metodo:'efectivo',fecha:ahora})).rejects.toMatchObject({status:409});
 const fin=await base.prisma.turno.findUniqueOrThrow({where:{id:turno}});
 expect(fin.fecha.getTime()).toBeGreaterThan(ahora.getTime());expect(fin.pagoEstado).toBe('pendiente');expect(fin.estado).toBe('programado');
});
test('un deshacer demorado conserva el cobro posterior',async()=>{
 await cobrarTurno({prisma:base.db,organizationId:org,turnoId:turno,metodo:'efectivo',fecha:ahora});
 const actualizadoEn=(await base.prisma.turno.findUniqueOrThrow({where:{id:turno}})).actualizadoEn;
 const db=trasLeerTurno(async()=>{
  await descobrarTurno({actualizadoEn,prisma:base.db,organizationId:org,turnoId:turno});
  await cobrarTurno({prisma:base.db,organizationId:org,turnoId:turno,metodo:'transferencia',fecha:new Date(ahora.getTime()+1000)});
 });
 await expect(descobrarTurno({actualizadoEn,prisma:db,organizationId:org,turnoId:turno})).rejects.toMatchObject({status:409});
 const fin=await base.prisma.turno.findUniqueOrThrow({where:{id:turno}});
 expect(fin.pagoEstado).toBe('pagado');expect(fin.pagoMetodo).toBe('transferencia');
});
async function nuevaNota(id: string) {
 await reprocesarSesion({prisma:base.db,sesionId:id,organizationId:org,usuarioId:'ficticio',ahora});
 const [reclamo]=await reclamarSesiones({prisma:base.db,ahora,limite:1,terminosAsr:async()=>[]});
 await aplicarResultadoSesion({prisma:base.db,sesionId:id,organizationId:org,resultado:{intento:reclamo.intento,resultado:'nota',nota:nota('GENERACION 2'),datos:{},modeloLlm:'prueba',promptVersion:'prueba'},ahora});
}

test.each(['antes de leer', 'entre lectura y escritura'])('rechaza aprobar otra generación: %s',async(momento)=>{
 const id=crypto.randomUUID();
 await base.db.sesionClinica.create({data:{...cifrarSesion(id,{notaIa:nota('GENERACION 1'),transcripcion:'Texto ficticio'}),organizationId:org,turnoId:turno,estado:'revision',generacion:1,modeloAsr:'prueba'}});
 const borradorViejo=nota('GENERACION 1 EDITADA');
 let prisma=base.db;
 if(momento==='antes de leer') await nuevaNota(id);
 else {
  prisma=new Proxy(base.db,{get(target,prop){
   if(prop!=='sesionClinica') return Reflect.get(target,prop);
   return new Proxy(target.sesionClinica,{get(model,op){
    if(op!=='findFirst') return Reflect.get(model,op);
    return async(args:Parameters<typeof model.findFirst>[0])=>{
     const fila=await model.findFirst(args); await nuevaNota(id); return fila;
    };
   }});
  }});
 }
 await expect(aprobarSesion({prisma,sesionId:id,organizationId:org,usuarioId:'ficticio',generacion:1,notaEditada:borradorViejo,confirmoRiesgo:true,confirmoMenciones:true,ahora})).rejects.toMatchObject({status:409});
 const fin=await base.db.sesionClinica.findUniqueOrThrow({where:{id},select:{generacion:true,estado:true,notaIa:true,notaFinal:true}});
 expect(fin.generacion).toBe(2);expect(fin.estado).toBe('revision');expect(fin.notaIa?.subjetivo).toBe('GENERACION 2');expect(fin.notaFinal).toBeNull();
 // La aprobación rechazada no deja rastro: el evento se escribe con el
 // mismo cliente que el acto, así que si no hubo acto no hay fila.
 expect(await base.prisma.eventoAuditoria.count({where:{accion:'sesion.aprobar'}})).toBe(0);
 expect(await base.prisma.trabajo.count({where:{tipo:'integrar_contexto'}})).toBe(0);
});

test('un pedido viejo no deshace un cobro nuevo con idénticos fecha y método',async()=>{
 const original=await cobrarTurno({prisma:base.db,organizationId:org,turnoId:turno,metodo:'efectivo',fecha:ahora});
 await descobrarTurno({prisma:base.db,organizationId:org,turnoId:turno,actualizadoEn:original.actualizadoEn});
 const nuevo=await cobrarTurno({prisma:base.db,organizationId:org,turnoId:turno,metodo:'efectivo',fecha:ahora});
 expect(nuevo.actualizadoEn.getTime()).toBeGreaterThan(original.actualizadoEn.getTime());
 await expect(descobrarTurno({prisma:base.db,organizationId:org,turnoId:turno,actualizadoEn:original.actualizadoEn})).rejects.toMatchObject({status:409});
 expect((await base.prisma.turno.findUniqueOrThrow({where:{id:turno}})).pagoEstado).toBe('pagado');
});
