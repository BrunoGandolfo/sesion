// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Dashboard } from '../dashboard';
import { leerHoy, SIN_PENDIENTES } from '../datos';
vi.mock('next/navigation', () => ({useRouter: () => ({push: vi.fn()})}));
vi.mock('../datos', async original => ({...await original<typeof import('../datos')>(), leerHoy: vi.fn()}));
vi.mock('@/components/layout/cabecera-usuario', () => ({CabeceraUsuario: () => null}));
vi.mock('framer-motion', async original => ({...await original<typeof import('framer-motion')>(), useReducedMotion: () => true}));
it('pone la agenda antes de una sola deuda enlazada a Cobros', async () => {
 vi.mocked(leerHoy).mockResolvedValue({nombre:null, ahora:new Date('2026-09-11T15:00:00Z'), riesgoEnElDia:false,
 data:{inicio:{tarifaCargada:true,tienePacientes:true,tieneTurnos:true},kpis:{sesionesHoy:0,deudaAcumulada:43100,ingresosMes:0},sesionesHoy:[],deudores:[],proximaSesion:null,riesgoDelDia:[],pendientes:{...SIN_PENDIENTES,totalSinCobrar:{pacientes:12,sesiones:20,monto:43100},sinCobrar:[{pacienteId:'p1',pacienteNombre:'Ana Prueba',sesiones:20,monto:43100,masAntiguo:'2026-09-01T15:00:00Z'}]}}});
 render(<Dashboard />);
 const agenda=await screen.findByText('Agenda del día');
 const deuda=screen.getByText('12 pacientes te deben · $ 43.100');
 expect(agenda.compareDocumentPosition(deuda)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(screen.getAllByText(/43.100/)).toHaveLength(1);
 expect(screen.getByRole('link',{name:/Ver todos.*Cobros/}).getAttribute('href')).toBe('/cobros');
 expect(screen.queryByText('Por cobrar')).toBeNull();
 expect(screen.queryByText('Te deben')).toBeNull();
 expect(screen.getByText('Hoy no hay nada agendado.')).toBeTruthy();
 expect(screen.getByRole('button',{name:'Agendar'})).toBeTruthy();
});
