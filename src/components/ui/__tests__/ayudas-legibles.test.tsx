// @vitest-environment jsdom
import {render,screen} from '@testing-library/react';
import {expect,it} from 'vitest';
import {Input} from '../input';
import {Textarea} from '../textarea';
it('usa el color de texto secundario legible en las pistas de los campos',()=>{
 render(<><Input label="Teléfono" placeholder="+598 99 123 456"/><Textarea label="Notas" placeholder="Observaciones"/></>);
 for(const campo of [screen.getByLabelText('Teléfono'),screen.getByLabelText('Notas')]) {
  expect(campo.classList.contains('placeholder:text-ink-500')).toBe(true);
  expect(campo.classList.contains('placeholder:text-ink-300')).toBe(false);
 }
});
