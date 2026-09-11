// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { NuevoPacienteForm } from '../nuevo-paciente-form';
it('asocia el error de tarifa al campo que hay que corregir', async () => {
 render(<NuevoPacienteForm tarifaDefault={0} onSuccess={vi.fn()} onCancel={vi.fn()} />);
 fireEvent.click(screen.getByRole('button',{name:'Crear paciente'}));
 const mensaje=await screen.findByText('La tarifa debe ser mayor a 0');
 const campo=screen.getByRole('spinbutton');
 expect(campo.getAttribute('aria-invalid')).toBe('true');
 expect(campo.getAttribute('aria-describedby')).toBe(mensaje.id);
 expect(mensaje.id).not.toBe('');
 fireEvent.change(campo,{target:{value:'1500'}});
 await screen.findByText('Ingresá el nombre');
});
