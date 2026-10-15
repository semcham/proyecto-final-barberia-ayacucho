import { Injectable } from '@nestjs/common';
import argon2, { type HashOptions } from 'argon2';
import { Configuracion } from '../../../../shared';
import type { Contrasena } from '../domain/contrasena';
import { PasswordHasher } from '../application/ports/password-hasher';

/** Argon2id con parámetros del entorno (mínimo OWASP por defecto). Guarda la cadena PHC completa. */
@Injectable()
export class Argon2PasswordHasher extends PasswordHasher {
  private hashFicticio?: Promise<string>;

  constructor(private readonly configuracion: Configuracion) {
    super();
  }

  hash(contrasena: Contrasena): Promise<string> {
    return argon2.hash(contrasena.valor, this.opciones());
  }

  async verificar(hashGuardado: string, texto: string): Promise<boolean> {
    try {
      return await argon2.verify(hashGuardado, texto);
    } catch {
      return false;
    }
  }

  async verificarFicticio(texto: string): Promise<false> {
    this.hashFicticio ??= argon2.hash('contrasena-ficticia-para-igualar-tiempos', this.opciones());
    await this.verificar(await this.hashFicticio, texto);
    return false;
  }

  private opciones(): HashOptions & { raw?: false } {
    const { memoriaKib, iteraciones, paralelismo } = this.configuracion.argon2;
    return { type: argon2.argon2id, memoryCost: memoriaKib, timeCost: iteraciones, parallelism: paralelismo };
  }
}
