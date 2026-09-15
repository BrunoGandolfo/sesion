// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConfigView } from '../config-view';
const api=vi.hoisted(()=>({patch:vi.fn()}));
vi.mock('@/lib/api-client', async original=>({...await original<typeof import('@/lib/api-client')>(),apiPatch:api.patch,apiGet:async()=>({nombreProfesional:'Mariana',direccion:'Dirección de prueba',whatsappOrigen:'099123456',tarifaDefault:1500,recordatorioModo:'dia_anterior',templateRecordatorio:'Hola {nombre}',orientacionTeorica:'gestalt'})}));
vi.mock('next-auth/react',()=>({getSession:async()=>({user:{email:'prueba@example.invalid'}}),signOut:vi.fn()}));
vi.mock('@/components/layout/cabecera-usuario',()=>({AccesoConsultorio:()=>null}));
vi.mock('../vocabulario-seccion',()=>({VocabularioSeccion:()=>null}));
vi.mock('../invitar-colega',()=>({InvitarColega:()=>null}));
beforeEach(()=>{vi.useFakeTimers();api.patch.mockClear()});
afterEach(()=>{cleanup();vi.useRealTimers()});
it.each(['-1','1.5',''])('identifica la tarifa inválida %s sin enviar cambios',async valor=>{
 await act(async()=>{render(<ConfigView/>)});
 const campo=screen.getByRole('spinbutton',{name:'Lo que cobrás por sesión'});
 fireEvent.change(campo,{target:{value:valor}});
 await act(async()=>{await vi.advanceTimersByTimeAsync(1600)});
 const mensaje=screen.getByText(valor===''?'Falta la tarifa':'Usá un importe entero, de cero en adelante.');
 expect(campo.getAttribute('aria-invalid')).toBe('true');
 expect(campo.getAttribute('aria-describedby')).toBe(mensaje.id);
 expect(screen.getByText('Hay cambios sin guardar. Revisá los datos y reintentá.')).toBeTruthy();
 expect(api.patch).not.toHaveBeenCalled();
});
