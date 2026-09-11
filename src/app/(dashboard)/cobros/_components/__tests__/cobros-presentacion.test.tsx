// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CobrosView } from '../cobros-view';
vi.mock('@/components/layout/cabecera-usuario', () => ({CabeceraUsuario: () => null}));
vi.mock('framer-motion', async original => ({...await original<typeof import('framer-motion')>(), useReducedMotion: () => true}));
vi.mock('@/lib/api-client', async original => ({
 ...await original<typeof import('@/lib/api-client')>(),
 apiGet: vi.fn(async (url: string) => {
  if(url==='/api/dashboard') return {kpis:{sesionesHoy:0,deudaAcumulada:43100,ingresosMes:1234567}};
  if(url==='/api/deudores') return [{pacienteId:'p1',nombre:'María de los Ángeles',apellido:'Apellido Largo',telefono:'',sesionesImpagas:2,montoTotal:43100,minutosTotales:100,diasAtraso:1,ultimoAvisoEn:null}];
  if(url==='/api/turnos/cobros') return [{id:'t1',fecha:'2026-09-11T15:00:00Z',pagoFecha:'2026-09-11T15:00:00Z',creadoEn:'2026-09-11T15:00:00Z',actualizadoEn:'2026-09-11T15:00:00Z',tarifaCobrada:1234567,pagoMetodo:'efectivo',paciente:{id:'p1',nombre:'María de los Ángeles',apellido:'Apellido Largo'}}];
  if(url==='/api/config') return {nombreProfesional:'Profesional Prueba'};
  return {ok:false};
 })
}));
it('muestra importes completos y conserva nombre, enlace, fecha y método', async () => {
 const {container}=render(<CobrosView />);
 await screen.findByText('$ 1.234.567');
 expect(container.textContent).not.toMatch(/43\.1k|1234\.6k/);
 const ficha=screen.getByRole('link',{name:'Abrir ficha de María de los Ángeles Apellido Largo'});
 expect(ficha.getAttribute('href')).toBe('/pacientes/p1');
 expect(within(ficha).getByText('María de los Ángeles Apellido Largo')).toBeTruthy();
 expect(within(ficha).getByText('$ 43.100')).toBeTruthy();
 fireEvent.click(screen.getByRole('tab',{name:'Cobros del mes'}));
 const nombre=await screen.findByRole('link',{name:'María de los Ángeles Apellido Largo'});
 const fila=nombre.closest('li')!;
 expect(within(fila).getByText('$ 1.234.567')).toBeTruthy();
 expect(within(fila).getByText('11 sep · Efectivo')).toBeTruthy();
 expect(nombre.getAttribute('href')).toBe('/pacientes/p1');
});
