// Fixture de PR14 (T006 de 008): la interfaz pública del adelanto, que M02 sí puede usar por el index de M03.
export abstract class AdelantosApi {
  abstract deCita(citaId: string): Promise<unknown>;
}
