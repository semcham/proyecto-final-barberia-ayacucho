import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { importPKCS8, importSPKI, jwtVerify, type KeyLike, SignJWT } from 'jose';
import { Configuracion } from '../../../../shared';
import { NoAutenticado } from '../domain/errores';
import { CODIGOS_ROL, type CodigoRol } from '../domain/rol';
import { type ReclamacionesAcceso, type TokenFirmado, TokenSigner } from '../application/ports/token-signer';

const ALGORITMO = 'ES256';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * JWT ES256 con `kid` (R07): firma con la clave activa y verifica con cualquiera de las públicas
 * configuradas, para poder rotar claves sin cambiar código. Solo acepta ES256.
 */
@Injectable()
export class JoseTokenSigner extends TokenSigner {
  private clavePrivada?: Promise<KeyLike>;
  private readonly clavesPublicas = new Map<string, Promise<KeyLike>>();

  constructor(private readonly configuracion: Configuracion) {
    super();
  }

  async firmar(reclamaciones: ReclamacionesAcceso): Promise<TokenFirmado> {
    const { kidActivo, emisor, audiencia, vidaSegundos, clavePrivada } = this.configuracion.jwt;
    this.clavePrivada ??= importPKCS8(clavePrivada, ALGORITMO);
    const token = await new SignJWT({
      tid: reclamaciones.tid,
      rol: reclamaciones.rol,
      sid: reclamaciones.sid,
    })
      .setProtectedHeader({ alg: ALGORITMO, kid: kidActivo, typ: 'JWT' })
      .setSubject(reclamaciones.sub)
      .setIssuer(emisor)
      .setAudience(audiencia)
      .setIssuedAt()
      .setExpirationTime(`${vidaSegundos}s`)
      .setJti(randomUUID())
      .sign(await this.clavePrivada);
    return { token, expiraEnSegundos: vidaSegundos };
  }

  async verificar(token: string): Promise<ReclamacionesAcceso> {
    const { emisor, audiencia } = this.configuracion.jwt;
    try {
      const { payload } = await jwtVerify(token, (encabezado) => this.clavePublica(encabezado.kid), {
        algorithms: [ALGORITMO],
        issuer: emisor,
        audience: audiencia,
        requiredClaims: ['sub', 'exp', 'iat', 'jti'],
      });
      const { sub, tid, rol, sid } = payload as Record<string, unknown>;
      if (
        typeof sub !== 'string' ||
        !UUID.test(sub) ||
        typeof tid !== 'string' ||
        !UUID.test(tid) ||
        typeof sid !== 'string' ||
        !UUID.test(sid) ||
        !CODIGOS_ROL.includes(rol as CodigoRol)
      ) {
        throw new NoAutenticado();
      }
      return { sub, tid, rol: rol as CodigoRol, sid };
    } catch {
      // Sin detalles del motivo (EQ-07).
      throw new NoAutenticado();
    }
  }

  private clavePublica(kid: string | undefined): Promise<KeyLike> {
    const pem = kid ? this.configuracion.jwt.clavesPublicas[kid] : undefined;
    if (!kid || !pem) return Promise.reject(new NoAutenticado());
    let clave = this.clavesPublicas.get(kid);
    if (!clave) {
      clave = importSPKI(pem, ALGORITMO);
      this.clavesPublicas.set(kid, clave);
    }
    return clave;
  }
}
