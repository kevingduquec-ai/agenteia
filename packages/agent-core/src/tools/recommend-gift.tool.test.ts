import { describe, expect, it } from 'vitest';
import { buildGiftClarifyingQuestion, needsMoreGiftInfo } from './recommend-gift.tool.js';

describe('needsMoreGiftInfo', () => {
  it('pide mas info cuando no hay genero/edad NI interes/categoria', () => {
    expect(needsMoreGiftInfo({})).toBe(true);
  });

  it('pide mas info cuando solo se sabe QUIEN pero no QUE le gusta', () => {
    expect(needsMoreGiftInfo({ recipientGender: 'mujer' })).toBe(true);
  });

  it('pide mas info cuando solo se sabe QUE le gusta pero no QUIEN es', () => {
    expect(needsMoreGiftInfo({ interests: 'maquillaje' })).toBe(true);
  });

  it('NO pide mas info cuando ya hay genero e interes', () => {
    expect(needsMoreGiftInfo({ recipientGender: 'hombre', interests: 'tecnologia' })).toBe(false);
  });

  it('NO pide mas info cuando ya hay edad y categoria (genero no es obligatorio si hay edad)', () => {
    expect(needsMoreGiftInfo({ recipientAge: 8, categoryName: 'Juguetes' })).toBe(false);
  });

  it('"mi hermana, tiene 25 años" sin pista de que le gusta SI pide mas info (bug real que esto corrigio)', () => {
    expect(needsMoreGiftInfo({ recipientAge: 25 })).toBe(true);
  });
});

describe('buildGiftClarifyingQuestion', () => {
  it('pregunta ambas cosas cuando falta todo', () => {
    expect(buildGiftClarifyingQuestion({})).toMatch(/Para quién.*qué le gusta/s);
  });

  it('pregunta solo por el destinatario cuando ya se sabe que le gusta', () => {
    const question = buildGiftClarifyingQuestion({ interests: 'maquillaje' });
    expect(question).toMatch(/hombre, una mujer, un bebé o una mascota/);
    expect(question).not.toMatch(/qué le gusta/);
  });

  it('pregunta solo por el interes cuando ya se sabe quien es', () => {
    const question = buildGiftClarifyingQuestion({ recipientGender: 'hombre' });
    expect(question).toMatch(/[Qq]ué le gusta/);
  });

  it('con edad pero sin genero, pregunta especificamente el genero (no repite la pregunta completa)', () => {
    const question = buildGiftClarifyingQuestion({ recipientAge: 30, interests: 'deportes' });
    expect(question).toBe('¿El regalo es para un hombre, una mujer, un bebé o una mascota?');
  });

  it('con genero pero sin edad, y ya con interes, pregunta la edad', () => {
    const question = buildGiftClarifyingQuestion({ recipientGender: 'mujer', interests: 'perfumes' });
    // needsMoreGiftInfo ya seria false en este caso (hay who y what) — este
    // helper solo se llama cuando needsMoreGiftInfo dio true, pero se
    // prueba igual la rama final por completitud de la función pura.
    expect(question).toBe('¿Qué edad tiene aproximadamente?');
  });
});
