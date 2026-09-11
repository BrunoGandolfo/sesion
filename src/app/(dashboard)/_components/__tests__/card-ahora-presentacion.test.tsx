// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CardAhora } from '../card-ahora';
import type { TurnoConPaciente } from '@/types/domain';

vi.mock('@/lib/api-client', () => ({ apiGet: vi.fn().mockResolvedValue(null) }));

it('deja envolver el nombre completo y conserva la acción de cobrar', async () => {
  const fecha = new Date(2026, 8, 11, 19);
  const turno: TurnoConPaciente = {
    id: 'turno-prueba', pacienteId: 'paciente-prueba', organizationId: 'org-prueba',
    fecha, duracion: 50, modalidad: 'presencial', estado: 'programado',
    tarifaCobrada: 2200, pagoEstado: 'pendiente', pagoFecha: null, pagoMetodo: null,
    notas: null, creadoEn: fecha, actualizadoEn: fecha, sesionClinica: null,
    paciente: { id: 'paciente-prueba', nombre: 'Francisco Alejandro', apellido: 'Algorta Rodríguez', telefono: '099123456' },
  };
  const onCobrar = vi.fn();
  await act(async () => {
    render(<CardAhora turno={turno} enCurso={false} sinAutorizacion={false} sinCobrar onCobrar={onCobrar} />);
  });
  const nombre = screen.getByRole('heading', { name: 'Francisco Alejandro Algorta Rodríguez' });
  expect(nombre.className).toContain('break-words');
  expect(nombre.className).not.toContain('truncate');
  expect(nombre.parentElement?.parentElement?.parentElement?.className).toContain('flex-col');
  expect(screen.getByRole('link', { name: /Ver ficha/ }).getAttribute('href')).toBe('/pacientes/paciente-prueba');
  expect(screen.getByText(/2.200/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cobrar' }));
  expect(onCobrar).toHaveBeenCalledOnce();
});
