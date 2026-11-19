// Funcionalidad 009 (research R04): contraseñas al azar para la demo publicada (las usa la fase 7). Cumplen la
// política de 001 (10 a 128 caracteres, no comunes, sin el correo): 20 caracteres de un alfabeto sin símbolos
// ambiguos, con al menos una mayúscula, una minúscula y un dígito. Nunca se imprimen.
import { randomInt } from 'node:crypto';

const MAYUSCULAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MINUSCULAS = 'abcdefghijkmnpqrstuvwxyz';
const DIGITOS = '23456789';
const TODO = `${MAYUSCULAS}${MINUSCULAS}${DIGITOS}`;

export function contrasenaAlAzar(largo = 20) {
  for (;;) {
    let texto = '';
    for (let i = 0; i < largo; i++) texto += TODO[randomInt(TODO.length)];
    if (/[A-Z]/.test(texto) && /[a-z]/.test(texto) && /[0-9]/.test(texto)) return texto;
  }
}
